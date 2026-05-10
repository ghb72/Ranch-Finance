import { apiFetch, getApiUrl, isAuthenticated } from './auth.js';

const REPORT_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedReports = [];
let cachedSchedule = null;
let reportsFetchedAt = 0;
let remoteDataFetchedAt = 0;
let reportsPromise = null;
let remoteDataPromise = null;

function canUseRemoteReports() {
  return Boolean(getApiUrl()) && isAuthenticated();
}

async function parseApiResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail || fallbackMessage || `Request failed: ${response.status}`);
  }
  return payload;
}

function isFresh(timestamp) {
  return Boolean(timestamp) && (Date.now() - timestamp) < REPORT_CACHE_TTL_MS;
}

export function hasRemoteReportAccess() {
  return canUseRemoteReports();
}

export function invalidateRemoteReportCache() {
  cachedReports = [];
  cachedSchedule = null;
  reportsFetchedAt = 0;
  remoteDataFetchedAt = 0;
}

export async function getCachedCashFlowReports({ force = false } = {}) {
  if (!canUseRemoteReports()) {
    cachedReports = [];
    reportsFetchedAt = 0;
    return [];
  }

  if (!force && isFresh(reportsFetchedAt)) {
    return cachedReports;
  }

  if (!force && reportsPromise) {
    return reportsPromise;
  }

  reportsPromise = (async () => {
    const response = await apiFetch('/api/cash-flow-reports');
    const payload = await parseApiResponse(response, 'No se pudo consultar el historico de reportes.');
    cachedReports = payload.reports || [];
    reportsFetchedAt = Date.now();
    return cachedReports;
  })();

  try {
    return await reportsPromise;
  } finally {
    reportsPromise = null;
  }
}

export async function getCachedRemoteReportData({ ensureDue = true, force = false } = {}) {
  if (!canUseRemoteReports()) {
    cachedSchedule = null;
    cachedReports = [];
    remoteDataFetchedAt = 0;
    reportsFetchedAt = 0;
    return {
      schedule: null,
      reports: [],
    };
  }

  if (!force && isFresh(remoteDataFetchedAt) && cachedSchedule) {
    return {
      schedule: cachedSchedule,
      reports: cachedReports,
    };
  }

  if (!force && remoteDataPromise) {
    return remoteDataPromise;
  }

  remoteDataPromise = (async () => {
    const [scheduleResponse, reportsResponse] = await Promise.all([
      apiFetch(`/api/report-schedule?ensure_due=${ensureDue ? 'true' : 'false'}`),
      apiFetch('/api/cash-flow-reports'),
    ]);

    const schedule = await parseApiResponse(scheduleResponse, 'No se pudo consultar la agenda de reportes.');
    const reportsPayload = await parseApiResponse(reportsResponse, 'No se pudo consultar el historico de reportes.');

    cachedSchedule = schedule;
    cachedReports = reportsPayload.reports || [];
    remoteDataFetchedAt = Date.now();
    reportsFetchedAt = remoteDataFetchedAt;

    return {
      schedule: cachedSchedule,
      reports: cachedReports,
    };
  })();

  try {
    return await remoteDataPromise;
  } finally {
    remoteDataPromise = null;
  }
}