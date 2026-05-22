/**
 * utils.js - Helper utilities
 */

/**
 * Format a number as Mexican Peso currency
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a date in Spanish-friendly format
 */
export function formatDate(dateStr) {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateNumeric(dateStr) {
  if (!dateStr) return 'DD/MM/YYYY';

  const normalized = String(dateStr).split('T')[0];
  const [year, month, day] = normalized.split('-');

  if (!year || !month || !day) {
    return normalized;
  }

  return `${day}/${month}/${year}`;
}

export function setupDateInputDisplay(input, displayNode) {
  if (!input) return;

  input.setAttribute('lang', 'en-GB');

  const renderDisplay = () => {
    if (!displayNode) return;

    const hasValue = Boolean(input.value);
    displayNode.textContent = hasValue ? formatDateNumeric(input.value) : 'DD/MM/YYYY';
    displayNode.classList.toggle('date-input-display--placeholder', !hasValue);
  };

  renderDisplay();
  input.addEventListener('input', renderDisplay);
  input.addEventListener('change', renderDisplay);
}

/**
 * Format a date as relative time (Hoy, Ayer, etc.)
 */
export function formatRelativeDate(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today - target) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  if (diffDays < 7) return `Hace ${diffDays} días`;
  return formatDate(dateStr);
}

/**
 * Generate a UUID v4
 */
export function generateId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
}

/**
 * Get today's date as YYYY-MM-DD
 */
export function getToday() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get start and end dates for a period
 */
export function getPeriodDates(period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start;

  switch (period) {
    case 'day':
      start = today;
      break;
    case 'week':
      start = new Date(today);
      start.setDate(start.getDate() - start.getDay()); // Start of week (Sunday)
      break;
    case 'month':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'year':
      start = new Date(today.getFullYear(), 0, 1);
      break;
    default:
      start = new Date(today.getFullYear(), today.getMonth(), 1);
  }

  return {
    start: start.toISOString().split('T')[0],
    end: today.toISOString().split('T')[0],
  };
}

/**
 * Show a toast notification
 */
export function showToast(message, type = 'success') {
  // Remove existing toast
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const iconName = {
    success: 'check_circle',
    error: 'error',
    info: 'info',
  }[type] || 'info';

  const content = document.createElement('div');
  content.className = 'toast__content';

  const iconWrapper = document.createElement('div');
  iconWrapper.innerHTML = renderSymbolIcon(iconName, 'toast__icon');

  const text = document.createElement('span');
  text.className = 'toast__message';
  text.textContent = message;

  content.append(iconWrapper.firstElementChild, text);
  toast.appendChild(content);
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-remove
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 2500);
}

/**
 * Get the Spanish name for a payment method
 */
export function getPaymentMethodLabel(method) {
  const labels = {
    efectivo: 'Efectivo',
    transferencia: 'Transferencia',
    tarjeta: 'Tarjeta',
    cheque: 'Cheque',
  };
  return labels[method] || method;
}

/** Category definitions used across the app. */
export const CATEGORIES = {
  agricultura: { icon: 'agriculture', label: 'Agricultura' },
  engorda:     { icon: 'pets', label: 'Engorda' },
  sierra:      { icon: 'terrain', label: 'Ganado en Sierra' },
  general:     { icon: 'home', label: 'Gastos Generales / Casa' },
};

