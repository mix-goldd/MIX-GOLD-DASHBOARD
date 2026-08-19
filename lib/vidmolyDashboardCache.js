const { getDashboardSetting, saveDashboardSetting } = require('./db');

// Snapshots live in Supabase, not process memory, so every deployed instance
// shares the same result and a page reload cannot repeat provider calls.
const SNAPSHOT_KEYS = {
  library: 'vidmoly_library_snapshot_v1',
  earnings: 'vidmoly_earnings_snapshot_v1',
};

const TTL_MS = {
  library: 30 * 60 * 1000,
  earnings: 30 * 60 * 1000,
};

const inFlightRefreshes = new Map();

function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT_KEYS, kind);
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const cachedAt = Number(value.cachedAt);
  if (!Number.isFinite(cachedAt) || !Object.prototype.hasOwnProperty.call(value, 'payload')) return null;
  return { cachedAt, payload: value.payload };
}

function buildMeta(state, cachedAt, ttlMs, hasRefreshError = false) {
  return {
    state,
    cachedAt,
    expiresAt: cachedAt + ttlMs,
    stale: state === 'stale',
    ...(hasRefreshError ? { refreshError: 'تعذر التحديث الآن؛ تظهر آخر بيانات ناجحة.' } : {}),
  };
}

function createVidmolyDashboardCache({
  getSetting = getDashboardSetting,
  saveSetting = saveDashboardSetting,
  now = () => Date.now(),
} = {}) {
  async function readSnapshot(kind) {
    if (!isKnownKind(kind)) throw new Error(`Unknown Vidmoly snapshot kind: ${kind}`);
    try {
      return normalizeSnapshot(await getSetting(SNAPSHOT_KEYS[kind]));
    } catch (error) {
      // Cache storage must never block a safe live request if it is briefly unavailable.
      return null;
    }
  }

  async function getOrRefresh(kind, loader, { force = false } = {}) {
    if (!isKnownKind(kind)) throw new Error(`Unknown Vidmoly snapshot kind: ${kind}`);
    if (typeof loader !== 'function') throw new Error('A snapshot loader is required.');

    const ttlMs = TTL_MS[kind];
    const existing = await readSnapshot(kind);
    const fresh = existing && Number(now()) - existing.cachedAt < ttlMs;
    if (fresh && !force) {
      return { payload: existing.payload, meta: buildMeta('hit', existing.cachedAt, ttlMs) };
    }

    if (inFlightRefreshes.has(kind)) return inFlightRefreshes.get(kind);

    const refresh = (async () => {
      try {
        const payload = await loader();
        const cachedAt = Number(now());
        try {
          await saveSetting(SNAPSHOT_KEYS[kind], { cachedAt, payload });
        } catch (error) {
          console.error(`Could not persist Vidmoly ${kind} snapshot:`, error.message);
        }
        return { payload, meta: buildMeta('refreshed', cachedAt, ttlMs) };
      } catch (error) {
        if (existing) {
          return { payload: existing.payload, meta: buildMeta('stale', existing.cachedAt, ttlMs, true) };
        }
        throw error;
      }
    })();

    inFlightRefreshes.set(kind, refresh);
    try {
      return await refresh;
    } finally {
      inFlightRefreshes.delete(kind);
    }
  }

  async function patchLibraryFile(fileCode, patch) {
    if (!fileCode || !patch || typeof patch !== 'object') return null;
    const existing = await readSnapshot('library');
    if (!existing || !existing.payload || !Array.isArray(existing.payload.files)) return null;
    const files = existing.payload.files.map((file) => file.file_code === fileCode ? { ...file, ...patch } : file);
    const totalSize = files.reduce((sum, file) => {
      const size = Number(file.size);
      return Number.isFinite(size) && size >= 0 ? sum + size : sum;
    }, 0);
    const hasMeasuredSize = files.some((file) => Number.isFinite(Number(file.size)) && Number(file.size) >= 0);
    const payload = { ...existing.payload, files, totalSize: hasMeasuredSize ? totalSize : null };
    await saveSetting(SNAPSHOT_KEYS.library, { ...existing, payload });
    return payload;
  }

  async function invalidate(kind) {
    if (!isKnownKind(kind)) throw new Error(`Unknown Vidmoly snapshot kind: ${kind}`);
    inFlightRefreshes.delete(kind);
    await saveSetting(SNAPSHOT_KEYS[kind], null);
  }

  return { getOrRefresh, invalidate, patchLibraryFile };
}

const defaultCache = createVidmolyDashboardCache();

module.exports = {
  TTL_MS,
  createVidmolyDashboardCache,
  getOrRefreshVidmolySnapshot: defaultCache.getOrRefresh,
  invalidateVidmolySnapshot: defaultCache.invalidate,
  patchVidmolyLibraryFile: defaultCache.patchLibraryFile,
};
