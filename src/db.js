/**
 * db.js - IndexedDB database using Dexie.js
 * Manages all local transaction storage for offline-first operation.
 */
import Dexie from 'dexie';

const db = new Dexie('RanchoFinanzasDB');

db.version(1).stores({
  transactions: '++localId, id, tipo, monto, fecha, descripcion, metodoPago, usuario, syncStatus, createdAt',
  settings: 'key',
});

/**
 * Add a new transaction
 */
export async function addTransaction(transaction) {
  return await db.transactions.add({
    ...transaction,
    syncStatus: 'pending',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Get all transactions, sorted by date descending
 */
export async function getAllTransactions() {
  return await db.transactions.orderBy('createdAt').reverse().toArray();
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
    const d = new Date(t.fecha);
    return d >= start && d <= end;
  });
}

/**
 * Get pending (unsynced) transactions
 */
export async function getPendingTransactions() {
  return await db.transactions.where('syncStatus').equals('pending').toArray();
}

/**
 * Mark transactions as synced
 */
export async function markAsSynced(localIds) {
  return await db.transactions
    .where('localId')
    .anyOf(localIds)
    .modify({ syncStatus: 'synced' });
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
  return await db.transactions.delete(localId);
}

/**
 * Get total balance across all transactions
 */
export async function getTotalBalance() {
  const all = await db.transactions.toArray();
  let ingresos = 0;
  let gastos = 0;

  all.forEach((t) => {
    if (t.tipo === 'ingreso') {
      ingresos += t.monto;
    } else {
      gastos += t.monto;
    }
  });

  return { ingresos, gastos, balance: ingresos - gastos };
}

export default db;
