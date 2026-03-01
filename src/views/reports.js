/**
 * reports.js - Reports and charts view
 * Shows a general summary with charts, followed by per-category breakdowns.
 */
import Chart from 'chart.js/auto';
import { getTransactionsByDateRange, getSummary } from '../db.js';
import { formatCurrency, getPeriodDates, CATEGORIES } from '../utils.js';

const charts = [];
let currentPeriod = 'month';

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

  container.innerHTML = `
    <div class="header">
      <h1 class="header__title">📊 Reportes</h1>
    </div>

    <div class="reports-header">
      <button class="period-btn ${currentPeriod === 'day' ? 'active' : ''}" data-period="day">Hoy</button>
      <button class="period-btn ${currentPeriod === 'week' ? 'active' : ''}" data-period="week">Semana</button>
      <button class="period-btn ${currentPeriod === 'month' ? 'active' : ''}" data-period="month">Mes</button>
      <button class="period-btn ${currentPeriod === 'year' ? 'active' : ''}" data-period="year">Año</button>
    </div>

    <!-- General report -->
    <div class="section-title">Reporte General</div>
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

    <!-- Per-category reports -->
    <div class="section-title" style="margin-top: var(--space-xl);">Reportes por Categoría</div>
    <div class="category-reports" id="category-reports"></div>
  `;

  container.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentPeriod = btn.dataset.period;
      container.querySelectorAll('.period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      updateAllReports();
    });
  });

  await updateAllReports();
}

/**
 * Refresh both general and per-category reports.
 */
async function updateAllReports() {
  destroyAllCharts();

  const { start, end } = getPeriodDates(currentPeriod);
  const summary = await getSummary(start, end);
  const transactions = await getTransactionsByDateRange(start, end);

  renderSummaryCards(summary);
  renderBarChart(transactions);
  renderDoughnutChart(summary);
  renderCategoryReports(transactions);
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
          backgroundColor: 'rgba(0, 214, 143, 0.7)',
          borderColor: '#00d68f',
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: 'Gastos',
          data: data.gastos.length ? data.gastos : [0],
          backgroundColor: 'rgba(255, 107, 107, 0.7)',
          borderColor: '#ff6b6b',
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
          ? ['rgba(0, 214, 143, 0.8)', 'rgba(255, 107, 107, 0.8)']
          : ['rgba(90, 92, 114, 0.3)'],
        borderColor: hasData ? ['#00d68f', '#ff6b6b'] : ['rgba(90,92,114,0.5)'],
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
          labels: { color: '#8b8da3', font: { family: 'Inter', size: 13 }, padding: 20 },
        },
      },
    },
  }));
}

// ---------------------------------------------------------------------------
// Per-category reports
// ---------------------------------------------------------------------------

const CATEGORY_COLORS = {
  agricultura: { bg: 'rgba(76, 175, 80, 0.7)', border: '#4caf50' },
  engorda:     { bg: 'rgba(255, 152, 0, 0.7)', border: '#ff9800' },
  sierra:      { bg: 'rgba(33, 150, 243, 0.7)', border: '#2196f3' },
  general:     { bg: 'rgba(156, 39, 176, 0.7)', border: '#9c27b0' },
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
        <span class="category-report-card__emoji">${cat.emoji}</span>
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
          backgroundColor: 'rgba(0, 214, 143, 0.6)',
          borderColor: '#00d68f',
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
        labels: { color: '#8b8da3', font: { family: 'Inter', size: 12 } },
      },
    },
    scales: {
      x: {
        ticks: { color: '#5a5c72', font: { size: compact ? 9 : 10 } },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      y: {
        ticks: {
          color: '#5a5c72',
          font: { size: compact ? 9 : 10 },
          callback: (v) => '$' + v.toLocaleString(),
        },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
    },
  };
}
