/**
 * reports.js - Reports and charts view
 * Shows a general summary with charts, followed by per-category breakdowns.
 */
import Chart from 'chart.js/auto';
import { getAllTransactions, getSetting, getTransactionsByDateRange, getSummary } from '../db.js';
import { apiFetch } from '../auth.js';
import { getCurrentView } from '../router.js';
import {
  getCachedRemoteReportData,
  hasRemoteReportAccess,
  invalidateRemoteReportCache,
} from '../reportCache.js';
import {
  formatCurrency,
  formatDate,
  formatDateNumeric,
  getPaymentMethodLabel,
  setupDateInputDisplay,
  getToday,
  CATEGORIES,
  showToast,
  renderSymbolIcon,
} from '../utils.js';

const charts = [];
let reportRangeMode = 'active';
let reportViewCleanup = null;
let isScheduleEditorVisible = false;
let persistedNextReportDate = null;
let latestStoredReports = [];

const REPORT_CHART_COLORS = {
  ingresoFill: 'rgba(64, 98, 78, 0.7)',
  ingresoStroke: '#40624e',
  gastoFill: 'rgba(143, 82, 88, 0.72)',
  gastoStroke: '#8f5258',
  neutralFill: 'rgba(117, 119, 125, 0.2)',
  neutralStroke: 'rgba(117, 119, 125, 0.45)',
  grid: 'rgba(197, 198, 205, 0.7)',
  axis: '#75777d',
  legend: '#45474c',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function parseApiResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail || fallbackMessage || `Request failed: ${response.status}`);
  }
  return payload;
}

function cleanupReportViewListeners() {
  if (reportViewCleanup) {
    reportViewCleanup();
    reportViewCleanup = null;
  }
}

