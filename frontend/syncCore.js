/**
 * syncCore.js - Environment-agnostic synchronization core.
 *
 * Contains the pure push/pull logic shared by the window context (sync.js)
 * and the service worker (sw.js). It has NO dependency on `window`,
 * `localStorage`, the DOM or toasts: everything it needs is passed in via a
 * `ctx = { token, clientId }` object, and it talks to IndexedDB through db.js
 * (which only depends on Dexie and therefore works inside a worker too).
 */
import {
  getLastKnownSyncVersion,
  getPendingTransactions,
  markTransactionsAsSynced,
  upsertRemoteTransaction,
  setLastKnownSyncVersion,
  setLastSyncTimestamp,
} from './db.js';

const API_URLS = (import.meta.env.VITE_API_URL || '')
  .split(',')
  .map((value) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export function getApiUrls() {
  return API_URLS;
}

/**
 * Perform an authenticated request, trying each configured API URL in order
 * (local fallback resolution). Mirrors rawApiFetch in auth.js but takes the
 * bearer token explicitly so it can run without localStorage.
 */
async function coreFetch(path, { token, ...options } = {}) {
  if (API_URLS.length === 0) {
    throw new Error('Missing VITE_API_URL');
  }

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let lastError = null;
  for (const baseUrl of API_URLS) {
    try {
      const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
      if (response.status === 401) {
        throw Object.assign(new Error('Unauthorized'), { unauthorized: true });
      }
      if (response.ok || response.status < 500) {
        return response;
      }
      lastError = new Error(`Request failed: ${response.status}`);
    } catch (error) {
      if (error?.unauthorized) throw error;
      lastError = error;
    }
  }

  throw lastError || new Error(`Request failed for ${path}`);
}

/**
 * Push pending local transactions to the server.
 * @param {{ token: string, clientId: string }} ctx
 */
export async function pushPending(ctx = {}) {
  const { token, clientId } = ctx;
  if (API_URLS.length === 0 || !token) {
    return { synced: 0, pending: 0 };
  }

  const pending = await getPendingTransactions();
  if (pending.length === 0) {
    return { synced: 0, pending: 0 };
  }

  const response = await coreFetch('/api/sync', {
    token,
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
        sourceClientId: t.sourceClientId || clientId,
      })),
    }),
  });

  if (!response.ok) {
    console.error('Push failed:', response.status);
    return { synced: 0, pending: pending.length };
  }

  const payload = await response.json();
  await markTransactionsAsSynced(pending.map((transaction) => ({
    id: transaction.id,
    deleted: transaction.deleted === 1,
    deletedAt: transaction.deletedAt || null,
    updatedAt: transaction.updatedAt,
    syncVersion: Number(payload.version || transaction.syncVersion || 0),
  })));

  return { synced: pending.length, pending: 0, version: payload.version || null };
}

/**
 * Pull remote transactions from the server and merge into IndexedDB.
 * @param {{ token: string }} ctx
 */
export async function pullRemote(ctx = {}) {
  const { token } = ctx;
  if (API_URLS.length === 0 || !token) {
    return { pulled: 0 };
  }

  const lastKnownVersion = await getLastKnownSyncVersion();

  const stateResponse = await coreFetch('/api/sync/state', { token });
  if (!stateResponse.ok) {
    throw new Error(`Sync state failed: ${stateResponse.status}`);
  }
  const syncState = await stateResponse.json();
  if (lastKnownVersion && String(syncState.version) === String(lastKnownVersion)) {
    return { pulled: 0, skipped: true, version: syncState.version };
  }

  const params = new URLSearchParams({ include_deleted: 'true' });
  if (lastKnownVersion) {
    params.set('since_version', String(lastKnownVersion));
  }

  const response = await coreFetch(`/api/transactions?${params.toString()}`, { token });
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
}

/**
 * Full bidirectional sync: push first, then pull.
 * @param {{ token: string, clientId: string }} ctx
 */
export async function runSync(ctx = {}) {
  const pushResult = await pushPending(ctx);
  const pullResult = await pullRemote(ctx);
  return {
    synced: pushResult.synced,
    pulled: pullResult.pulled,
    skipped: Boolean(pullResult.skipped),
    version: pullResult.version || pushResult.version || null,
  };
}
