/**
 * home.js - Home screen view
 * Shows balance, income/expense buttons, and recent transactions.
 * Supports long-press to delete transactions.
 */
import { getAllTransactions, getTotalBalance, deleteTransaction } from '../db.js';
import { formatCurrency, formatRelativeDate, showToast, getPaymentMethodLabel, getCategoryLabel } from '../utils.js';
import { navigate } from '../router.js';

/**
 * Render the home view
 */
export async function renderHome() {
  const container = document.getElementById('view-home');
  container.classList.add('active');

  // Show loading state
  container.innerHTML = `
    <div class="header">
      <div class="header__logo">🐄</div>
      <h1 class="header__title">RanchoFinanzas</h1>
    </div>
    <div class="loading-state">Cargando...</div>
  `;

  const balance = await getTotalBalance();
  const transactions = await getAllTransactions();
  const recent = transactions.slice(0, 20);

  container.innerHTML = `
    <div class="header">
      <div class="header__logo">🐄</div>
      <h1 class="header__title">RanchoFinanzas</h1>
    </div>

    <div class="balance-card">
      <div class="balance-card__label">Balance Total</div>
      <div class="balance-card__amount ${balance.balance >= 0 ? 'balance-card__amount--positive' : 'balance-card__amount--negative'}">
        ${formatCurrency(balance.balance)}
      </div>
      <div class="balance-card__row">
        <div class="balance-card__item">
          <div class="balance-card__item-label">Ingresos</div>
          <div class="balance-card__item-value balance-card__item-value--green">
            ${formatCurrency(balance.ingresos)}
          </div>
        </div>
        <div class="balance-card__item">
          <div class="balance-card__item-label">Gastos</div>
          <div class="balance-card__item-value balance-card__item-value--red">
            ${formatCurrency(balance.gastos)}
          </div>
        </div>
      </div>
    </div>

    <div class="action-buttons">
      <button class="action-btn action-btn--ingreso" id="btn-income">
        <span class="action-btn__icon">💰</span>
        <span>Ingreso</span>
      </button>
      <button class="action-btn action-btn--gasto" id="btn-expense">
        <span class="action-btn__icon">💸</span>
        <span>Gasto</span>
      </button>
    </div>

    ${recent.length > 0 ? `
      <div class="section-title">Últimas Transacciones</div>
      <div class="transaction-list" id="transaction-list">
        ${recent.map((t) => renderTransactionItem(t)).join('')}
      </div>
    ` : `
      <div class="empty-state">
        <div class="empty-state__icon">📋</div>
        <div class="empty-state__text">No hay transacciones aún.<br>¡Registra tu primer ingreso o gasto!</div>
      </div>
    `}
  `;

  // Event listeners
  container.querySelector('#btn-income').addEventListener('click', () => {
    navigate('form', { tipo: 'ingreso' });
  });

  container.querySelector('#btn-expense').addEventListener('click', () => {
    navigate('form', { tipo: 'gasto' });
  });

  // Long-press to delete transaction items
  setupTransactionActions(container);
}

/**
 * Render a single transaction list item
 */
function renderTransactionItem(t) {
  const icon = t.tipo === 'ingreso' ? '📥' : '📤';
  const desc = t.descripcion || (t.tipo === 'ingreso' ? 'Ingreso' : 'Gasto');
  const sign = t.tipo === 'ingreso' ? '+' : '-';
  const categoryTag = t.categoria ? getCategoryLabel(t.categoria) : '';
  const syncIcon = t.syncStatus === 'pending'
    ? '<span class="sync-badge sync-badge--pending">⏳</span>'
    : '';

  return `
    <div class="transaction-item" data-local-id="${t.localId}">
      <div class="transaction-item__icon transaction-item__icon--${t.tipo}">
        ${icon}
      </div>
      <div class="transaction-item__info">
        <div class="transaction-item__desc">${desc}</div>
        <div class="transaction-item__date">
          ${formatRelativeDate(t.fecha)} · ${categoryTag}
          ${syncIcon}
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
      showToast('🗑️ Transacción eliminada', 'success');
    } catch (err) {
      showToast('Error al eliminar', 'error');
      closeModal();
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
}