function attachReportViewListeners() {
  cleanupReportViewListeners();

  const refreshIfActive = () => {
    if (getCurrentView() !== 'reports') return;
    loadRemoteReportData({ ensureDue: true, silent: true }).catch((error) => {
      console.error('Remote report refresh failed:', error);
    });
  };

  const handleVisibilityChange = () => {
    if (!document.hidden) {
      refreshIfActive();
    }
  };

  window.addEventListener('focus', refreshIfActive);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  reportViewCleanup = () => {
    window.removeEventListener('focus', refreshIfActive);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

/**
 * Destroy all active Chart.js instances to prevent canvas reuse errors.
 */
function destroyAllCharts() {
  charts.forEach((c) => c.destroy());
  charts.length = 0;
}

/**
 * Render the reports view
 */
export async function renderReports() {
  const container = document.getElementById('view-reports');
  container.classList.add('active');
  attachReportViewListeners();

  container.innerHTML = `
    <div class="header">
      <h1 class="header__title">${renderSymbolIcon('analytics', 'header__title-icon')} Reportes</h1>
    </div>

    <div class="reports-header">
      <button class="period-btn ${reportRangeMode === 'active' ? 'active' : ''}" data-range-mode="active">Periodo Activo</button>
      <button class="period-btn ${reportRangeMode === 'last' ? 'active' : ''}" data-range-mode="last">Último periodo</button>
    </div>

    <div class="report-schedule-card">
      <div class="report-schedule-card__header">
        <div>
          <div class="report-schedule-card__eyebrow">Próximo corte</div>
          <div class="report-schedule-card__status" id="report-schedule-status">Cargando agenda...</div>
        </div>
        <div class="report-schedule-card__actions">
          <button class="report-action-btn report-action-btn--ghost report-action-btn--hidden" id="edit-report-date">Cambiar fecha</button>
          <button class="report-action-btn report-action-btn--ghost" id="generate-report-today">Generar reporte de hoy</button>
        </div>
      </div>

      <div class="report-schedule-card__form">
        <div class="date-input-stack">
          <input type="date" class="report-date-input" id="next-report-date" lang="en-GB" />
          <div class="date-input-display" id="next-report-date-display"></div>
        </div>
        <div class="report-schedule-card__form-actions">
          <button class="report-action-btn report-action-btn--ghost report-action-btn--hidden" id="cancel-report-date-edit">Cancelar</button>
          <button class="report-action-btn" id="save-next-report-date">Guardar fecha</button>
        </div>
      </div>

      <div class="report-schedule-card__hint" id="report-schedule-hint">
        Programa el siguiente corte compartido para todos los usuarios.
      </div>
    </div>

    <!-- General report -->
    <div class="section-title">Reporte General</div>
    <div class="report-range-caption" id="report-range-caption">Cargando periodo...</div>
    <div class="summary-grid" id="summary-grid"></div>

    <div class="chart-card">
      <div class="chart-card__title">Ingresos vs Gastos</div>
      <div class="chart-container">
        <canvas id="chart-bar"></canvas>
      </div>
    </div>

    <div class="chart-card">
      <div class="chart-card__title">Distribución</div>
      <div class="chart-container">
        <canvas id="chart-doughnut"></canvas>
      </div>
    </div>

    <div class="section-title" style="margin-top: var(--space-xl);">Reportes Guardados</div>
    <div class="saved-reports-list" id="saved-reports-list">
      <div class="saved-report-card saved-report-card--empty">Cargando reportes históricos...</div>
    </div>

    <!-- Per-category reports -->
    <div class="section-title" style="margin-top: var(--space-xl);">Reportes por Categoría</div>
    <div class="category-reports" id="category-reports"></div>
  `;

  container.querySelectorAll('[data-range-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      reportRangeMode = btn.dataset.rangeMode;
      container.querySelectorAll('[data-range-mode]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateAllReports();
    });
  });

  container.querySelector('#save-next-report-date')?.addEventListener('click', () => {
    saveNextReportDate().catch((error) => {
      console.error('Save next report date failed:', error);
      showToast(error.message || 'No se pudo guardar la fecha.', 'error');
    });
  });

  container.querySelector('#generate-report-today')?.addEventListener('click', () => {
    generateTodayReport().catch((error) => {
      console.error('Manual report generation failed:', error);
      showToast(error.message || 'No se pudo generar el reporte.', 'error');
    });
  });

  container.querySelector('#edit-report-date')?.addEventListener('click', () => {
    isScheduleEditorVisible = true;
    renderReportSchedule({ nextReportDate: persistedNextReportDate });
  });

  container.querySelector('#cancel-report-date-edit')?.addEventListener('click', () => {
    if (!persistedNextReportDate) return;
    isScheduleEditorVisible = false;
    renderReportSchedule({ nextReportDate: persistedNextReportDate });
  });

  setupDateInputDisplay(
    container.querySelector('#next-report-date'),
    container.querySelector('#next-report-date-display'),
  );

  await loadRemoteReportData({ ensureDue: true });
  await updateAllReports();
}

async function saveNextReportDate() {
  const input = document.getElementById('next-report-date');
  if (!input) return;

  if (!hasRemoteReportAccess()) {
    throw new Error('Los reportes compartidos no están disponibles sin API configurada.');
  }

  const updatedBy = await getSetting('usuario');
  const response = await apiFetch('/api/report-schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nextReportDate: input.value || null,
      updatedBy: updatedBy || 'Usuario',
    }),
  });
  await parseApiResponse(response, 'No se pudo guardar la fecha del próximo reporte.');
  isScheduleEditorVisible = !input.value;
  showToast(input.value ? 'Próximo reporte guardado.' : 'Próximo reporte limpiado.', 'success');
  invalidateRemoteReportCache();
  await loadRemoteReportData({ ensureDue: false, silent: true, force: true });
  await updateAllReports();
}

async function generateTodayReport() {
  if (!hasRemoteReportAccess()) {
    throw new Error('Los reportes compartidos no están disponibles sin API configurada.');
  }

  const generatedBy = await getSetting('usuario');
  const response = await apiFetch('/api/cash-flow-reports/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ generatedBy: generatedBy || 'Usuario' }),
  });
  const payload = await parseApiResponse(response, 'No se pudo generar el reporte de hoy.');
  showToast(`Reporte generado para ${formatDate(payload.report.reportDate)}`, 'success');
  invalidateRemoteReportCache();
  await loadRemoteReportData({ ensureDue: false, silent: true, force: true });
  await updateAllReports();
}

