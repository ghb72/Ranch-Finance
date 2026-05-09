/**
 * settings.js - Settings view
 * User name, sync status, connectivity and local summary.
 */
import { getSetting, setSetting, getPendingTransactions, getAllTransactions, getSyncStatusSnapshot, getTotalBalance } from '../db.js';
import { logoutAndClearLocalData } from '../auth.js';
import { showToast, formatCurrency } from '../utils.js';

/**
 * Render the settings view
 */
export async function renderSettings() {
  const container = document.getElementById('view-settings');
  container.classList.add('active');

  const currentUser = (await getSetting('usuario')) || 'Sin nombre';
  const pending = await getPendingTransactions();
  const allTransactions = await getAllTransactions();
  const syncSnapshot = await getSyncStatusSnapshot();
  const balance = await getTotalBalance();

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
      <div class="settings-item">
        <div class="settings-item__left">
          <span class="settings-item__icon">🧭</span>
          <span class="settings-item__label">Versión remota</span>
        </div>
        <span class="settings-item__value">${syncSnapshot.lastKnownVersion || 'Sin sync'}</span>
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

    <div class="section-title">Sesión</div>
    <div class="settings-group">
      <button class="settings-action settings-action--danger" id="setting-logout" type="button">
        <span class="settings-action__icon">🔒</span>
        <span class="settings-action__label">Salir de la sesión</span>
      </button>
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

    <div class="modal-overlay" id="logout-modal">
      <div class="modal">
        <h3 class="modal__title">Cerrar sesión</h3>
        <p class="modal__text">Esto cerrará la sesión y borrará todos los datos locales del dispositivo.</p>
        <p class="modal__error" style="margin-top: 0;">Se eliminarán transacciones, ajustes, caché y cualquier dato guardado offline.</p>
        <div class="modal__actions">
          <button class="modal__btn modal__btn--secondary" id="logout-cancel" type="button">Cancelar</button>
          <button class="modal__btn modal__btn--danger" id="logout-confirm" type="button">Borrar y salir</button>
        </div>
      </div>
    </div>
  `;

  setupSettingsListeners(container);
}

/**
 * Attach event listeners for settings actions.
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

  container.querySelector('#setting-logout').addEventListener('click', () => {
    document.getElementById('logout-modal').classList.add('active');
  });

  container.querySelector('#logout-cancel').addEventListener('click', () => {
    document.getElementById('logout-modal').classList.remove('active');
  });

  container.querySelector('#logout-confirm').addEventListener('click', async () => {
    const confirmButton = document.getElementById('logout-confirm');
    const cancelButton = document.getElementById('logout-cancel');

    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = 'Borrando...';

    try {
      await logoutAndClearLocalData();
      window.location.reload();
    } catch (error) {
      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = 'Borrar y salir';
      showToast(error.message || 'No se pudo borrar la sesión local', 'error');
    }
  });

  // Close modals on overlay click
  container.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
      }
    });
  });
}
