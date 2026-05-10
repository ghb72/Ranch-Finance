/**
 * home.js - Home screen view
 * Shows balance, income/expense buttons, and recent transactions.
 * Supports long-press to delete transactions.
 */
import {
  getAllTransactions,
  getTransactionsByDateRange,
  getSummary,
  deleteTransaction,
} from '../db.js';
import { getCachedCashFlowReports } from '../reportCache.js';
import {
  formatCurrency,
  formatDate,
  formatRelativeDate,
  showToast,
  getCategoryLabel,
  getToday,
} from '../utils.js';
import { navigate } from '../router.js';

const HOME_RANGE_OPTIONS = {
  active: {
    label: 'Periodo activo',
    balanceLabel: 'Balance del periodo activo',
    transactionsTitle: 'Transacciones del periodo activo',
  },
  last: {
    label: 'Ultimo periodo',
    balanceLabel: 'Balance del ultimo periodo',
    transactionsTitle: 'Transacciones del ultimo periodo',
  },
  threeMonths: {
    label: 'Tres meses',
    balanceLabel: 'Balance ultimos 3 meses',
    transactionsTitle: 'Transacciones ultimos 3 meses',
  },
  sixMonths: {
    label: 'Seis meses',
    balanceLabel: 'Balance ultimos 6 meses',
    transactionsTitle: 'Transacciones ultimos 6 meses',
  },
};

let homeRangeMode = 'active';
let latestStoredReports = [];
let homeRefreshVersion = 0;

async function loadLatestStoredReports() {
  try {
    latestStoredReports = await getCachedCashFlowReports();
  } catch (error) {
    console.error('Home report history load failed:', error);
    latestStoredReports = [];
  }
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
      caption: `Periodo activo: ${formatDate(nextDay.toISOString().split('T')[0])} a ${formatDate(end)}`,
    };
  }

  const allTransactions = await getAllTransactions();
  const sortedDates = allTransactions
    .map((transaction) => transaction.fecha)
    .filter(Boolean)
    .sort();
  const start = sortedDates[0] || end;

  return {
    start,
    end,
    caption: `Periodo activo: ${formatDate(start)} a ${formatDate(end)}`,
  };
}

function getRollingRange(months) {
  const endDate = new Date(`${getToday()}T12:00:00`);
  const startDate = new Date(endDate);
  startDate.setMonth(startDate.getMonth() - months);

  const start = startDate.toISOString().split('T')[0];
  const end = endDate.toISOString().split('T')[0];

  return {
    start,
    end,
    caption: `${months === 3 ? 'Ultimos 3 meses' : 'Ultimos 6 meses'}: ${formatDate(start)} a ${formatDate(end)}`,
  };
}

async function getHomeRangeData() {
  if (homeRangeMode === 'last') {
    const latestReport = latestStoredReports[0];
    if (!latestReport) {
      return {
        balance: {
          ingresos: 0,
          gastos: 0,
          balance: 0,
        },
        transactions: [],
        caption: 'Aun no existe un ultimo periodo guardado.',
      };
    }

    return {
      balance: {
        ingresos: latestReport.totalIngresos,
        gastos: latestReport.totalGastos,
        balance: latestReport.closingBalance,
      },
      transactions: latestReport.snapshotData?.transactions || [],
      caption: `Ultimo periodo: ${formatDate(latestReport.periodStart)} a ${formatDate(latestReport.periodEnd)}`,
    };
  }

  if (homeRangeMode === 'threeMonths' || homeRangeMode === 'sixMonths') {
    const { start, end, caption } = getRollingRange(homeRangeMode === 'threeMonths' ? 3 : 6);
    return {
      balance: await getSummary(start, end),
      transactions: await getTransactionsByDateRange(start, end),
      caption,
    };
  }

  const { start, end, caption } = await getActivePeriodDates();
  return {
    balance: await getSummary(start, end),
    transactions: await getTransactionsByDateRange(start, end),
    caption,
  };
}