async function loadRemoteReportData({ ensureDue = true, silent = false, force = false } = {}) {
  const statusNode = document.getElementById('report-schedule-status');
  const hintNode = document.getElementById('report-schedule-hint');
  const historyNode = document.getElementById('saved-reports-list');
  const dateInput = document.getElementById('next-report-date');

  if (!statusNode || !hintNode || !historyNode || !dateInput) return;

  if (!hasRemoteReportAccess()) {
    statusNode.textContent = 'Agenda compartida no disponible en este entorno';
    hintNode.textContent = 'Configura la API y autentícate para guardar cortes y ver el histórico compartido.';
    historyNode.innerHTML = '<div class="saved-report-card saved-report-card--empty">Sin conexión al backend de reportes.</div>';
    dateInput.value = '';
    return;
  }

  const { schedule, reports } = await getCachedRemoteReportData({
    ensureDue,
    force,
  });
  latestStoredReports = reports;

  renderReportSchedule(schedule);
  renderSavedReports(latestStoredReports);

  if (!silent && schedule.generatedReportId) {
    showToast(`Se generó el corte pendiente del ${formatDate(schedule.generatedReportDate)}`, 'success');
  }
  if (!silent && schedule.needsAttention) {
    showToast('Designa la fecha de tu próximo reporte', 'info');
  }
}

function renderReportSchedule(schedule) {
  const statusNode = document.getElementById('report-schedule-status');
  const hintNode = document.getElementById('report-schedule-hint');
  const dateInput = document.getElementById('next-report-date');
  const cardNode = document.querySelector('.report-schedule-card');
  const formNode = document.querySelector('.report-schedule-card__form');
  const dateDisplayNode = document.getElementById('next-report-date-display');
  const editButton = document.getElementById('edit-report-date');
  const cancelButton = document.getElementById('cancel-report-date-edit');
  const generateButton = document.getElementById('generate-report-today');
  if (!statusNode || !hintNode || !dateInput || !cardNode || !formNode || !dateDisplayNode || !editButton || !cancelButton || !generateButton) return;

  dateInput.min = getToday();
  persistedNextReportDate = schedule.nextReportDate || null;

  dateInput.value = schedule.nextReportDate || '';
  dateDisplayNode.textContent = schedule.nextReportDate ? formatDateNumeric(schedule.nextReportDate) : 'DD/MM/YYYY';
  dateDisplayNode.classList.toggle('date-input-display--placeholder', !schedule.nextReportDate);

  if (schedule.nextReportDate) {
    cardNode.classList.toggle('report-schedule-card--scheduled', !isScheduleEditorVisible);
    formNode.classList.toggle('report-schedule-card__form--hidden', !isScheduleEditorVisible);
    hintNode.classList.toggle('report-schedule-card__hint--hidden', !isScheduleEditorVisible);
    editButton.classList.toggle('report-action-btn--hidden', isScheduleEditorVisible);
    cancelButton.classList.toggle('report-action-btn--hidden', !isScheduleEditorVisible);
    generateButton.classList.toggle('report-action-btn--hidden', !isScheduleEditorVisible);

    if (isScheduleEditorVisible) {
      statusNode.textContent = `Próximo corte: ${formatDate(schedule.nextReportDate)}`;
      hintNode.textContent = 'Puedes ajustar la fecha mientras el corte aún no se haya generado.';
    } else {
      statusNode.textContent = formatDate(schedule.nextReportDate);
      hintNode.textContent = '';
    }
  } else {
    isScheduleEditorVisible = true;
    cardNode.classList.remove('report-schedule-card--scheduled');
    formNode.classList.remove('report-schedule-card__form--hidden');
    hintNode.classList.remove('report-schedule-card__hint--hidden');
    editButton.classList.add('report-action-btn--hidden');
    cancelButton.classList.add('report-action-btn--hidden');
    generateButton.classList.remove('report-action-btn--hidden');
    statusNode.textContent = 'No hay próxima fecha programada';
    hintNode.textContent = 'Designa la fecha del siguiente corte para que quede disponible para todos los usuarios.';
  }
}

