/**
 * form.js - Transaction form view
 * Handles income and expense form with photo capture.
 * Optimized for quick entry with large touch targets.
 */
import { addTransaction } from '../db.js';
import { generateId, getToday, showToast } from '../utils.js';
import { navigate } from '../router.js';
import { getSetting } from '../db.js';
import { registerBackgroundSync } from '../sync.js';

let photoData = null;

/**
 * Render the form view
 */
export async function renderForm(params = {}) {
  const container = document.getElementById('view-form');
  container.classList.add('active');

  const tipo = params.tipo || 'ingreso';
  const isIngreso = tipo === 'ingreso';
  const currentUser = (await getSetting('usuario')) || 'Usuario';

  photoData = null;

  container.innerHTML = `
    <div class="form-view">
      <div class="form-header">
        <button class="form-header__back" id="form-back">←</button>
        <h2 class="form-header__title form-header__title--${tipo}">
          ${isIngreso ? '💰 Nuevo Ingreso' : '💸 Nuevo Gasto'}
        </h2>
      </div>

      <form id="transaction-form" novalidate>
        <div class="form-group">
          <label class="form-group__label">Monto *</label>
          <input
            type="number"
            class="form-group__input form-group__input--amount ${tipo}"
            id="input-monto"
            placeholder="$0"
            inputmode="decimal"
            step="0.01"
            min="0.01"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-group__label">Fecha</label>
          <input
            type="date"
            class="form-group__input"
            id="input-fecha"
            value="${getToday()}"
            max="${getToday()}"
          />
        </div>

        <div class="form-group">
          <label class="form-group__label">Descripción</label>
          <textarea
            class="form-group__textarea"
            id="input-descripcion"
            placeholder="${isIngreso ? 'Ej: Venta de maíz, leche...' : 'Ej: Diésel, jornales, forraje...'}"
            rows="2"
            maxlength="200"
          ></textarea>
        </div>

        <div class="form-group">
          <label class="form-group__label">Categoría</label>
          <select class="form-group__select" id="input-categoria">
            <option value="agricultura">🌾 Agricultura</option>
            <option value="engorda">🐄 Engorda</option>
            <option value="sierra">⛰️ Ganado en Sierra</option>
            <option value="general" selected>🏠 Gastos Generales / Casa</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-group__label">Método de Pago</label>
          <select class="form-group__select" id="input-metodo">
            <option value="efectivo" selected>💵 Efectivo</option>
            <option value="transferencia">🏦 Transferencia</option>
            <option value="tarjeta">💳 Tarjeta</option>
            <option value="cheque">📝 Cheque</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-group__label">Comprobante (Opcional)</label>
          <input type="file" id="input-photo" accept="image/*" capture="environment" class="hidden" />
          <button type="button" class="photo-btn" id="btn-photo">
            <span class="photo-btn__icon">📷</span>
            <span>Tomar foto del ticket</span>
          </button>
          <img id="photo-preview" class="photo-preview hidden" alt="Preview" />
        </div>

        <input type="hidden" id="input-tipo" value="${tipo}" />

        <button type="submit" class="submit-btn submit-btn--${tipo}" id="btn-submit">
          ✅ Guardar ${isIngreso ? 'Ingreso' : 'Gasto'}
        </button>
      </form>
    </div>
  `;

  setupFormListeners(container, tipo, currentUser);
}

/**
 * Attach all form event listeners
 */
function setupFormListeners(container, tipo, currentUser) {
  const isIngreso = tipo === 'ingreso';

  // Back button
  container.querySelector('#form-back').addEventListener('click', () => {
    navigate('home');
  });

  // Photo capture
  const photoInput = container.querySelector('#input-photo');
  const photoBtn = container.querySelector('#btn-photo');
  const photoPreview = container.querySelector('#photo-preview');

  photoBtn.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Limit file size to 2MB
    if (file.size > 2 * 1024 * 1024) {
      showToast('La imagen es muy grande (máx 2MB)', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      photoData = ev.target.result;
      photoPreview.src = photoData;
      photoPreview.classList.remove('hidden');
      photoBtn.innerHTML = `
        <span class="photo-btn__icon">✅</span>
        <span>Foto capturada - Toca para cambiar</span>
      `;
    };
    reader.readAsDataURL(file);
  });

  // Form submission
  container.querySelector('#transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const montoInput = document.getElementById('input-monto');
    const monto = parseFloat(montoInput.value);

    if (!monto || monto <= 0 || isNaN(monto)) {
      showToast('Ingresa un monto válido', 'error');
      montoInput.focus();
      return;
    }

    // Prevent double submit
    const submitBtn = document.getElementById('btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Guardando...';

    const transaction = {
      id: generateId(),
      tipo,
      monto,
      fecha: document.getElementById('input-fecha').value || getToday(),
      descripcion: document.getElementById('input-descripcion').value.trim(),
      categoria: document.getElementById('input-categoria').value,
      metodoPago: document.getElementById('input-metodo').value,
      comprobante: photoData,
      usuario: currentUser,
    };

    try {
      await addTransaction(transaction);
      showToast(
        isIngreso ? '✅ Ingreso guardado' : '✅ Gasto guardado',
        'success',
      );

      // Trigger background sync if available
      registerBackgroundSync().catch(() => {});

      navigate('home');
    } catch (err) {
      console.error('Error saving transaction:', err);
      showToast('Error al guardar. Inténtalo de nuevo.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = `✅ Guardar ${isIngreso ? 'Ingreso' : 'Gasto'}`;
    }
  });

  // Focus amount input after render
  setTimeout(() => {
    const montoInput = document.getElementById('input-monto');
    if (montoInput) montoInput.focus();
  }, 300);
}
