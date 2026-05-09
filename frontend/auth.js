import db from './db.js';

const AUTH_STORAGE_KEY = 'auth_token';
const AUTH_REQUIRED_EVENT = 'auth:required';
const ENV_API_URLS = (import.meta.env.VITE_API_URL || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function dispatchAuthRequired(detail = {}) {
  window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT, { detail }));
}

export function addAuthRequiredListener(listener) {
  window.addEventListener(AUTH_REQUIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
}

export function getApiUrl() {
  return ENV_API_URLS[0] || '';
}

function getApiUrls() {
  return ENV_API_URLS;
}

function deleteIndexedDatabase(name) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error(`No se pudo borrar IndexedDB: ${name}`));
    request.onblocked = () => reject(new Error(`La base local sigue bloqueada: ${name}`));
  });
}

async function clearIndexedDatabases() {
  if (typeof indexedDB === 'undefined') {
    return;
  }

  db.close();

  const databaseNames = new Set(['RanchoFinanzasDB', 'workbox-expiration']);
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases();
    databases.forEach((database) => {
      if (database?.name) {
        databaseNames.add(database.name);
      }
    });
  }

  await Promise.all([...databaseNames].map((name) => deleteIndexedDatabase(name)));
}

async function clearCacheStorage() {
  if (!('caches' in window)) {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
}

export function getStoredAuthToken() {
  return localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

export function setStoredAuthToken(token) {
  localStorage.setItem(AUTH_STORAGE_KEY, token.trim());
}

export function clearStoredAuthToken({ notify = true } = {}) {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (notify) {
    dispatchAuthRequired({ reason: 'missing-token' });
  }
}

export async function logoutAndClearLocalData() {
  clearStoredAuthToken({ notify: false });
  sessionStorage.clear();
  localStorage.clear();
  await Promise.all([
    clearIndexedDatabases(),
    clearCacheStorage(),
  ]);
  dispatchAuthRequired({ reason: 'logout' });
}

export function isAuthenticated() {
  return Boolean(getStoredAuthToken());
}

function buildRequestOptions(options = {}, token = getStoredAuthToken()) {
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return {
    ...options,
    headers,
  };
}

async function rawApiFetch(path, options = {}) {
  const apiUrls = getApiUrls();
  if (apiUrls.length === 0) {
    throw new Error('Missing VITE_API_URL');
  }

  let lastError = null;

  for (const baseUrl of apiUrls) {
    try {
      const response = await fetch(`${baseUrl}${path}`, options);
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`Request failed: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error(`Request failed for ${path}`);
}

export async function apiFetch(path, options = {}) {
  const response = await rawApiFetch(path, buildRequestOptions(options));

  if (response.status === 401) {
    clearStoredAuthToken({ notify: false });
    dispatchAuthRequired({ reason: 'unauthorized' });
  }

  return response;
}

export async function validateAccessToken(token) {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return false;
  }

  const response = await rawApiFetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: trimmedToken }),
  });

  if (!response.ok) {
    const message = response.status === 503
      ? 'El backend no tiene AUTH_TOKEN configurado.'
      : `No se pudo validar el token: ${response.status}`;
    throw new Error(message);
  }

  const payload = await response.json();
  return Boolean(payload.valid);
}