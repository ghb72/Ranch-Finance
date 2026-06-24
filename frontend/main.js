/**
 * main.js - Application entry point
 * Initializes the PWA, router, and renders the app shell
 */
import './styles.css';
import { addRoute, getCurrentView, initRouter, navigate } from './router.js';
import { renderHome } from './views/home.js';
import { renderForm } from './views/form.js';
import { renderReports } from './views/reports.js';
import { renderSettings } from './views/settings.js';
import {
  addAuthRequiredListener,
  clearStoredAuthToken,
  getStoredAuthToken,
  setStoredAuthToken,
  validateAccessToken,
} from './auth.js';
import { initSyncListeners, syncPendingTransactions } from './sync.js';
import { getSetting, setSetting, markSessionValidated } from './db.js';
import { showToast, renderSymbolIcon } from './utils.js';
import { inject } from '@vercel/analytics';

const APP_SW_URL = new URL('/sw.js', window.location.origin).href;
let authOverlay = null;
let authFlowPromise = null;

function getRegistrationScriptURL(registration) {
  return registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
}

async function clearStaleCaches() {
  if (!('caches' in window)) return;

  const cacheNames = await caches.keys();
  const staleCacheNames = cacheNames.filter((name) => (
    name.startsWith('workbox-') ||
    name === 'google-fonts-cache' ||
    name === 'gstatic-fonts-cache'
  ));

  await Promise.all(staleCacheNames.map((name) => caches.delete(name)));
}

async function cleanupStaleServiceWorkers({ unregisterAll = false } = {}) {
  if (!('serviceWorker' in navigator)) return false;

  const registrations = await navigator.serviceWorker.getRegistrations();
  const staleRegistrations = registrations.filter((registration) => {
    const scriptURL = getRegistrationScriptURL(registration);
    if (!registration.scope.startsWith(window.location.origin)) return false;
    if (unregisterAll) return true;
    return Boolean(scriptURL) && scriptURL !== APP_SW_URL;
  });

  if (staleRegistrations.length === 0) {
    return false;
  }

  await Promise.all(staleRegistrations.map((registration) => registration.unregister()));
  await clearStaleCaches();
  return true;
}

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
        ${renderSymbolIcon('dashboard', 'bottom-nav__icon')}
        <span>Inicio</span>
      </button>
      <button class="bottom-nav__item" data-route="reports" id="nav-reports">
        ${renderSymbolIcon('analytics', 'bottom-nav__icon')}
        <span>Reportes</span>
      </button>
      <button class="bottom-nav__item" data-route="settings" id="nav-settings">
        ${renderSymbolIcon('person', 'bottom-nav__icon')}
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
      <h3 class="modal__title">${renderSymbolIcon('account_balance', 'modal__title-icon')} ¡Bienvenido a Finanzas H&B!</h3>
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
      if (import.meta.env.DEV) {
        await cleanupStaleServiceWorkers({ unregisterAll: true });
        return;
      }

      await cleanupStaleServiceWorkers();

      // vite-plugin-pwa handles this automatically in production
      const { registerSW: register } = await import('virtual:pwa-register');
      register({
        onNeedRefresh() {
          // Auto-update for simplicity
          console.log('New content available, refreshing...');
        },
        onOfflineReady() {
          console.log('App ready for offline use');
        },
        async onRegisterError(error) {
          console.error('SW registration failed:', error);
          const recovered = await cleanupStaleServiceWorkers({ unregisterAll: true });
          if (recovered) {
            window.location.reload();
          }
        },
      });
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  }
}

/**
 * Register periodic background sync so installed PWAs refresh ~3x/day even
 * when the app is closed. The browser controls the exact timing (we only set a
 * minimum interval). No-ops silently where unsupported (iOS, Firefox).
 */
async function registerPeriodicSync() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return;

    const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (status.state !== 'granted') return;

    await registration.periodicSync.register('daily-sync', {
      minInterval: 8 * 60 * 60 * 1000, // ~3 times per day
    });
    console.log('Periodic background sync registered');
  } catch (err) {
    console.error('Periodic background sync registration failed:', err);
  }
}

function closeModal(overlay) {
  overlay.classList.remove('active');
  setTimeout(() => {
    if (overlay.parentNode) {
      overlay.remove();
    }
    if (authOverlay === overlay) {
      authOverlay = null;
    }
  }, 300);
}

function buildAuthModal({ message = '', allowSubmit = true } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay active';
  overlay.id = 'auth-modal';
  overlay.innerHTML = `
    <div class="modal">
      <h3 class="modal__title">Acceso privado</h3>
      <p class="modal__text">Ingresa el token para abrir la aplicación.</p>
      <p class="modal__hint ${message ? '' : 'hidden'}" id="auth-message">${message}</p>
      <input
        type="password"
        class="modal__input"
        id="auth-token"
        placeholder="AUTH_TOKEN"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        autofocus
      />
      <p class="modal__error hidden" id="auth-error"></p>
      <button class="modal__btn" id="auth-submit" ${allowSubmit ? '' : 'disabled'}>Entrar</button>
    </div>
  `;

  document.body.appendChild(overlay);
  authOverlay = overlay;
  return overlay;
}

