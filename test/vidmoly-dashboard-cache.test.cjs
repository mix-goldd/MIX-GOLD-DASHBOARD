const { createVidmolyDashboardCache, TTL_MS } = require('../lib/vidmolyDashboardCache');

describe('Vidmoly dashboard snapshot cache', () => {
  it('serves a fresh library snapshot without contacting Vidmoly again', async () => {
    const saved = new Map([['vidmoly_library_snapshot_v1', { cachedAt: 10_000, payload: { status: 200, result: { total: 7 } } }]]);
    const cache = createVidmolyDashboardCache({
      getSetting: async (key) => saved.get(key) || null,
      saveSetting: async (key, value) => saved.set(key, value),
      now: () => 15_000,
    });
    const loader = vi.fn(async () => ({ status: 200, result: { total: 99 } }));

    const result = await cache.getOrRefresh('library', loader);

    expect(loader).not.toHaveBeenCalled();
    expect(result.payload.result.total).toBe(7);
    expect(result.meta.state).toBe('hit');
  });

  it('refreshes an expired snapshot once and persists the replacement', async () => {
    const saved = new Map([['vidmoly_earnings_snapshot_v1', { cachedAt: 1, payload: { status: 200, result: { balance: '1' } } }]]);
    const now = 1 + TTL_MS.earnings + 1;
    const cache = createVidmolyDashboardCache({
      getSetting: async (key) => saved.get(key) || null,
      saveSetting: async (key, value) => saved.set(key, value),
      now: () => now,
    });
    const loader = vi.fn(async () => ({ status: 200, result: { balance: '2' } }));

    const result = await cache.getOrRefresh('earnings', loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.payload.result.balance).toBe('2');
    expect(result.meta.state).toBe('refreshed');
    expect(saved.get('vidmoly_earnings_snapshot_v1').payload.result.balance).toBe('2');
  });

  it('returns the last successful result when a refresh fails', async () => {
    const cachedAt = 10;
    const cache = createVidmolyDashboardCache({
      getSetting: async () => ({ cachedAt, payload: { status: 200, result: { total: 7 } } }),
      saveSetting: async () => {},
      now: () => cachedAt + TTL_MS.library + 1,
    });

    const result = await cache.getOrRefresh('library', async () => {
      throw new Error('Provider unavailable');
    });

    expect(result.payload.result.total).toBe(7);
    expect(result.meta.state).toBe('stale');
    expect(result.meta.refreshError).toBeTruthy();
  });

  it('keeps the last complete file and size snapshot when quota exhaustion returns a partial library', async () => {
    const saved = new Map([['vidmoly_library_snapshot_v1', {
      cachedAt: 10,
      payload: {
        status: 200,
        result: { complete: true, total: 2, totalSize: 300, files: [{ file_code: 'saved-a', size: 300 }] },
      },
    }]]);
    const cache = createVidmolyDashboardCache({
      getSetting: async (key) => saved.get(key) || null,
      saveSetting: async (key, value) => saved.set(key, value),
      now: () => 10 + TTL_MS.library + 1,
    });
    const incompletePayload = {
      status: 200,
      result: { complete: false, total: 0, totalSize: 0, files: [] },
    };

    const result = await cache.getOrRefresh('library', async () => incompletePayload, {
      shouldPersist: (payload) => payload.result.complete,
    });

    expect(result.meta.state).toBe('stale');
    expect(result.payload.result.files).toEqual([{ file_code: 'saved-a', size: 300 }]);
    expect(result.payload.result.totalSize).toBe(300);
    expect(saved.get('vidmoly_library_snapshot_v1').payload).not.toBe(incompletePayload);
  });

  it('marks a library snapshot stale without removing its persisted files and sizes', async () => {
    const original = {
      cachedAt: 10_000,
      payload: { status: 200, result: { totalSize: 700, files: [{ file_code: 'saved-b', size: 700 }] } },
    };
    const saved = new Map([['vidmoly_library_snapshot_v1', original]]);
    const now = 90_000;
    const cache = createVidmolyDashboardCache({
      getSetting: async (key) => saved.get(key) || null,
      saveSetting: async (key, value) => saved.set(key, value),
      now: () => now,
    });

    const preserved = await cache.markStale('library');

    expect(preserved.result.totalSize).toBe(700);
    expect(saved.get('vidmoly_library_snapshot_v1').payload.result.files).toEqual([{ file_code: 'saved-b', size: 700 }]);
    expect(saved.get('vidmoly_library_snapshot_v1').cachedAt).toBe(now - TTL_MS.library);
  });

  it('invalidates a snapshot after a content-changing operation', async () => {
    const saved = new Map([['vidmoly_library_snapshot_v1', { cachedAt: 10, payload: { status: 200 } }]]);
    const cache = createVidmolyDashboardCache({
      getSetting: async (key) => saved.get(key) || null,
      saveSetting: async (key, value) => saved.set(key, value),
    });

    await cache.invalidate('library');

    expect(saved.get('vidmoly_library_snapshot_v1')).toBeNull();
  });
});
