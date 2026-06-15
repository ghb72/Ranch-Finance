/**
 * sync.js - Bidirectional offline-first synchronization logic
 * Push: send pending local transactions to the server.
 * Pull: fetch remote transactions and merge into IndexedDB.
 */
import {
  getPendingTransactions,
  getSyncStatusSnapshot,
  setSyncCredentials,
} from './db.js';
import {
  clearStoredAuthToken,
  getApiUrl,
  getStoredAuthToken,
  isAuthenticated,
} from './auth.js';
import { pushPending, pullRemote } from './syncCore.js';
import { showToast } from './utils.js';

const POLL_INTERVAL = 60_000;
let syncTimer = null;
let isSyncing = false;


function dispatchSyncStatus(status, detail = {}) {
  window.dispatchEvent(new CustomEvent('sync-status', { detail: { status, ...detail } }));
}


function dispatchSyncComplete(detail = {}) {
  window.dispatchEvent(new CustomEvent('sync-complete', { detail }));
}

function getClientId() {
  let clientId = localStorage.getItem('client_id');
  if (!clientId) {
    clientId = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}`;
    localStorage.setItem('client_id', clientId);
  }
  // Mirror into IndexedDB so the service worker can stamp background syncs.
  setSyncCredentials({ clientId }).catch(() => {});
  return clientId;
}

/**
 * Build the credentials context consumed by the sync core.
 */
function getSyncContext() {
  return { token: getStoredAuthToken(), clientId: getClientId() };
}

/**
 * Handle an unauthorized response surfaced by the sync core, mirroring the
 * old apiFetch behaviour (drop the token and prompt for re-auth).
 */
function handleSyncError(err) {
  if (err?.unauthorized) {
    clearStoredAuthToken({ notify: true });
  } else {
    console.error('Sync error:', err);
  }
}

/**
 * Push pending local transactions to the server.
 */
export async function pushPendingTransactions() {
  const API_URL = getApiUrl();
  if (!navigator.onLine || !API_URL || !isAuthenticated()) {
    return { synced: 0, pending: 0 };
  }

  try {
    return await pushPending(getSyncContext());
  } catch (err) {
    handleSyncError(err);
    return { synced: 0, pending: (await getPendingTransactions()).length };
  }
}

/**
 * Pull remote transactions from the server and merge into IndexedDB.
 * Only fetches records newer than the last known sync version.
 */
export async function pullRemoteTransactions() {
  const API_URL = getApiUrl();
  if (!navigator.onLine || !API_URL || !isAuthenticated()) {
    return { pulled: 0 };
  }

  try {
    return await pullRemote(getSyncContext());
  } catch (err) {
    handleSyncError(err);
    return { pulled: 0 };
  }
}

/**
 * Full bidirectional sync: push first, then pull.
 * Kept as the main public API (backward-compatible name).
 */
export async function syncPendingTransactions() {
  if (isSyncing) {
    return { synced: 0, pulled: 0, pending: (await getSyncStatusSnapshot()).pending, skipped: true };
  }

  const API_URL = getApiUrl();
  if (!API_URL || !isAuthenticated()) {
    return { synced: 0, pulled: 0, pending: (await getSyncStatusSnapshot()).pending, skipped: true };
  }
  if (!navigator.onLine) {
    dispatchSyncStatus('offline');
    return { synced: 0, pulled: 0, pending: (await getSyncStatusSnapshot()).pending, skipped: true };
  }

  isSyncing = true;
  dispatchSyncStatus('syncing');

  try {
    const pushResult = await pushPendingTransactions();
    const pullResult = await pullRemoteTransactions();
    const snapshot = await getSyncStatusSnapshot();
    const result = {
      synced: pushResult.synced,
      pulled: pullResult.pulled,
      pending: snapshot.pending,
      skipped: Boolean(pullResult.skipped),
      version: pullResult.version || pushResult.version || snapshot.lastKnownVersion || null,
    };
    dispatchSyncStatus('synced', result);
    dispatchSyncComplete(result);
    return result;
  } finally {
    isSyncing = false;
  }
}

/**
 * Register for background sync (if supported)
 */
export async function registerBackgroundSync() {
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-transactions');
      console.log('Background sync registered');
    } catch (err) {
      console.error('Background sync registration failed:', err);
    }
  }
}


function stopPolling() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}


function startPolling() {
  if (syncTimer || document.hidden) return;
  syncTimer = window.setInterval(() => {
    syncPendingTransactions().catch((error) => {
      console.error('Polling sync failed:', error);
    });
  }, POLL_INTERVAL);
}


function handleVisibilityChange() {
  if (document.hidden) {
    stopPolling();
    return;
  }

  startPolling();
  syncPendingTransactions().catch((error) => {
    console.error('Sync on visibility change failed:', error);
  });
}


function handleFocus() {
  syncPendingTransactions().catch((error) => {
    console.error('Sync on focus failed:', error);
  });
}

/**
 * Listen for online/offline events and sync when back online
 */
export function initSyncListeners() {
  window.addEventListener('online', async () => {
    showToast('Conexión restaurada. Sincronizando...', 'info');
    const result = await syncPendingTransactions();
    const parts = [];
    if (result.synced > 0) parts.push(`${result.synced} enviada(s)`);
    if (result.pulled > 0) parts.push(`${result.pulled} recibida(s)`);
    if (parts.length > 0) {
      showToast(parts.join(', '), 'success');
    }
  });

  window.addEventListener('offline', () => {
    dispatchSyncStatus('offline');
    showToast('Sin conexión. Los datos se guardan localmente.', 'info');
  });

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleFocus);

  if (!document.hidden) {
    startPolling();
    syncPendingTransactions().catch((error) => {
      console.error('Initial sync failed:', error);
    });
  }

  return () => {
    stopPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
  };
}