function renderSavedReports(reports) {
  const historyNode = document.getElementById('saved-reports-list');
  if (!historyNode) return;

  if (!reports.length) {
    historyNode.innerHTML = '<div class="saved-report-card saved-report-card--empty">Aún no hay reportes guardados.</div>';
    return;
  }

  historyNode.innerHTML = reports.map((report) => {
    const snapshot = report.snapshotData || {};
    const transactions = snapshot.transactions || [];
    const preview = transactions.slice(0, 12);

    return `
      <details class="saved-report-card">
        <summary class="saved-report-card__summary">
          <div>
            <div class="saved-report-card__title">Corte del ${escapeHtml(formatDate(report.reportDate))}</div>
            <div class="saved-report-card__subtitle">
              Periodo ${escapeHtml(formatDate(report.periodStart))} al ${escapeHtml(formatDate(report.periodEnd))}
            </div>
          </div>
          <div class="saved-report-card__balance ${report.closingBalance >= 0 ? 'text-green' : 'text-red'}">
            ${escapeHtml(formatCurrency(report.closingBalance))}
          </div>
        </summary>
        <div class="saved-report-card__body">
          <div class="saved-report-card__metrics">
            <div class="saved-report-card__metric">
              <span>${escapeHtml(formatCurrency(report.openingBalance))}</span>
              <small>Saldo inicial</small>
            </div>
            <div class="saved-report-card__metric">
              <span class="text-green">${escapeHtml(formatCurrency(report.totalIngresos))}</span>
              <small>Ingresos</small>
            </div>
            <div class="saved-report-card__metric">
              <span class="text-red">${escapeHtml(formatCurrency(report.totalGastos))}</span>
              <small>Gastos</small>
            </div>
            <div class="saved-report-card__metric">
              <span>${escapeHtml(String(report.transactionCount))}</span>
              <small>Movimientos</small>
            </div>
          </div>
          <div class="saved-report-card__meta">
            Generado por ${escapeHtml(snapshot.generatedBy || report.generatedBy || 'Sistema')} · ${escapeHtml(report.generationMode)}
          </div>
          <div class="saved-report-card__transactions">
            ${preview.length ? preview.map((transaction) => `
              <div class="saved-report-transaction">
                <div>
                  <div class="saved-report-transaction__title">${escapeHtml(transaction.descripcion || 'Sin descripción')}</div>
                  <div class="saved-report-transaction__meta">
                    ${escapeHtml(formatDate(transaction.fecha))} · ${escapeHtml(transaction.categoria || 'general')} · ${escapeHtml(getPaymentMethodLabel(transaction.metodoPago || 'efectivo'))}
                  </div>
                </div>
                <div class="saved-report-transaction__amount ${transaction.tipo === 'ingreso' ? 'text-green' : 'text-red'}">
                  ${escapeHtml(formatCurrency(transaction.monto || 0))}
                </div>
              </div>
            `).join('') : '<div class="saved-report-card__empty-state">No hubo movimientos en este periodo.</div>'}
            ${transactions.length > preview.length ? `<div class="saved-report-card__more">${transactions.length - preview.length} movimiento(s) adicional(es) en el snapshot.</div>` : ''}
          </div>
        </div>
      </details>
    `;
  }).join('');
}

/**
 * Refresh both general and per-category reports.
 */
async function updateAllReports() {
  destroyAllCharts();

  const captionNode = document.getElementById('report-range-caption');
  const rangeData = await getCurrentReportRangeData();

  if (captionNode) {
    captionNode.textContent = rangeData.caption;
  }

  renderSummaryCards(rangeData.summary);
  renderBarChart(rangeData.transactions);
  renderDoughnutChart(rangeData.summary);
  renderCategoryReports(rangeData.transactions);
}

