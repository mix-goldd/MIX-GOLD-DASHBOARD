// Server-only API-key/quota manager. It deliberately stores only operational
// metadata in Supabase; secret values always remain in environment variables.
const { getDashboardSetting, saveDashboardSetting } = require('./db');

const SETTING_KEY = 'api_key_quota_state_v1';
const VIDMOLY_DAILY_LIMIT = 50;
const GEMINI_DAILY_LIMIT = 1500;
const GEMINI_MINUTE_LIMIT = 15;

const KEY_DEFINITIONS = [
  { id: 'vidmoly-1', provider: 'vidmoly', env: 'VIDMOLY_API_KEY', label: 'Vidmoly 1', dailyLimit: VIDMOLY_DAILY_LIMIT },
  { id: 'vidmoly-2', provider: 'vidmoly', env: 'VIDMOLY_API_KEY_2', label: 'Vidmoly 2', dailyLimit: VIDMOLY_DAILY_LIMIT },
  { id: 'vidmoly-3', provider: 'vidmoly', env: 'VIDMOLY_API_KEY_3', label: 'Vidmoly 3', dailyLimit: VIDMOLY_DAILY_LIMIT },
  { id: 'vidmoly-4', provider: 'vidmoly', env: 'VIDMOLY_API_KEY_4', label: 'Vidmoly 4', dailyLimit: VIDMOLY_DAILY_LIMIT },
  { id: 'vidmoly-5', provider: 'vidmoly', env: 'VIDMOLY_API_KEY_5', label: 'Vidmoly 5', dailyLimit: VIDMOLY_DAILY_LIMIT },
  { id: 'gemini-1', provider: 'gemini', env: 'GEMINI_API_KEY', label: 'Gemini 1', dailyLimit: GEMINI_DAILY_LIMIT, minuteLimit: GEMINI_MINUTE_LIMIT },
  { id: 'gemini-2', provider: 'gemini', env: 'GEMINI_API_KEY_SECONDARY', label: 'Gemini 2', dailyLimit: GEMINI_DAILY_LIMIT, minuteLimit: GEMINI_MINUTE_LIMIT },
];

class ApiQuotaWaitError extends Error {
  constructor(provider, waitUntil) {
    const waitLabel = waitUntil ? new Date(waitUntil).toISOString() : 'وقت إعادة الضبط الذي يحدده المزود';
    super(`لا يوجد مفتاح ${provider} متاح حالياً. يُرجى الانتظار حتى ${waitLabel}.`);
    this.name = 'ApiQuotaWaitError';
    this.code = 'API_QUOTA_WAIT';
    this.provider = provider;
    this.waitUntil = waitUntil || null;
  }
}

function utcDayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function nextUtcMidnight(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function parseRetryAfter(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return now + Math.ceil(seconds * 1000);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeState(state = {}) {
  return {
    version: 1,
    entries: state && typeof state === 'object' && state.entries && typeof state.entries === 'object' ? state.entries : {},
  };
}

function getDefinition(provider, id) {
  return KEY_DEFINITIONS.find((definition) => definition.provider === provider && definition.id === id) || null;
}

function getConfiguredDefinitions(provider) {
  return KEY_DEFINITIONS.filter((definition) => definition.provider === provider && Boolean(process.env[definition.env]));
}

// Status labels and identifiers are safe to expose to authenticated server
// callers; the environment variable name and value deliberately stay here.
function getConfiguredApiKeyDefinitions(provider) {
  return getConfiguredDefinitions(provider).map(({ id, provider: keyProvider, label, dailyLimit, minuteLimit }) => ({
    id,
    provider: keyProvider,
    label,
    dailyLimit,
    minuteLimit: minuteLimit || null,
  }));
}

// Matches a provider-returned credential only in server memory. The caller
// receives an identifier, never the matching secret or env-var name.
function resolveConfiguredApiKeyId(provider, value) {
  if (typeof value !== 'string' || !value) return null;
  return getConfiguredDefinitions(provider).find((definition) => process.env[definition.env] === value)?.id || null;
}

function getEntry(state, definition, now = Date.now()) {
  const saved = state.entries[definition.id] || {};
  const today = utcDayKey(now);
  const entry = saved.day === today
    ? saved
    : {
      ...saved,
      day: today,
      dailyRequests: 0,
      minuteRequests: [],
      usageSource: 'local',
      usageSyncedAt: null,
    };
  const minuteRequests = (entry.minuteRequests || []).filter((timestamp) => Number(timestamp) > now - 60 * 1000);
  return { ...entry, day: today, dailyRequests: Number(entry.dailyRequests) || 0, minuteRequests };
}

function entryIsAvailable(entry, definition, now = Date.now()) {
  if (entry.blockedUntil && Number(entry.blockedUntil) > now) return false;
  if (definition.dailyLimit && entry.dailyRequests >= definition.dailyLimit) return false;
  if (definition.minuteLimit && entry.minuteRequests.length >= definition.minuteLimit) return false;
  return true;
}

function earliestResumeAt(entries, definitions, now = Date.now()) {
  const candidates = [];
  entries.forEach((entry, index) => {
    const definition = definitions[index];
    if (entry.blockedUntil && entry.blockedUntil > now) candidates.push(entry.blockedUntil);
    if (definition.dailyLimit && entry.dailyRequests >= definition.dailyLimit) candidates.push(nextUtcMidnight(now));
    if (definition.minuteLimit && entry.minuteRequests.length >= definition.minuteLimit) {
      candidates.push(Number(entry.minuteRequests[0]) + 60 * 1000);
    }
  });
  return candidates.length ? Math.min(...candidates) : null;
}

async function loadState() {
  return normalizeState(await getDashboardSetting(SETTING_KEY));
}

async function persistState(state) {
  await saveDashboardSetting(SETTING_KEY, state);
}

// Picks the least-used eligible credential. The value is intentionally not
// returned by any status function, and callers never log it.
async function getNextApiKey(provider, opts = {}) {
  const now = opts.now || Date.now();
  const excluded = new Set(opts.excludeIds || []);
  const definitions = getConfiguredDefinitions(provider);
  if (!definitions.length) {
    throw new Error(`No ${provider} API key is configured on the server.`);
  }

  const state = await loadState();
  const candidates = definitions
    .map((definition) => ({ definition, entry: getEntry(state, definition, now) }))
    .filter(({ definition, entry }) => !excluded.has(definition.id) && entryIsAvailable(entry, definition, now))
    .sort((a, b) => a.entry.dailyRequests - b.entry.dailyRequests || a.entry.minuteRequests.length - b.entry.minuteRequests.length);

  if (!candidates.length) {
    const entries = definitions.map((definition) => getEntry(state, definition, now));
    throw new ApiQuotaWaitError(provider, earliestResumeAt(entries, definitions, now));
  }

  const chosen = candidates[0].definition;
  return { id: chosen.id, value: process.env[chosen.env], provider: chosen.provider };
}

// Read-only aggregation endpoints need to query a particular Vidmoly account
// rather than silently rotating to another one. This keeps the account label
// on each returned file truthful while applying exactly the same availability
// checks as the normal least-used-key selector.
async function getApiKeyById(provider, keyId, opts = {}) {
  const now = opts.now || Date.now();
  const definition = getDefinition(provider, keyId);
  if (!definition || !process.env[definition.env]) {
    throw new Error(`The requested ${provider} account is not configured on the server.`);
  }

  const state = await loadState();
  const entry = getEntry(state, definition, now);
  if (!entryIsAvailable(entry, definition, now)) {
    throw new ApiQuotaWaitError(provider, earliestResumeAt([entry], [definition], now));
  }

  return { id: definition.id, value: process.env[definition.env], provider: definition.provider };
}

async function recordApiOutcome({ provider, keyId, httpStatus, retryAfter, providerPayload, now = Date.now() }) {
  const definition = getDefinition(provider, keyId);
  if (!definition) return;

  const state = await loadState();
  const entry = getEntry(state, definition, now);
  const providerStatus = Number(providerPayload?.status);
  const limited = Number(httpStatus) === 429 || providerStatus === 429;

  entry.dailyRequests += 1;
  entry.minuteRequests = [...entry.minuteRequests, now];
  entry.lastUsedAt = now;
  entry.lastHttpStatus = Number(httpStatus) || null;
  entry.lastProviderStatus = Number.isFinite(providerStatus) ? providerStatus : null;
  entry.lastError = limited ? 'rate_limited' : Number(httpStatus) >= 400 ? 'request_failed' : null;
  entry.usageSource = entry.usageSource === 'provider' ? 'provider_plus_local' : (entry.usageSource || 'local');

  if (limited) {
    // Gemini supplies Retry-After on supported quota responses. Vidmoly's
    // observed daily limit has no dependable header, so the conservative
    // fallback is the next UTC day rather than a speculative retry loop.
    entry.blockedUntil = parseRetryAfter(retryAfter, now) || (provider === 'vidmoly' ? nextUtcMidnight(now) : now + 60 * 1000);
  } else if (entry.blockedUntil && entry.blockedUntil <= now) {
    entry.blockedUntil = null;
  }

  state.entries[keyId] = entry;
  await persistState(state);
}

// Vidmoly does not provide a documented endpoint for its portal's daily
// request counter. An administrator can record the value shown in the portal
// without submitting a key. Later dashboard calls are added to that baseline.
function normalizeVidmolyUsage(usageByKeyId, definitions) {
  if (!usageByKeyId || typeof usageByKeyId !== 'object' || Array.isArray(usageByKeyId)) {
    throw new Error('صيغة استهلاك Vidmoly غير صحيحة.');
  }

  const requiredIds = new Set(definitions.map((definition) => definition.id));
  const providedIds = Object.keys(usageByKeyId);
  if (providedIds.length !== requiredIds.size || providedIds.some((id) => !requiredIds.has(id))) {
    throw new Error('أدخل استهلاك جميع حسابات Vidmoly المهيأة.');
  }

  return definitions.map((definition) => {
    const usage = Number(usageByKeyId[definition.id]);
    if (!Number.isInteger(usage) || usage < 0 || usage > definition.dailyLimit) {
      throw new Error(`استهلاك ${definition.label} يجب أن يكون رقماً صحيحاً بين 0 و${definition.dailyLimit}.`);
    }
    return { definition, usage };
  });
}

async function syncVidmolyDailyUsage(usageByKeyId, now = Date.now()) {
  const definitions = getConfiguredDefinitions('vidmoly');
  const usageRows = normalizeVidmolyUsage(usageByKeyId, definitions);

  const state = await loadState();
  for (const { definition, usage } of usageRows) {
    const entry = getEntry(state, definition, now);
    entry.dailyRequests = usage;
    entry.usageSource = 'provider';
    entry.usageSyncedAt = now;
    entry.minuteRequests = [];
    state.entries[definition.id] = entry;
  }
  await persistState(state);
  return getPublicApiKeyStatus(now);
}

function formatStatus(definition, entry, now = Date.now()) {
  const blockedUntil = Number(entry.blockedUntil) > now ? Number(entry.blockedUntil) : null;
  const dailyExhausted = Boolean(definition.dailyLimit && entry.dailyRequests >= definition.dailyLimit);
  const minuteExhausted = Boolean(definition.minuteLimit && entry.minuteRequests.length >= definition.minuteLimit);
  const nextAvailableAt = blockedUntil || (dailyExhausted ? nextUtcMidnight(now) : minuteExhausted ? Number(entry.minuteRequests[0]) + 60 * 1000 : null);
  return {
    id: definition.id,
    provider: definition.provider,
    label: definition.label,
    configured: Boolean(process.env[definition.env]),
    dailyRequests: entry.dailyRequests,
    dailyLimit: definition.dailyLimit,
    minuteRequests: entry.minuteRequests.length,
    minuteLimit: definition.minuteLimit || null,
    state: !process.env[definition.env] ? 'not_configured' : nextAvailableAt && nextAvailableAt > now ? 'waiting' : 'available',
    nextAvailableAt,
    remainingMs: nextAvailableAt ? Math.max(0, nextAvailableAt - now) : 0,
    lastUsedAt: entry.lastUsedAt || null,
    lastHttpStatus: entry.lastHttpStatus || null,
    lastError: entry.lastError || null,
    usageSource: entry.usageSource || 'local',
    usageSyncedAt: entry.usageSyncedAt || null,
  };
}

async function getPublicApiKeyStatus(now = Date.now()) {
  const state = await loadState();
  return KEY_DEFINITIONS.map((definition) => formatStatus(definition, getEntry(state, definition, now), now));
}

// In-process serialization prevents one library page load from firing a burst
// of Vidmoly requests. Durable quota metadata remains in Supabase so all
// instances still respect a key once it has reported a limit.
const providerTails = new Map();
function queueProviderRequest(provider, work) {
  const prior = providerTails.get(provider) || Promise.resolve();
  const current = prior.catch(() => undefined).then(work);
  providerTails.set(provider, current.catch(() => undefined));
  return current;
}

module.exports = {
  ApiQuotaWaitError,
  getNextApiKey,
  getApiKeyById,
  getConfiguredApiKeyDefinitions,
  resolveConfiguredApiKeyId,
  recordApiOutcome,
  syncVidmolyDailyUsage,
  getPublicApiKeyStatus,
  queueProviderRequest,
  _private: { utcDayKey, nextUtcMidnight, parseRetryAfter, getEntry, entryIsAvailable, earliestResumeAt, normalizeVidmolyUsage },
};
