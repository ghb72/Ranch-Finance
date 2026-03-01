/**
 * settings.js - Settings view
 * User name, sync status, API URL configuration, and manual sync trigger.
 */
import { getSetting, setSetting, getPendingTransactions, getAllTransactions, deleteTransaction } from '../db.js';
import { showToast, formatCurrency } from '../utils.js';
import { syncPendingTransactions, setApiUrl, pullRemoteTransactions } from '../sync.js';
import { getTotalBalance } from '../db.js';
import db from '../db.js';

/**
 * Render the settings view
 */
export async function renderSettings() {
  const container = document.getElementById('view-settings');
  container.classList.add('active');

  const currentUser = (await getSetting('usuario')) || 'Sin nombre';
  const pending = await getPendingTransactions();
  const allTransactions = await getAllTransactions();
  const balance = await getTotalBalance();
  const apiUrl = localStorage.getItem('api_url') || '';

  container.innerHTML = `
    <div class="header">
      <h1 class="header__title">⚙️ Configuración</h1>
    </div>

    <div class="section-title">Usuario</div>
    <div class="settings-group">
      <div class="settings-item" id="setting-user">
        <div class="settings-item__left">
          <span class="settings-item__icon">👤</span>
          <span class="settings-item__label">Nombre</span>
        </div>
        <span class="settings-item__value" id="user-display">${currentUser}</span>
      </div>
    </div>

    <div class="section-title">Sincronización</div>
    <div class="settings-group">
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">${pending.length > 0 ? '⏳' : '✅'}</span>
          <span class="settings-item__label">Estado</span>
        </div>
        <span class="settings-item__value" id="sync-status">
          ${pending.length > 0 ? `${pending.length} pendiente(s)` : 'Todo sincronizado'}
        </span>
      </div>
      <div class="settings-item" id="setting-sync">
        <div class="settings-item__left">
          <span class="settings-item__icon">🔄</span>
          <span class="settings-item__label">Sincronizar ahora</span>
        </div>
        <span class="settings-item__value">→</span>
      </div>
      <div class="settings-item" id="setting-api">
        <div class="settings-item__left">
          <span class="settings-item__icon">🌐</span>
          <span class="settings-item__label">URL del servidor</span>
        </div>
        <span class="settings-item__value" style="max-width:140px; overflow:hidden; text-overflow:ellipsis;" id="api-display">
          ${apiUrl || 'No configurado'}
        </span>
      </div>
    </div>

    <div class="section-title">Conexión</div>
    <div class="settings-group">
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">${navigator.onLine ? '🟢' : '🔴'}</span>
          <span class="settings-item__label">Internet</span>
        </div>
        <span class="settings-item__value">${navigator.onLine ? 'Conectado' : 'Sin conexión'}</span>
      </div>
    </div>

    <div class="section-title">Datos</div>
    <div class="settings-group">
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">📊</span>
          <span class="settings-item__label">Transacciones</span>
        </div>
        <span class="settings-item__value">${allTransactions.length}</span>
      </div>
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">💰</span>
          <span class="settings-item__label">Balance local</span>
        </div>
        <span class="settings-item__value ${balance.balance >= 0 ? 'text-green' : 'text-red'}">
          ${formatCurrency(balance.balance)}
        </span>
      </div>
      <div class="settings-item" id="setting-clear" style="color: var(--color-accent-red);">
        <div class="settings-item__left">
          <span class="settings-item__icon">🗑️</span>
          <span class="settings-item__label">Borrar todos los datos</span>
        </div>
        <span class="settings-item__value">→</span>
      </div>
    </div>

    <div class="section-title">Acerca de</div>
    <div class="settings-group">
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">🐄</span>
          <span class="settings-item__label">RanchoFinanzas</span>
        </div>
        <span class="settings-item__value">v1.0.0</span>
      </div>
    </div>

    <!-- Modals -->
    <div class="modal-overlay" id="user-modal">
      <div class="modal">
        <h3 class="modal__title">👤 ¿Cómo te llamas?</h3>
        <input
          type="text"
          class="modal__input"
          id="input-username"
          placeholder="Tu nombre"
          value="${currentUser !== 'Sin nombre' ? currentUser : ''}"
          maxlength="30"
        />
        <button class="modal__btn" id="btn-save-user">Guardar</button>
      </div>
    </div>

    <div class="modal-overlay" id="api-modal">
      <div class="modal">
        <h3 class="modal__title">🌐 URL del Servidor</h3>
        <p style="text-align:center; color: var(--color-text-secondary); margin-bottom: var(--space-md); font-size: var(--font-size-sm);">
          URL del backend para sincronizar con Google Sheets
        </p>
        <input
          type="url"
          class="modal__input"
          id="input-api-url"
          placeholder="https://tu-backend.onrender.com"
          value="${apiUrl}"
        />
        <button class="modal__btn" id="btn-save-api">Guardar</button>
      </div>
    </div>
  `;

  setupSettingsListeners(container);
}

