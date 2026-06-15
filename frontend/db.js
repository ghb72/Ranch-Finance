/**
 * db.js - IndexedDB database using Dexie.js
 * Manages all local transaction storage for offline-first operation.
 */
import Dexie from 'dexie';

const db = new Dexie('RanchoFinanzasDB');
const now = () => new Date().toISOString();

db.version(1).stores({
  transactions: '++localId, id, tipo, monto, fecha, descripcion, metodoPago, usuario, syncStatus, createdAt',
  settings: 'key',
});

db.version(2).stores({
  transactions: '++localId, id, tipo, monto, fecha, descripcion, categoria, metodoPago, usuario, syncStatus, createdAt',
  settings: 'key',
}).upgrade((tx) => {
  return tx.table('transactions').toCollection().modify((t) => {
    if (!t.categoria) t.categoria = 'general';
  });
});

db.version(3).stores({
  transactions: '++localId, &id, fecha, categoria, usuario, synced, deleted, updatedAt, syncVersion',
  settings: 'key',
}).upgrade((tx) => {
  return tx.table('transactions').toCollection().modify((transaction) => {
    const createdAt = transaction.createdAt || now();
    transaction.createdAt = createdAt;
    transaction.updatedAt = transaction.updatedAt || createdAt;
    transaction.synced = transaction.syncStatus === 'synced' ? 1 : 0;
    transaction.deleted = transaction.deleted ? 1 : 0;
    transaction.deletedAt = transaction.deleted ? (transaction.deletedAt || transaction.updatedAt) : null;
    transaction.syncVersion = transaction.syncVersion || 0;
    delete transaction.syncStatus;
  });
});


function normalizeLocalTransaction(transaction) {
  return {
    ...transaction,
    categoria: transaction.categoria || 'general',
    metodoPago: transaction.metodoPago || 'efectivo',
    usuario: transaction.usuario || 'Usuario',
    synced: typeof transaction.synced === 'number' ? transaction.synced : 0,
    deleted: typeof transaction.deleted === 'number' ? transaction.deleted : 0,
    createdAt: transaction.createdAt || now(),
    updatedAt: transaction.updatedAt || transaction.createdAt || now(),
    deletedAt: transaction.deleted ? (transaction.deletedAt || transaction.updatedAt || now()) : null,
    syncVersion: transaction.syncVersion || 0,
  };
}

/**
 * Add a new transaction
 */
export async function addTransaction(transaction) {
  const timestamp = now();
  return await db.transactions.add(normalizeLocalTransaction({
    ...transaction,
    synced: 0,
    deleted: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
    syncVersion: 0,
  }));
}

/**
 * Get all transactions, sorted by date descending
 */
export async function getAllTransactions() {
  const all = await db.transactions.orderBy('updatedAt').reverse().toArray();
  return all.filter((transaction) => transaction.deleted !== 1);
}

/**
 * Get transactions for a given date range
 */
export async function getTransactionsByDateRange(startDate, endDate) {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  const all = await db.transactions.toArray();
  return all.filter((t) => {
    if (t.deleted === 1) return false;
    const d = new Date(t.fecha);
    return d >= start && d <= end;
  });
}

/**
 * Get pending (unsynced) transactions
 */
export async function getPendingTransactions() {
  return await db.transactions.where('synced').equals(0).toArray();
}

/**
 * Mark transactions as synced
 */
export async function markAsSynced(localIds) {
  return await db.transactions
    .where('localId')
    .anyOf(localIds)
    .modify((transaction) => {
      transaction.synced = 1;
    });
}


export async function markTransactionsAsSynced(syncResults) {
  await db.transaction('rw', db.transactions, async () => {
    for (const result of syncResults) {
      const local = await db.transactions.where('id').equals(result.id).first();
      if (!local) continue;

      await db.transactions.update(local.localId, {
        synced: 1,
        deleted: result.deleted ? 1 : 0,
        deletedAt: result.deletedAt || null,
        updatedAt: result.updatedAt || local.updatedAt,
        syncVersion: result.syncVersion || local.syncVersion || 0,
      });
    }
  });
}