async function requestAccessToken({ message = '' } = {}) {
  if (authFlowPromise) {
    return authFlowPromise;
  }

  authFlowPromise = new Promise((resolve) => {
    const canValidate = navigator.onLine;
    const overlay = buildAuthModal({
      message: canValidate ? message : 'Necesitas conexión para iniciar sesión la primera vez.',
      allowSubmit: canValidate,
    });
    const input = overlay.querySelector('#auth-token');
    const submit = overlay.querySelector('#auth-submit');
    const errorNode = overlay.querySelector('#auth-error');
    const messageNode = overlay.querySelector('#auth-message');
    let onlineListener = null;

    const cleanup = () => {
      if (onlineListener) {
        window.removeEventListener('online', onlineListener);
        onlineListener = null;
      }
    };

    const setError = (text) => {
      errorNode.textContent = text;
      errorNode.classList.toggle('hidden', !text);
      input.style.borderColor = text ? 'var(--color-accent-red)' : 'var(--color-border)';
    };

    const setMessage = (text) => {
      messageNode.textContent = text;
      messageNode.classList.toggle('hidden', !text);
    };

    const handleSubmit = async () => {
      const token = input.value.trim();
      if (!token) {
        setError('Ingresa el token de acceso.');
        return;
      }

      submit.disabled = true;
      submit.textContent = 'Validando...';
      setError('');

      try {
        const valid = await validateAccessToken(token);
        if (!valid) {
          setError('Token inválido.');
          return;
        }

        setStoredAuthToken(token);
        markSessionValidated().catch(() => {});
        cleanup();
        closeModal(overlay);
        showToast('Acceso validado', 'success');
        resolve(true);
      } catch (error) {
        setMessage('No se pudo validar el token contra el backend.');
        setError(error.message || 'Error al validar el token.');
      } finally {
        submit.disabled = false;
        submit.textContent = 'Entrar';
      }
    };

    submit.addEventListener('click', () => {
      handleSubmit();
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !submit.disabled) {
        handleSubmit();
      }
    });

    if (!canValidate) {
      onlineListener = () => {
        setMessage(message);
        setError('');
        submit.disabled = false;
        input.focus();
      };
      window.addEventListener('online', onlineListener);
    }
  }).finally(() => {
    authFlowPromise = null;
  });

  return authFlowPromise;
}

async function ensureAuthenticatedOnStartup() {
  const storedToken = getStoredAuthToken();
  if (!storedToken) {
    // No prior login on this device. Validation can only happen online.
    return requestAccessToken();
  }

  // We already logged in online at some point, so the user is in. We re-verify
  // in the background, but the golden rule is: only a *definitive rejection*
  // from the server (the token is no longer valid) may force re-login. A
  // network/unreachable error (offline, backend asleep, no real internet even
  // when navigator.onLine is true) must NEVER show the login banner — otherwise
  // the app would demand the token every time it opens without connectivity.
  try {
    const valid = await validateAccessToken(storedToken);
    if (valid) {
      markSessionValidated().catch(() => {});
      return true;
    }

    // Server explicitly rejected the token.
    clearStoredAuthToken({ notify: false });
    showToast('El token guardado ya no es válido.', 'error');
    return requestAccessToken({ message: 'El token anterior dejó de ser válido. Ingresa uno nuevo.' });
  } catch (error) {
    // Could not reach the backend (offline / down). Keep the existing session;
    // it will be re-checked on the next successful sync.
    console.warn('No se pudo contactar al backend para validar el token; se mantiene la sesión.', error);
    return true;
  }
}

function refreshHomeAfterSync(detail = {}) {
  if (getCurrentView() !== 'home') {
    return;
  }

  if ((detail.synced || 0) === 0 && (detail.pulled || 0) === 0) {
    return;
  }

  renderHome().catch((error) => {
    console.error('Home refresh after sync failed:', error);
  });
}

/**
 * Initialize the app
 */
async function init() {
  // Create app shell
  createAppShell();

  // Register the service worker first thing, before anything that can block
  // (notably the auth modal). This guarantees the app shell is precached on the
  // very first online visit regardless of the login flow — which is what makes
  // later offline launches work instead of showing the browser's error page.
  const swReady = registerSW();

  // Register routes
  addRoute('home', renderHome);
  addRoute('form', renderForm);
  addRoute('reports', renderReports);
  addRoute('settings', renderSettings);

  addAuthRequiredListener(async () => {
    await requestAccessToken({ message: 'La sesión local dejó de ser válida. Ingresa el token nuevamente.' });
    syncPendingTransactions().catch((error) => {
      console.error('Resync after login failed:', error);
    });
  });

  window.addEventListener('sync-complete', (event) => {
    refreshHomeAfterSync(event.detail);
  });

  const hasStoredToken = Boolean(getStoredAuthToken());
  if (hasStoredToken) {
    initRouter();
    ensureAuthenticatedOnStartup().catch((error) => {
      console.error('Background auth validation failed:', error);
    });
  } else {
    await ensureAuthenticatedOnStartup();
    initRouter();
  }

  // Initialize sync listeners
  initSyncListeners();

  // Wait for the service worker registration kicked off at the top before
  // setting up periodic sync, which depends on it.
  await swReady;

  // Register periodic background sync (installed PWAs, supported browsers)
  await registerPeriodicSync();

  // Check first run
  await checkFirstRun();

  // Initialize Vercel Analytics
  inject();
}

// Start the app
init();
