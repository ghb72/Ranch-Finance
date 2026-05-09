/**
 * sync.js - Bidirectional offline-first synchronization logic
 * Push: send pending local transactions to the server.
 * Pull: fetch remote transactions and merge into IndexedDB.
 */
import {
  getLastKnownSyncVersion,
  getPendingTransactions,
  getSyncStatusSnapshot,
  markTransactionsAsSynced,
  upsertRemoteTransaction,
  getLastSyncTimestamp,
  setLastKnownSyncVersion,
  setLastSyncTimestamp,
} from './db.js';
import { apiFetch, getApiUrl, isAuthenticated } from './auth.js';
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
  if (clientId) return clientId;

  clientId = globalThis.crypto?.randomUUID?.() || `client-${Date.now()}`;
  localStorage.setItem('client_id', clientId);
  return clientId;
}


async function fetchSyncState() {
  const response = await apiFetch('/api/sync/state');
  if (!response.ok) {
    throw new Error(`Sync state failed: ${response.status}`);
  }
  return await response.json();
}

/**
 * Attempt to sync pending transactions to the backend
 */
/**
 * Push pending local transactions to the server.
 */
export async function pushPendingTransactions() {
  const API_URL = getApiUrl();
  if (!navigator.onLine || !API_URL || !isAuthenticated()) {
    return { synced: 0, pending: 0 };
  }

  try {
    const pending = await getPendingTransactions();
    if (pending.length === 0) {
      return { synced: 0, pending: 0 };
    }

    const response = await apiFetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transactions: pending.map((t) => ({
          id: t.id,
          tipo: t.tipo,
          monto: t.monto,
          fecha: t.fecha,
          descripcion: t.descripcion,
          categoria: t.categoria || 'general',
          metodoPago: t.metodoPago,
          usuario: t.usuario,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          deletedAt: t.deleted === 1 ? (t.deletedAt || t.updatedAt) : null,
          syncVersion: t.syncVersion || 0,
          sourceClientId: t.sourceClientId || getClientId(),
        })),
      }),
    });

    if (response.ok) {
      const payload = await response.json();
      await markTransactionsAsSynced(pending.map((transaction) => ({
        id: transaction.id,
        deleted: transaction.deleted === 1,
        deletedAt: transaction.deletedAt || null,
        updatedAt: transaction.updatedAt,
        syncVersion: Number(payload.version || transaction.syncVersion || 0),
      })));

      if (payload.version) {
        await setLastKnownSyncVersion(String(payload.version));
      }

      return { synced: pending.length, pending: 0, version: payload.version || null };
    }
    console.error('Push failed:', response.status);
    return { synced: 0, pending: pending.length };
  } catch (err) {
    console.error('Push error:', err);
    return { synced: 0, pending: (await getPendingTransactions()).length };
  }
}

/**
 * Pull remote transactions from the server and merge into IndexedDB.
 * Only fetches records newer than the last pull timestamp when available.
 */
export async function pullRemoteTransactions() {
  const API_URL = getApiUrl();
  if (!navigator.onLine || !API_URL || !isAuthenticated()) {
    return { pulled: 0 };
  }

  try {
    const lastKnownVersion = await getLastKnownSyncVersion();
    const syncState = await fetchSyncState();
    if (lastKnownVersion && String(syncState.version) === String(lastKnownVersion)) {
      return { pulled: 0, skipped: true, version: syncState.version };
    }

    const params = new URLSearchParams({ include_deleted: 'true' });
    if (lastKnownVersion) {
      params.set('since_version', String(lastKnownVersion));
    }

    const response = await apiFetch(`/api/transactions?${params.toString()}`);
    if (!response.ok) {
      console.error('Pull failed:', response.status);
      return { pulled: 0 };
    }

    const data = await response.json();
    const remoteTransactions = data.transactions || [];

    let inserted = 0;
    for (const t of remoteTransactions) {
      if (!t.id) continue;
      const wasNew = await upsertRemoteTransaction({
        id: t.id,
        tipo: t.tipo,
        monto: Number(t.monto),
        fecha: t.fecha,
        descripcion: t.descripcion || '',
        categoria: t.categoria || 'general',
        metodoPago: t.metodoPago || 'efectivo',
        usuario: t.usuario || '',
        createdAt: t.createdAt || new Date().toISOString(),
        updatedAt: t.updatedAt || t.createdAt || new Date().toISOString(),
        deletedAt: t.deletedAt || null,
        syncVersion: Number(t.syncVersion || 0),
        sourceClientId: t.sourceClientId || null,
      });
      if (wasNew) inserted++;
    }

    await setLastSyncTimestamp(new Date().toISOString());
    await setLastKnownSyncVersion(String(data.version || syncState.version || lastKnownVersion || '0'));
    return { pulled: inserted, skipped: false, version: String(data.version || syncState.version || '') };
  } catch (err) {
    console.error('Pull error:', err);
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
    showToast('🟢 Conexión restaurada. Sincronizando...', 'info');
    const result = await syncPendingTransactions();
    const parts = [];
    if (result.synced > 0) parts.push(`⬆ ${result.synced} enviada(s)`);
    if (result.pulled > 0) parts.push(`⬇ ${result.pulled} recibida(s)`);
    if (parts.length > 0) {
      showToast(`✅ ${parts.join(', ')}`, 'success');
    }
  });

  window.addEventListener('offline', () => {
    dispatchSyncStatus('offline');
    showToast('🔴 Sin conexión. Los datos se guardan localmente.', 'info');
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