/**
 * Attach event listeners for settings actions
 */
function setupSettingsListeners(container) {
  // Edit user name
  container.querySelector('#setting-user').addEventListener('click', () => {
    document.getElementById('user-modal').classList.add('active');
    document.getElementById('input-username').focus();
  });

  container.querySelector('#btn-save-user').addEventListener('click', async () => {
    const name = document.getElementById('input-username').value.trim();
    if (name) {
      await setSetting('usuario', name);
      document.getElementById('user-display').textContent = name;
      document.getElementById('user-modal').classList.remove('active');
      showToast('✅ Nombre guardado');
    } else {
      showToast('Ingresa un nombre', 'error');
    }
  });

  // Edit API URL
  container.querySelector('#setting-api').addEventListener('click', () => {
    document.getElementById('api-modal').classList.add('active');
    document.getElementById('input-api-url').focus();
  });

  container.querySelector('#btn-save-api').addEventListener('click', () => {
    const url = document.getElementById('input-api-url').value.trim();
    // Remove trailing slash
    const cleanUrl = url.replace(/\/+$/, '');
    setApiUrl(cleanUrl);
    document.getElementById('api-display').textContent = cleanUrl || 'No configurado';
    document.getElementById('api-modal').classList.remove('active');
    showToast(cleanUrl ? '✅ URL guardada' : '✅ URL eliminada');
  });

  // Close modals on overlay click
  container.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });

  // Manual sync
  container.querySelector('#setting-sync').addEventListener('click', async () => {
    const apiUrl = localStorage.getItem('api_url');
    if (!apiUrl) {
      showToast('Configura la URL del servidor primero', 'error');
      return;
    }
    if (!navigator.onLine) {
      showToast('🔴 Sin conexión a internet', 'error');
      return;
    }

    const statusEl = document.getElementById('sync-status');
    statusEl.textContent = 'Sincronizando...';

    try {
      const result = await syncPendingTransactions();
      const parts = [];
      if (result.synced > 0) parts.push(`⬆ ${result.synced} enviada(s)`);
      if (result.pulled > 0) parts.push(`⬇ ${result.pulled} recibida(s)`);

      if (parts.length > 0) {
        showToast(`✅ ${parts.join(', ')}`, 'success');
        statusEl.textContent = result.pending > 0 ? `${result.pending} pendiente(s)` : 'Todo sincronizado';
      } else if (result.pending > 0) {
        showToast('⚠️ No se pudo sincronizar', 'error');
        statusEl.textContent = `${result.pending} pendiente(s)`;
      } else {
        showToast('✅ Todo está sincronizado', 'success');
        statusEl.textContent = 'Todo sincronizado';
      }
      // Refresh settings to show updated counts
      renderSettings();
    } catch (err) {
      showToast('Error de sincronización', 'error');
      statusEl.textContent = 'Error';
    }
  });

  // Clear all data
  container.querySelector('#setting-clear').addEventListener('click', () => {
    confirmClearData();
  });
}

/**
 * Show confirmation to clear all local data
 */
function confirmClearData() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal__title">🗑️ ¿Borrar todos los datos?</h3>
      <p style="text-align:center; color: var(--color-text-secondary); margin-bottom: var(--space-lg); font-size: var(--font-size-base);">
        Se eliminarán todas las transacciones del dispositivo. Los datos en Google Sheets no se afectan.
      </p>
      <div style="display:flex; gap: var(--space-md);">
        <button class="modal__btn" id="clear-cancel" style="flex:1; background: var(--color-bg-card); color: var(--color-text-primary);">Cancelar</button>
        <button class="modal__btn" id="clear-confirm" style="flex:1; background: var(--color-accent-red);">Borrar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.classList.remove('active');
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.querySelector('#clear-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  overlay.querySelector('#clear-confirm').addEventListener('click', async () => {
    try {
      await db.transactions.clear();
      showToast('🗑️ Datos eliminados', 'success');
      closeModal();
      renderSettings();
    } catch (err) {
      showToast('Error al borrar datos', 'error');
      closeModal();
    }
  });
}
