/**
 * router.js - Simple hash-based SPA router
 */

const routes = {};
let currentView = null;

/**
 * Register a route
 */
export function addRoute(path, renderFn) {
  routes[path] = renderFn;
}

/**
 * Navigate to a route
 */
export function navigate(path, params = {}) {
  window.history.pushState({ path, params }, '', `#${path}`);
  renderRoute(path, params);
}

/**
 * Go back
 */
export function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    navigate('home');
  }
}

/**
 * Render the current route
 */
function renderRoute(path, params = {}) {
  // Hide all views
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));

  const renderFn = routes[path];
  if (renderFn) {
    currentView = path;
    renderFn(params);

    // Update nav
    document.querySelectorAll('.bottom-nav__item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === path);
    });
  }
}

/**
 * Initialize the router
 */
export function initRouter() {
  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    const state = e.state;
    if (state) {
      renderRoute(state.path, state.params || {});
    } else {
      renderRoute('home');
    }
  });

  // Initial route from hash or default to home
  const hash = window.location.hash.slice(1) || 'home';
  navigate(hash);
}

export function getCurrentView() {
  return currentView;
}
