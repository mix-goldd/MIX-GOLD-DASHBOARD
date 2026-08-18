const { getDashboardSetting, saveDashboardSetting } = require('./db');
const apiKeyManager = require('./apiKeyManager');

const SYNC_STATUS_SETTING_KEY = 'vidmoly_portal_sync_status_v1';
const EXPECTED_DAILY_LIMIT = 50;

const PORTAL_ACCOUNT_ENVIRONMENTS = [
  { portalId: 'portal-primary', loginEnv: 'VIDMOLY_PORTAL_LOGIN', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD' },
  { portalId: 'portal-a', loginEnv: 'VIDMOLY_PORTAL_LOGIN_A', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_A' },
  { portalId: 'portal-b', loginEnv: 'VIDMOLY_PORTAL_LOGIN_B', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_B' },
  { portalId: 'portal-c', loginEnv: 'VIDMOLY_PORTAL_LOGIN_C', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_C' },
  { portalId: 'portal-d', loginEnv: 'VIDMOLY_PORTAL_LOGIN_D', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_D' },
];

class VidmolyPortalSyncError extends Error {
  constructor(code) {
    const messages = {
      portal_credentials_missing: 'بيانات بوابة Vidmoly غير مكتملة.',
      portal_login_failed: 'تعذر إنشاء جلسة آمنة مع بوابة Vidmoly.',
      portal_session_missing: 'لم تُرجع بوابة Vidmoly جلسة صالحة.',
      portal_usage_read_failed: 'تعذر قراءة عداد الاستهلاك من بوابة Vidmoly.',
      portal_usage_invalid: 'أعادت بوابة Vidmoly قراءة استخدام غير صالحة.',
      portal_limit_unexpected: 'أعادت بوابة Vidmoly حداً يومياً غير متوقع.',
      portal_key_unmatched: 'تعذر ربط جلسة بوابة Vidmoly بحساب API مهيأ.',
      portal_key_duplicate: 'تطابق أكثر من حساب بوابة مع مفتاح Vidmoly واحد.',
      portal_account_set_incomplete: 'لا تغطي جلسات البوابة جميع حسابات Vidmoly المهيأة.',
    };
    super(messages[code] || 'تعذرت مزامنة استهلاك Vidmoly تلقائياً.');
    this.name = 'VidmolyPortalSyncError';
    this.code = code || 'portal_sync_failed';
  }
}

function getSessionCookie(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return setCookies.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
}

function getPortalAccounts(env = process.env) {
  return PORTAL_ACCOUNT_ENVIRONMENTS.map((definition) => {
    const login = env[definition.loginEnv];
    const password = env[definition.passwordEnv];
    if (!login || !password) throw new VidmolyPortalSyncError('portal_credentials_missing');
    return { portalId: definition.portalId, login, password };
  });
}

async function readPortalUsage(account, fetchImpl = fetch) {
  const loginResponse = await fetchImpl('https://vidmoly.me/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ login: account.login, password: account.password }),
  });
  if (!loginResponse.ok) throw new VidmolyPortalSyncError('portal_login_failed');

  const cookie = getSessionCookie(loginResponse);
  if (!cookie) throw new VidmolyPortalSyncError('portal_session_missing');

  const usageResponse = await fetchImpl('https://vidmoly.me/api/user/api-key', {
    headers: { cookie, accept: 'application/json' },
  });
  if (!usageResponse.ok) throw new VidmolyPortalSyncError('portal_usage_read_failed');

  const payload = await usageResponse.json().catch(() => null);
  if (!payload || typeof payload.apiKey !== 'string' || !Number.isInteger(payload.apiUsedToday)) {
    throw new VidmolyPortalSyncError('portal_usage_invalid');
  }
  if (!Number.isInteger(payload.apiDailyLimit) || payload.apiDailyLimit !== EXPECTED_DAILY_LIMIT) {
    throw new VidmolyPortalSyncError('portal_limit_unexpected');
  }
  if (payload.apiUsedToday < 0 || payload.apiUsedToday > payload.apiDailyLimit) {
    throw new VidmolyPortalSyncError('portal_usage_invalid');
  }

  // apiKey is intentionally retained only until server-side account matching.
  return {
    portalId: account.portalId,
    apiKey: payload.apiKey,
    dailyLimit: payload.apiDailyLimit,
    usedToday: payload.apiUsedToday,
  };
}

function mapReadingsToConfiguredAccounts(readings, manager = apiKeyManager) {
  const configuredIds = manager.getConfiguredApiKeyDefinitions('vidmoly').map((definition) => definition.id);
  const usageByKeyId = {};
  const mappings = [];

  for (const reading of readings) {
    const keyId = manager.resolveConfiguredApiKeyId('vidmoly', reading.apiKey);
    if (!keyId) throw new VidmolyPortalSyncError('portal_key_unmatched');
    if (Object.prototype.hasOwnProperty.call(usageByKeyId, keyId)) {
      throw new VidmolyPortalSyncError('portal_key_duplicate');
    }
    usageByKeyId[keyId] = reading.usedToday;
    mappings.push({ portalId: reading.portalId, keyId });
  }

  if (mappings.length !== configuredIds.length || configuredIds.some((id) => !(id in usageByKeyId))) {
    throw new VidmolyPortalSyncError('portal_account_set_incomplete');
  }

  return { usageByKeyId, mappings };
}

function normalizeStatus(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    lastAttemptAt: Number(value.lastAttemptAt) || null,
    lastSuccessAt: Number(value.lastSuccessAt) || null,
    lastErrorCode: typeof value.lastErrorCode === 'string' ? value.lastErrorCode : null,
    mappings: Array.isArray(value.mappings)
      ? value.mappings.filter((item) => item && typeof item.portalId === 'string' && typeof item.keyId === 'string')
      : [],
  };
}

async function getVidmolyPortalSyncStatus(settings = { get: getDashboardSetting }) {
  return normalizeStatus(await settings.get(SYNC_STATUS_SETTING_KEY));
}

async function persistStatus(status, settings = { save: saveDashboardSetting }) {
  await settings.save(SYNC_STATUS_SETTING_KEY, normalizeStatus(status));
}

let inFlightSync = null;

async function performSync({
  now = Date.now(),
  fetchImpl = fetch,
  env = process.env,
  manager = apiKeyManager,
  settings = { get: getDashboardSetting, save: saveDashboardSetting },
  portalAccounts,
} = {}) {
  const priorStatus = await getVidmolyPortalSyncStatus(settings);
  try {
    const accounts = portalAccounts || getPortalAccounts(env);
    const readings = [];
    for (const account of accounts) {
      readings.push(await readPortalUsage(account, fetchImpl));
    }
    const { usageByKeyId, mappings } = mapReadingsToConfiguredAccounts(readings, manager);
    const keys = await manager.syncVidmolyDailyUsage(usageByKeyId, now);
    const sync = {
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastErrorCode: null,
      mappings,
    };
    await persistStatus(sync, settings);
    return { keys, sync };
  } catch (error) {
    const code = error instanceof VidmolyPortalSyncError ? error.code : 'portal_sync_failed';
    await persistStatus({
      ...priorStatus,
      lastAttemptAt: now,
      lastErrorCode: code,
    }, settings);
    throw error instanceof VidmolyPortalSyncError ? error : new VidmolyPortalSyncError(code);
  }
}

function syncVidmolyPortalUsage(options = {}) {
  if (!inFlightSync) {
    inFlightSync = performSync(options).finally(() => {
      inFlightSync = null;
    });
  }
  return inFlightSync;
}

module.exports = {
  VidmolyPortalSyncError,
  syncVidmolyPortalUsage,
  getVidmolyPortalSyncStatus,
  _private: {
    getSessionCookie,
    getPortalAccounts,
    readPortalUsage,
    mapReadingsToConfiguredAccounts,
    normalizeStatus,
    SYNC_STATUS_SETTING_KEY,
  },
};
