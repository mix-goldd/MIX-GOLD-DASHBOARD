const { VidmolyPortalSyncError, syncVidmolyPortalUsage, _private } = require('../lib/vidmolyPortalSync');

function response(payload, options = {}) {
  const headers = new Headers(options.headers || {});
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    headers,
    json: async () => payload,
  };
}

function makeManager() {
  const definitions = [1, 2, 3, 4, 5].map((number) => ({ id: `vidmoly-${number}` }));
  return {
    getConfiguredApiKeyDefinitions: () => definitions,
    resolveConfiguredApiKeyId: (_provider, apiKey) => definitions.find((item) => `portal-key-${item.id}` === apiKey)?.id || null,
    syncVidmolyDailyUsage: async (usage) => Object.entries(usage).map(([id, dailyRequests]) => ({ id, dailyRequests })),
  };
}

describe('Vidmoly portal usage sync', () => {
  it('maps five authenticated portal readings to all configured account identifiers without returning API keys', async () => {
    const accounts = [1, 2, 3, 4, 5].map((number) => ({
      portalId: `portal-${number}`,
      login: `login-${number}`,
      password: `password-${number}`,
    }));
    const env = {};
    const manager = makeManager();
    const stored = [];
    let call = 0;
    const fetchImpl = async (url) => {
      const accountNumber = Math.floor(call / 2) + 1;
      call += 1;
      if (url.endsWith('/api/auth/login')) {
        return response({ status: 200 }, { headers: { 'set-cookie': `vidmoly_session=session-${accountNumber}; Path=/` } });
      }
      return response({
        apiKey: `portal-key-vidmoly-${accountNumber}`,
        apiDailyLimit: 50,
        apiUsedToday: accountNumber * 3,
      });
    };
    const settings = {
      get: async () => null,
      save: async (_key, value) => stored.push(value),
    };

    expect(accounts).toHaveLength(5);
    const result = await syncVidmolyPortalUsage({
      now: 1_000,
      env,
      fetchImpl,
      manager,
      settings,
      portalAccounts: accounts,
    });

    expect(result.keys).toHaveLength(5);
    expect(result.sync).toMatchObject({ lastSuccessAt: 1_000, lastErrorCode: null });
    expect(result.sync.mappings).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain('portal-key-vidmoly');
    expect(stored.at(-1)).toMatchObject({ lastSuccessAt: 1_000, mappings: expect.any(Array) });
  });

  it('rejects a portal reading that cannot be matched to a configured Vidmoly account', () => {
    const manager = makeManager();
    expect(() => _private.mapReadingsToConfiguredAccounts([
      { portalId: 'portal-a', apiKey: 'unmatched-key', usedToday: 1 },
    ], manager)).toThrow(VidmolyPortalSyncError);
    expect(() => _private.mapReadingsToConfiguredAccounts([
      { portalId: 'portal-a', apiKey: 'unmatched-key', usedToday: 1 },
    ], manager)).toThrow('تعذر ربط جلسة بوابة Vidmoly بحساب API مهيأ.');
  });

  it('rejects duplicate portal-to-key mappings instead of overwriting an account usage value', () => {
    const manager = makeManager();
    expect(() => _private.mapReadingsToConfiguredAccounts([
      { portalId: 'portal-a', apiKey: 'portal-key-vidmoly-1', usedToday: 1 },
      { portalId: 'portal-b', apiKey: 'portal-key-vidmoly-1', usedToday: 2 },
    ], manager)).toThrow('تطابق أكثر من حساب بوابة مع مفتاح Vidmoly واحد.');
  });
});