function renderHomeSelector(container) {
  container.querySelectorAll('[data-home-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.homeRange === homeRangeMode);
  });
}

function renderHomeRangeContent(rangeData) {
  const selectedOption = HOME_RANGE_OPTIONS[homeRangeMode];
  const recent = rangeData.transactions.slice(0, 20);

  return `
    <div class="balance-card">
      <div class="balance-card__label">${selectedOption.balanceLabel}</div>
      <div class="balance-card__caption">${rangeData.caption}</div>
      <div class="balance-card__amount ${rangeData.balance.balance >= 0 ? 'balance-card__amount--positive' : 'balance-card__amount--negative'}">
        ${formatCurrency(rangeData.balance.balance)}
      </div>
      <div class="balance-card__row">
        <div class="balance-card__item">
          <div class="balance-card__item-label">Ingresos</div>
          <div class="balance-card__item-value balance-card__item-value--green">
            ${formatCurrency(rangeData.balance.totalIngresos ?? rangeData.balance.ingresos)}
          </div>
        </div>
        <div class="balance-card__item">
          <div class="balance-card__item-label">Gastos</div>
          <div class="balance-card__item-value balance-card__item-value--red">
            ${formatCurrency(rangeData.balance.totalGastos ?? rangeData.balance.gastos)}
          </div>
        </div>
      </div>
    </div>

    <div class="action-buttons">
      <button type="button" class="action-btn action-btn--ingreso" id="btn-income">
        <span class="action-btn__icon">💰</span>
        <span>Ingreso</span>
      </button>
      <button type="button" class="action-btn action-btn--gasto" id="btn-expense">
        <span class="action-btn__icon">💸</span>
        <span>Gasto</span>
      </button>
    </div>

    ${recent.length > 0 ? `
      <div class="section-title">${selectedOption.transactionsTitle}</div>
      <div class="report-range-caption">Mostrando ${recent.length} de ${rangeData.transactions.length} transacciones</div>
      <div class="transaction-list" id="transaction-list">
        ${recent.map((t) => renderTransactionItem(t)).join('')}
      </div>
    ` : `
      <div class="empty-state">
        <div class="empty-state__icon">📋</div>
        <div class="empty-state__text">No hay transacciones para este rango.<br>Prueba con otro selector o registra nuevos movimientos.</div>
      </div>
    `}
  `;
}

async function refreshHomeContent(container) {
  const refreshVersion = ++homeRefreshVersion;
  const content = container.querySelector('#home-range-content');
  if (!content) return;

  content.innerHTML = '<div class="loading-state">Cargando...</div>';
  renderHomeSelector(container);

  await loadLatestStoredReports();
  if (refreshVersion !== homeRefreshVersion) return;

  const rangeData = await getHomeRangeData();
  if (refreshVersion !== homeRefreshVersion) return;

  content.innerHTML = renderHomeRangeContent(rangeData);

  container.querySelector('#btn-income')?.addEventListener('click', () => {
    navigate('form', { tipo: 'ingreso' });
  });

  container.querySelector('#btn-expense')?.addEventListener('click', () => {
    navigate('form', { tipo: 'gasto' });
  });

  setupTransactionActions(container);
}

/**
 * Render the home view
 */
export async function renderHome() {
  const container = document.getElementById('view-home');
  container.classList.add('active');

  container.innerHTML = `
    <div class="header">
      <div class="header__logo">🐄</div>
      <h1 class="header__title">RanchoFinanzas</h1>
    </div>
    <div class="reports-header" style="margin-bottom: var(--space-lg);">
      ${Object.entries(HOME_RANGE_OPTIONS).map(([value, option]) => `
        <button type="button" class="period-btn ${homeRangeMode === value ? 'active' : ''}" data-home-range="${value}">${option.label}</button>
      `).join('')}
    </div>

    <div id="home-range-content">
      <div class="loading-state">Cargando...</div>
    </div>
  `;

  renderHomeSelector(container);

  container.querySelectorAll('[data-home-range]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      homeRangeMode = button.dataset.homeRange;
      renderHomeSelector(container);
      await refreshHomeContent(container);
    });
  });

  await refreshHomeContent(container);
}

