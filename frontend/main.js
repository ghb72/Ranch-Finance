/**
 * main.js - Application entry point
 * Initializes the PWA, router, and renders the app shell
 */
import './styles.css';
import { addRoute, initRouter, navigate } from './router.js';
import { renderHome } from './views/home.js';
import { renderForm } from './views/form.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import { initSyncListeners } from './sync.js';
import { getSetting, setSetting } from './db.js';
import { inject } from '@vercel/analytics';

/**
 * Create the app shell HTML
 */
function createAppShell() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <!-- Views -->
    <div id="view-home" class="view"></div>
    <div id="view-form" class="view"></div>
    <div id="view-reports" class="view"></div>
    <div id="view-settings" class="view"></div>

    <!-- Bottom Navigation -->
    <nav class="bottom-nav">
      <button class="bottom-nav__item active" data-route="home" id="nav-home">
        <span class="bottom-nav__icon">🏠</span>
        <span>Inicio</span>
      </button>
      <button class="bottom-nav__item" data-route="reports" id="nav-reports">
        <span class="bottom-nav__icon">📊</span>
        <span>Reportes</span>
      </button>
      <button class="bottom-nav__item" data-route="settings" id="nav-settings">
        <span class="bottom-nav__icon">⚙️</span>
        <span>Ajustes</span>
      </button>
    </nav>
  `;

  // Nav button listeners
  app.querySelectorAll('.bottom-nav__item').forEach((btn) => {
    btn.addEventListener('click', () => {
      navigate(btn.dataset.route);
    });
  });
}

/**
 * Check if user has set their name, show welcome modal if not
 */
async function checkFirstRun() {
  const userName = await getSetting('usuario');
  if (!userName) {
    showWelcomeModal();
  }
}

/**
 * Show a welcome modal for first-time users
 */
function showWelcomeModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'welcome-modal';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal__title">🐄 ¡Bienvenido a RanchoFinanzas!</h3>
      <p style="text-align:center; color: var(--color-text-secondary); margin-bottom: var(--space-lg); font-size: var(--font-size-base);">
        Lleva el control de tus ingresos y gastos de manera fácil.
      </p>
      <p style="text-align:center; color: var(--color-text-secondary); margin-bottom: var(--space-lg); font-size: var(--font-size-sm);">
        ¿Cómo te llamas?
      </p>
      <input
        type="text"
        class="modal__input"
        id="welcome-name"
        placeholder="Tu nombre"
        maxlength="30"
        autofocus
      />
      <button class="modal__btn" id="welcome-btn">Empezar</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#welcome-name');
  const btn = overlay.querySelector('#welcome-btn');

  btn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (name) {
      await setSetting('usuario', name);
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 300);
    } else {
      input.style.borderColor = 'var(--color-accent-red)';
      input.placeholder = 'Ingresa tu nombre';
    }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btn.click();
  });
}

/**
 * Register the PWA service worker
 */
async function registerSW() {
  if ('serviceWorker' in navigator) {
    try {
      // vite-plugin-pwa handles this automatically in production
      // In dev mode, we skip SW registration
      if (import.meta.env.PROD) {
        const { registerSW: register } = await import('virtual:pwa-register');
        register({
          onNeedRefresh() {
            // Auto-update for simplicity
            console.log('New content available, refreshing...');
          },
          onOfflineReady() {
            console.log('App ready for offline use');
          },
        });
      }
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  }
}

/**
 * Initialize the app
 */
async function init() {
  // Create app shell
  createAppShell();

  // Register routes
  addRoute('home', renderHome);
  addRoute('form', renderForm);
  addRoute('reports', renderReports);
  addRoute('settings', renderSettings);

  // Initialize router
  initRouter();

  // Initialize sync listeners
  initSyncListeners();

  // Register service worker
  await registerSW();

  // Check first run
  await checkFirstRun();

  // Initialize Vercel Analytics
  inject();
}

// Start the app
init();