/**
 * Get a setting value
 */
export async function getSetting(key) {
  const setting = await db.settings.get(key);
  return setting ? setting.value : null;
}

/**
 * Set a setting value
 */
export async function setSetting(key, value) {
  return await db.settings.put({ key, value });
}

/**
 * Get summary for a date range
 */
export async function getSummary(startDate, endDate) {
  const transactions = await getTransactionsByDateRange(startDate, endDate);

  let totalIngresos = 0;
  let totalGastos = 0;

  transactions.forEach((t) => {
    if (t.tipo === 'ingreso') {
      totalIngresos += t.monto;
    } else {
      totalGastos += t.monto;
    }
  });

  return {
    totalIngresos,
    totalGastos,
    balance: totalIngresos - totalGastos,
    transacciones: transactions.length,
  };
}

/**
 * Delete a transaction by localId
 */
export async function deleteTransaction(localId) {
  return await db.transactions.update(localId, {
    deleted: 1,
    synced: 0,
    deletedAt: now(),
    updatedAt: now(),
  });
}

/**
 * Get total balance across all transactions
 */
export async function getTotalBalance() {
  const all = await db.transactions.toArray();
  let ingresos = 0;
  let gastos = 0;

  all.forEach((t) => {
    if (t.deleted === 1) return;
    if (t.tipo === 'ingreso') {
      ingresos += t.monto;
    } else {
      gastos += t.monto;
    }
  });

  return { ingresos, gastos, balance: ingresos - gastos };
}

/**
 * Upsert a transaction from the remote server.
 * If a transaction with the same `id` already exists locally, skip it.
 * Otherwise insert it as already synced.
 */
export async function upsertRemoteTransaction(transaction) {
  const existing = await db.transactions.where('id').equals(transaction.id).first();
  const normalized = normalizeLocalTransaction({
    ...transaction,
    synced: 1,
    deleted: transaction.deletedAt ? 1 : 0,
  });

  if (!existing) {
    await db.transactions.add(normalized);
    return true;
  }

  if (existing.synced === 0) {
    return false;
  }

  await db.transactions.update(existing.localId, {
    ...normalized,
    localId: existing.localId,
  });
  return true;
}

/**
 * Get the most recent createdAt timestamp among synced transactions.
 * Used to request only newer records from the server.
 */
export async function getLastSyncTimestamp() {
  const setting = await db.settings.get('lastPullTimestamp');
  return setting ? setting.value : null;
}

/**
 * Save the timestamp of the last successful pull.
 */
export async function setLastSyncTimestamp(timestamp) {
  return await db.settings.put({ key: 'lastPullTimestamp', value: timestamp });
}


export async function getLastKnownSyncVersion() {
  const setting = await db.settings.get('lastKnownSyncVersion');
  return setting ? setting.value : null;
}


export async function setLastKnownSyncVersion(version) {
  return await db.settings.put({ key: 'lastKnownSyncVersion', value: version });
}


/**
 * Mirror the auth token and client id into IndexedDB so the service worker
 * (which cannot read localStorage) can authenticate background syncs.
 */
export async function setSyncCredentials({ token, clientId } = {}) {
  const current = (await getSetting('syncCredentials')) || {};
  const next = { ...current };
  if (token !== undefined) next.token = token;
  if (clientId !== undefined) next.clientId = clientId;
  return await setSetting('syncCredentials', next);
}

export async function getSyncCredentials() {
  return (await getSetting('syncCredentials')) || {};
}

export async function clearSyncCredentials() {
  return await db.settings.delete('syncCredentials');
}


export async function getSyncStatusSnapshot() {
  const pending = await getPendingTransactions();
  const lastKnownVersion = await getLastKnownSyncVersion();
  const lastPullTimestamp = await getLastSyncTimestamp();

  return {
    pending: pending.length,
    lastKnownVersion,
    lastPullTimestamp,
  };
}

export default db;