/**
 * Render a single transaction list item
 */
function renderTransactionItem(t) {
  const icon = t.tipo === 'ingreso' ? '📥' : '📤';
  const desc = t.descripcion || (t.tipo === 'ingreso' ? 'Ingreso' : 'Gasto');
  const sign = t.tipo === 'ingreso' ? '+' : '-';
  const categoryTag = t.categoria ? getCategoryLabel(t.categoria) : '';
  const isReadonly = !t.localId;
  const syncIcon = t.synced === 0
    ? '<span class="sync-badge sync-badge--pending">⏳</span>'
    : '';

  return `
    <div class="transaction-item ${isReadonly ? 'transaction-item--readonly' : ''}" ${t.localId ? `data-local-id="${t.localId}"` : ''}>
      <div class="transaction-item__icon transaction-item__icon--${t.tipo}">
        ${icon}
      </div>
      <div class="transaction-item__info">
        <div class="transaction-item__desc">${desc}</div>
        <div class="transaction-item__date">
          ${formatRelativeDate(t.fecha)} · ${categoryTag}
          ${syncIcon}
          ${isReadonly ? '<span class="sync-badge">Historico</span>' : ''}
        </div>
      </div>
      <div class="transaction-item__amount transaction-item__amount--${t.tipo}">
        ${sign}${formatCurrency(t.monto)}
      </div>
    </div>
  `;
}

/**
 * Setup long-press to delete on transaction items
 */
function setupTransactionActions(container) {
  const list = container.querySelector('#transaction-list');
  if (!list) return;

  let pressTimer = null;

  list.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.transaction-item');
    if (!item) return;

    pressTimer = setTimeout(() => {
      confirmDelete(item);
    }, 600);
  });

  const cancelPress = () => clearTimeout(pressTimer);
  list.addEventListener('pointerup', cancelPress);
  list.addEventListener('pointercancel', cancelPress);
  list.addEventListener('pointermove', (e) => {
    if (Math.abs(e.movementY) > 5 || Math.abs(e.movementX) > 5) {
      cancelPress();
    }
  });
}

/**
 * Show delete confirmation modal for a transaction
 */
function confirmDelete(itemEl) {
  const localId = Number(itemEl.dataset.localId);
  if (!localId) return;

  itemEl.classList.add('transaction-item--deleting');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal__title">🗑️ ¿Eliminar transacción?</h3>
      <p style="text-align:center; color: var(--color-text-secondary); margin-bottom: var(--space-lg); font-size: var(--font-size-base);">
        Esta acción no se puede deshacer.
      </p>
      <div style="display:flex; gap: var(--space-md);">
        <button class="modal__btn" id="delete-cancel" style="flex:1; background: var(--color-bg-card); color: var(--color-text-primary);">Cancelar</button>
        <button class="modal__btn" id="delete-confirm" style="flex:1; background: var(--color-accent-red);">Eliminar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeModal = () => {
    itemEl.classList.remove('transaction-item--deleting');
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('#delete-cancel').addEventListener('click', closeModal);

  overlay.querySelector('#delete-confirm').addEventListener('click', async () => {
    try {
      await deleteTransaction(localId);
      itemEl.style.transition = 'all 0.3s ease';
      itemEl.style.transform = 'translateX(100%)';
      itemEl.style.opacity = '0';
      overlay.classList.remove('active');
      setTimeout(() => {
        overlay.remove();
        renderHome(); // Refresh view with updated balance
      }, 300);
      showToast('🗑️ Transacción marcada para eliminar', 'success');
    } catch (err) {
      showToast('Error al eliminar', 'error');
      closeModal();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}
