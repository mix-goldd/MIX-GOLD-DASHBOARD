const { _private, queueProviderRequest, getConfiguredApiKeyDefinitions } = require('../lib/apiKeyManager');

describe('API key quota helpers', () => {
  it('parses a numeric Retry-After header into a future timestamp', () => {
    expect(_private.parseRetryAfter('15', 1000)).toBe(16000);
  });

  it('resets a daily counter when the UTC day changes', () => {
    const definition = { id: 'vidmoly-1' };
    const state = { entries: { 'vidmoly-1': { day: '2026-08-12', dailyRequests: 50, minuteRequests: [1] } } };
    const entry = _private.getEntry(state, definition, Date.UTC(2026, 7, 13, 1, 0, 0));
    expect(entry.dailyRequests).toBe(0);
    expect(entry.minuteRequests).toEqual([]);
  });

  it('clears a portal-synced baseline on the next UTC day', () => {
    const definition = { id: 'vidmoly-1' };
    const state = {
      entries: {
        'vidmoly-1': {
          day: '2026-08-12',
          dailyRequests: 37,
          minuteRequests: [1],
          usageSource: 'provider',
          usageSyncedAt: Date.UTC(2026, 7, 12, 10, 0, 0),
        },
      },
    };
    const entry = _private.getEntry(state, definition, Date.UTC(2026, 7, 13, 1, 0, 0));
    expect(entry).toMatchObject({ dailyRequests: 0, minuteRequests: [], usageSource: 'local', usageSyncedAt: null });
  });

  it('accepts a complete provider usage baseline within each daily quota', () => {
    const definitions = [
      { id: 'vidmoly-1', label: 'Vidmoly 1', dailyLimit: 50 },
      { id: 'vidmoly-2', label: 'Vidmoly 2', dailyLimit: 50 },
    ];
    expect(_private.normalizeVidmolyUsage({ 'vidmoly-1': 37, 'vidmoly-2': 17 }, definitions))
      .toEqual([
        { definition: definitions[0], usage: 37 },
        { definition: definitions[1], usage: 17 },
      ]);
  });

  it('rejects partial or over-limit portal usage baselines', () => {
    const definitions = [
      { id: 'vidmoly-1', label: 'Vidmoly 1', dailyLimit: 50 },
      { id: 'vidmoly-2', label: 'Vidmoly 2', dailyLimit: 50 },
    ];
    expect(() => _private.normalizeVidmolyUsage({ 'vidmoly-1': 37 }, definitions)).toThrow('أدخل استهلاك جميع حسابات Vidmoly المهيأة.');
    expect(() => _private.normalizeVidmolyUsage({ 'vidmoly-1': 51, 'vidmoly-2': 17 }, definitions)).toThrow('استهلاك Vidmoly 1 يجب أن يكون رقماً صحيحاً بين 0 و50.');
  });

  it('rejects a key at its daily limit and supplies the next UTC reset time', () => {
    const now = Date.UTC(2026, 7, 13, 12, 0, 0);
    const definition = { dailyLimit: 50, minuteLimit: null };
    const entry = { dailyRequests: 50, minuteRequests: [], blockedUntil: null };
    expect(_private.entryIsAvailable(entry, definition, now)).toBe(false);
    expect(_private.earliestResumeAt([entry], [definition], now)).toBe(Date.UTC(2026, 7, 14, 0, 0, 0));
  });

  it('returns the next UTC midnight as the daily Vidmoly quota renewal boundary', () => {
    const now = Date.UTC(2026, 7, 13, 23, 59, 59);
    expect(_private.nextUtcMidnight(now)).toBe(Date.UTC(2026, 7, 14, 0, 0, 0));
  });

  it('respects provider cooldown timestamps before choosing a credential', () => {
    const now = 5000;
    const definition = { dailyLimit: 1500, minuteLimit: 15 };
    const entry = { dailyRequests: 4, minuteRequests: [], blockedUntil: 9000 };
    expect(_private.entryIsAvailable(entry, definition, now)).toBe(false);
  });

  it('serializes provider work in FIFO order within the running server', async () => {
    const events = [];
    const first = queueProviderRequest('quota-test', async () => {
      events.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push('first:end');
    });
    const second = queueProviderRequest('quota-test', async () => {
      events.push('second:start');
      events.push('second:end');
    });
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('returns account labels for unified Vidmoly reads without exposing secrets', () => {
    const original = process.env.VIDMOLY_API_KEY;
    process.env.VIDMOLY_API_KEY = 'test-secret-that-must-not-be-returned';
    try {
      const accounts = getConfiguredApiKeyDefinitions('vidmoly');
      expect(accounts.length).toBeGreaterThan(0);
      expect(accounts[0]).toMatchObject({ provider: 'vidmoly', id: expect.any(String), label: expect.any(String) });
      expect(accounts[0]).not.toHaveProperty('value');
      expect(accounts[0]).not.toHaveProperty('env');
      expect(JSON.stringify(accounts)).not.toContain('test-secret-that-must-not-be-returned');
    } finally {
      if (original === undefined) delete process.env.VIDMOLY_API_KEY;
      else process.env.VIDMOLY_API_KEY = original;
    }
  });
});