const ICON_SVGS = {
  account_balance: '<path d="M3 9.5 12 5l9 4.5"/><path d="M4.5 10.5h15"/><path d="M6.5 10.5v6"/><path d="M10 10.5v6"/><path d="M14 10.5v6"/><path d="M17.5 10.5v6"/><path d="M3.5 19.5h17"/>',
  account_balance_wallet: '<path d="M3.5 8.5a2 2 0 0 1 2-2h10l2 2h2a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M15.5 13.5h4"/><circle cx="15.5" cy="13.5" r=".75" fill="currentColor" stroke="none"/>',
  add_circle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7"/><path d="M8.5 12h7"/>',
  agriculture: '<path d="M12 20v-7"/><path d="M12 13c0-4 2.5-6.5 6-7-1 3.5-3 6-6 7Z"/><path d="M12 13c0-4-2.5-6.5-6-7 1 3.5 3 6 6 7Z"/>',
  analytics: '<path d="M5 19.5h14"/><path d="M7.5 17v-4.5"/><path d="M12 17V8"/><path d="M16.5 17v-7"/>',
  arrow_downward_alt: '<path d="M12 5.5v10"/><path d="M8.5 12.5 12 16l3.5-3.5"/>',
  arrow_upward_alt: '<path d="M12 18.5v-10"/><path d="M8.5 11.5 12 8l3.5 3.5"/>',
  check_circle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12 2.3 2.3 4.7-4.8"/>',
  cloud_done: '<path d="M7 18h9a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 6.2 8 4.5 4.5 0 0 0 7 18Z"/><path d="m9.2 13.2 1.7 1.7 3.6-3.8"/>',
  cloud_sync: '<path d="M7 18h9a4 4 0 0 0 .8-7.9A5.5 5.5 0 0 0 6.2 8 4.5 4.5 0 0 0 7 18Z"/><path d="M10 11.5h3l-1.2-1.2"/><path d="M14 14.5h-3l1.2 1.2"/>',
  dashboard: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
  delete: '<path d="M5.5 7.5h13"/><path d="M9 7.5V5.8A1.3 1.3 0 0 1 10.3 4.5h3.4A1.3 1.3 0 0 1 15 5.8v1.7"/><path d="M7.5 7.5l.7 11a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9l.7-11"/><path d="M10 10.5v5.5"/><path d="M14 10.5v5.5"/>',
  error: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.3v4.7"/><circle cx="12" cy="16.1" r=".8" fill="currentColor" stroke="none"/>',
  home: '<path d="M4.5 10.5 12 4l7.5 6.5"/><path d="M6.5 9.5V20h11V9.5"/>',
  hourglass_top: '<path d="M8 4.5h8"/><path d="M8 19.5h8"/><path d="M8.5 5.5c0 3 2.2 4.4 3.5 5.5-1.3 1.1-3.5 2.5-3.5 5.5"/><path d="M15.5 5.5c0 3-2.2 4.4-3.5 5.5 1.3 1.1 3.5 2.5 3.5 5.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 10.5v5"/><circle cx="12" cy="7.8" r=".8" fill="currentColor" stroke="none"/>',
  logout: '<path d="M10 6H7.5A1.5 1.5 0 0 0 6 7.5v9A1.5 1.5 0 0 0 7.5 18H10"/><path d="M13 8.5 16.5 12 13 15.5"/><path d="M10 12h6.5"/>',
  person: '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 18a6.5 6.5 0 0 1 13 0"/>',
  pets: '<circle cx="8" cy="9" r="1.4"/><circle cx="12" cy="7.2" r="1.4"/><circle cx="16" cy="9" r="1.4"/><path d="M8.5 15.5c0-2 1.7-3.5 3.5-3.5s3.5 1.5 3.5 3.5c0 1.4-1 2.5-2.3 2.5h-2.4c-1.3 0-2.3-1.1-2.3-2.5Z"/>',
  photo_camera: '<path d="M5 8.5h3l1.2-2h5.6l1.2 2H19a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17v-7A1.5 1.5 0 0 1 5 8.5Z"/><circle cx="12" cy="13" r="3.2"/>',
  receipt_long: '<path d="M7 4.5h10v15l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"/><path d="M9.5 9h5"/><path d="M9.5 12h5"/><path d="M9.5 15h3.5"/>',
  remove_circle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12h7"/>',
  save: '<path d="M6 4.5h9l3 3V19.5H6z"/><path d="M9 4.5v5h5v-5"/><path d="M9 19.5v-5h6v5"/>',
  terrain: '<path d="m4.5 18 4.2-6 3 4 2.4-3.2 5.4 5.2"/><path d="M3.5 18.5h17"/>',
  wifi: '<path d="M4.5 9.5a11 11 0 0 1 15 0"/><path d="M7.5 12.5a7 7 0 0 1 9 0"/><path d="M10.5 15.5a3 3 0 0 1 3 0"/><circle cx="12" cy="18.2" r=".9" fill="currentColor" stroke="none"/>',
  wifi_off: '<path d="M3.5 4.5 20.5 19.5"/><path d="M6 10.5a11 11 0 0 1 4.6-1.7"/><path d="M13.6 8.9a11 11 0 0 1 4.4 1.6"/><path d="M8.2 13.1a7 7 0 0 1 2.2-.6"/><path d="M13.8 12.6a7 7 0 0 1 2 1"/><path d="M11.2 15.7a3 3 0 0 1 1.6.2"/><circle cx="12" cy="18.2" r=".9" fill="currentColor" stroke="none"/>',
};

export function renderSymbolIcon(name, className = '') {
  const classes = ['app-icon'];
  if (className) classes.push(className);
  const svg = ICON_SVGS[name] || ICON_SVGS.info;
  return `<svg class="${classes.join(' ')}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
}

/**
 * Get the label (with icon) for a category key.
 */
export function getCategoryLabel(key) {
  const cat = CATEGORIES[key];
  return cat
    ? `<span class="category-label">${renderSymbolIcon(cat.icon, 'category-label__icon')}<span>${cat.label}</span></span>`
    : key;
}

/**
 * Debounce a function
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