async function getCurrentReportRangeData() {
  if (reportRangeMode === 'last') {
    const latestReport = latestStoredReports[0];
    if (!latestReport) {
      return {
        caption: 'Aún no existe un último periodo guardado.',
        summary: {
          totalIngresos: 0,
          totalGastos: 0,
          balance: 0,
          transacciones: 0,
        },
        transactions: [],
      };
    }

    return {
      caption: `Último periodo: ${formatDate(latestReport.periodStart)} al ${formatDate(latestReport.periodEnd)}`,
      summary: {
        totalIngresos: latestReport.totalIngresos,
        totalGastos: latestReport.totalGastos,
        balance: latestReport.closingBalance,
        transacciones: latestReport.transactionCount,
      },
      transactions: latestReport.snapshotData?.transactions || [],
    };
  }

  const { start, end, hasReports } = await getActivePeriodDates();
  const summary = await getSummary(start, end);
  const transactions = await getTransactionsByDateRange(start, end);

  return {
    caption: hasReports
      ? `Periodo activo: ${formatDate(start)} a ${formatDate(end)}`
      : `Periodo activo: desde ${formatDate(start)} hasta ${formatDate(end)}`,
    summary,
    transactions,
  };
}

async function getActivePeriodDates() {
  const end = getToday();
  const latestReport = latestStoredReports[0];

  if (latestReport?.reportDate) {
    const nextDay = new Date(`${latestReport.reportDate}T12:00:00`);
    nextDay.setDate(nextDay.getDate() + 1);
    return {
      start: nextDay.toISOString().split('T')[0],
      end,
      hasReports: true,
    };
  }

  const allTransactions = await getAllTransactions();
  const sortedDates = allTransactions
    .map((transaction) => transaction.fecha)
    .filter(Boolean)
    .sort();

  return {
    start: sortedDates[0] || end,
    end,
    hasReports: false,
  };
}

// ---------------------------------------------------------------------------
// General report helpers
// ---------------------------------------------------------------------------

