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
