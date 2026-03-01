/**
 * sync.js - Bidirectional offline-first synchronization logic
 * Push: send pending local transactions to the server.
 * Pull: fetch remote transactions and merge into IndexedDB.
 */
import {
  getPendingTransactions,
  markAsSynced,
  upsertRemoteTransaction,
  getLastSyncTimestamp,
  setLastSyncTimestamp,
} from './db.js';
import { showToast } from './utils.js';

/**
 * Returns the current API URL (re-read each call so settings changes apply).
 */
function getApiUrl() {
  return localStorage.getItem('api_url') || '';
}

/**
 * Attempt to sync pending transactions to the backend
 */
/**
 * Push pending local transactions to the server.
 */
export async function pushPendingTransactions() {
  const API_URL = getApiUrl();
  if (!navigator.onLine || !API_URL) {
    return { synced: 0, pending: 0 };
  }

  try {
    const pending = await getPendingTransactions();
    if (pending.length === 0) {
      return { synced: 0, pending: 0 };
    }

    const response = await fetch(`${API_URL}/api/sync`, {
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
        })),
      }),
    });

    if (response.ok) {
      const localIds = pending.map((t) => t.localId);
      await markAsSynced(localIds);
      return { synced: localIds.length, pending: 0 };
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
  if (!navigator.onLine || !API_URL) {
    return { pulled: 0 };
  }

  try {
    const response = await fetch(`${API_URL}/api/transactions`);
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
      });
      if (wasNew) inserted++;
    }

    await setLastSyncTimestamp(new Date().toISOString());
    return { pulled: inserted };
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
  const pushResult = await pushPendingTransactions();
  const pullResult = await pullRemoteTransactions();
  return {
    synced: pushResult.synced,
    pulled: pullResult.pulled,
    pending: pushResult.pending,
  };
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
    showToast('🔴 Sin conexión. Los datos se guardan localmente.', 'info');
  });
}

/**
 * Set the API URL for sync
 */
export function setApiUrl(url) {
  localStorage.setItem('api_url', url);
}