function renderSummaryCards(summary) {
  const grid = document.getElementById('summary-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="summary-card">
      <div class="summary-card__label">Ingresos</div>
      <div class="summary-card__value text-green">${formatCurrency(summary.totalIngresos)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card__label">Gastos</div>
      <div class="summary-card__value text-red">${formatCurrency(summary.totalGastos)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card__label">Balance</div>
      <div class="summary-card__value ${summary.balance >= 0 ? 'text-green' : 'text-red'}">
        ${formatCurrency(summary.balance)}
      </div>
    </div>
    <div class="summary-card">
      <div class="summary-card__label">Transacciones</div>
      <div class="summary-card__value text-blue">${summary.transacciones}</div>
    </div>
  `;
}

function renderBarChart(transactions) {
  const canvas = document.getElementById('chart-bar');
  if (!canvas) return;

  const data = aggregateByDay(transactions);
  const ctx = canvas.getContext('2d');

  charts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels.length ? data.labels : ['Sin datos'],
      datasets: [
        {
          label: 'Ingresos',
          data: data.ingresos.length ? data.ingresos : [0],
          backgroundColor: REPORT_CHART_COLORS.ingresoFill,
          borderColor: REPORT_CHART_COLORS.ingresoStroke,
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'Gastos',
          data: data.gastos.length ? data.gastos : [0],
          backgroundColor: REPORT_CHART_COLORS.gastoFill,
          borderColor: REPORT_CHART_COLORS.gastoStroke,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: chartBarOptions(),
  }));
}

function renderDoughnutChart(summary) {
  const canvas = document.getElementById('chart-doughnut');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const hasData = summary.totalIngresos > 0 || summary.totalGastos > 0;

  charts.push(new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: hasData ? ['Ingresos', 'Gastos'] : ['Sin datos'],
      datasets: [{
        data: hasData ? [summary.totalIngresos, summary.totalGastos] : [1],
        backgroundColor: hasData
          ? [REPORT_CHART_COLORS.ingresoFill, REPORT_CHART_COLORS.gastoFill]
          : [REPORT_CHART_COLORS.neutralFill],
        borderColor: hasData
          ? [REPORT_CHART_COLORS.ingresoStroke, REPORT_CHART_COLORS.gastoStroke]
          : [REPORT_CHART_COLORS.neutralStroke],
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: REPORT_CHART_COLORS.legend, font: { family: 'Work Sans', size: 13 }, padding: 20 },
        },
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Per-category reports
// ---------------------------------------------------------------------------

const CATEGORY_COLORS = {
  agricultura: { bg: 'rgba(81, 95, 116, 0.65)', border: '#515f74' },
  engorda:     { bg: 'rgba(139, 111, 61, 0.65)', border: '#8b6f3d' },
  sierra:      { bg: 'rgba(30, 41, 59, 0.65)', border: '#1e293b' },
  general:     { bg: 'rgba(107, 114, 128, 0.65)', border: '#6b7280' },
};

function renderCategoryReports(transactions) {
  const wrapper = document.getElementById('category-reports');
  if (!wrapper) return;

  // Group transactions by category
  const grouped = {};
  for (const key of Object.keys(CATEGORIES)) {
    grouped[key] = [];
  }
  for (const t of transactions) {
    const cat = t.categoria || 'general';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  wrapper.innerHTML = '';

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const txs = grouped[key] || [];
    const ingresos = txs.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
    const gastos = txs.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);
    const balance = ingresos - gastos;
    const canvasId = `chart-cat-${key}`;

    const card = document.createElement('div');
    card.className = 'category-report-card';
    card.innerHTML = `
      <div class="category-report-card__header">
        ${renderSymbolIcon(cat.icon, 'category-report-card__emoji')}
        <span class="category-report-card__name">${cat.label}</span>
        <span class="category-report-card__count">${txs.length} mov.</span>
      </div>
      <div class="category-report-card__stats">
        <div class="category-report-card__stat">
          <span class="text-green">${formatCurrency(ingresos)}</span>
          <small>Ingresos</small>
        </div>
        <div class="category-report-card__stat">
          <span class="text-red">${formatCurrency(gastos)}</span>
          <small>Gastos</small>
        </div>
        <div class="category-report-card__stat">
          <span class="${balance >= 0 ? 'text-green' : 'text-red'}">${formatCurrency(balance)}</span>
          <small>Balance</small>
        </div>
      </div>
      <div class="chart-container chart-container--small">
        <canvas id="${canvasId}"></canvas>
      </div>
    `;
    wrapper.appendChild(card);

    // Render a small bar chart for this category
    renderCategoryBarChart(canvasId, txs, CATEGORY_COLORS[key] || CATEGORY_COLORS.general);
  }
}

function renderCategoryBarChart(canvasId, transactions, colors) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const data = aggregateByDay(transactions);
  const ctx = canvas.getContext('2d');

  charts.push(new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels.length ? data.labels : ['—'],
      datasets: [
        {
          label: 'Ingresos',
          data: data.ingresos.length ? data.ingresos : [0],
          backgroundColor: REPORT_CHART_COLORS.ingresoFill,
          borderColor: REPORT_CHART_COLORS.ingresoStroke,
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Gastos',
          data: data.gastos.length ? data.gastos : [0],
          backgroundColor: colors.bg,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 4,
        },
      ],
    },
    options: chartBarOptions(true),
  }));
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function aggregateByDay(transactions) {
  const daily = {};
  for (const t of transactions) {
    if (!daily[t.fecha]) daily[t.fecha] = { ingresos: 0, gastos: 0 };
    if (t.tipo === 'ingreso') {
      daily[t.fecha].ingresos += t.monto;
    } else {
      daily[t.fecha].gastos += t.monto;
    }
  }
  const sorted = Object.keys(daily).sort();
  return {
    labels: sorted.map((d) => {
      const date = new Date(d + 'T12:00:00');
      return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    }),
    ingresos: sorted.map((d) => daily[d].ingresos),
    gastos: sorted.map((d) => daily[d].gastos),
  };
}

function chartBarOptions(compact = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: !compact,
        labels: { color: REPORT_CHART_COLORS.legend, font: { family: 'Work Sans', size: 12 } },
      },
    },
    scales: {
      x: {
        ticks: { color: REPORT_CHART_COLORS.axis, font: { size: compact ? 9 : 10 } },
        grid: { color: REPORT_CHART_COLORS.grid },
      },
      y: {
        ticks: {
          color: REPORT_CHART_COLORS.axis,
          font: { size: compact ? 9 : 10 },
          callback: (v) => '$' + v.toLocaleString(),
        },
        grid: { color: REPORT_CHART_COLORS.grid },
      },
    },
  };
}
