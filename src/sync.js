/**
 * sync.js - Offline-first synchronization logic
 * Handles sending pending transactions to the backend when online
 */
import { getPendingTransactions, markAsSynced } from './db.js';
import { showToast } from './utils.js';

// Backend URL - will be configured when backend is deployed
const API_URL = localStorage.getItem('api_url') || '';

/**
 * Attempt to sync pending transactions to the backend
 */
export async function syncPendingTransactions() {
  if (!navigator.onLine || !API_URL) {
    return { synced: 0, pending: 0 };
  }

  try {
    const pending = await getPendingTransactions();
    if (pending.length === 0) {
      return { synced: 0, pending: 0 };
    }

    // Send batch to backend
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
          metodoPago: t.metodoPago,
          usuario: t.usuario,
          createdAt: t.createdAt,
          // Don't send photo data in sync for now (too large)
        })),
      }),
    });

    if (response.ok) {
      const result = await response.json();
      const localIds = pending.map((t) => t.localId);
      await markAsSynced(localIds);
      return { synced: localIds.length, pending: 0 };
    } else {
      console.error('Sync failed:', response.status);
      return { synced: 0, pending: pending.length };
    }
  } catch (err) {
    console.error('Sync error:', err);
    return { synced: 0, pending: (await getPendingTransactions()).length };
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

/**
 * Listen for online/offline events and sync when back online
 */
export function initSyncListeners() {
  window.addEventListener('online', async () => {
    showToast('🟢 Conexión restaurada. Sincronizando...', 'info');
    const result = await syncPendingTransactions();
    if (result.synced > 0) {
      showToast(`✅ ${result.synced} transacción(es) sincronizada(s)`, 'success');
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
