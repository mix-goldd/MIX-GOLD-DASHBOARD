const dbPath = require.resolve('../lib/db');
const managerPath = require.resolve('../lib/apiKeyManager');
const originalPrimaryKey = process.env.VIDMOLY_API_KEY;

afterEach(() => {
  if (originalPrimaryKey === undefined) delete process.env.VIDMOLY_API_KEY;
  else process.env.VIDMOLY_API_KEY = originalPrimaryKey;
  delete require.cache[dbPath];
  delete require.cache[managerPath];
});

describe('Public API-key status payload', () => {
  it('contains operational metadata only and never serializes the key value', async () => {
    const secretValue = 'server-only-secret-should-never-leak';
    process.env.VIDMOLY_API_KEY = secretValue;
    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: { getDashboardSetting: vi.fn().mockResolvedValue({ entries: {} }), saveDashboardSetting: vi.fn() },
    };
    delete require.cache[managerPath];
    const { getPublicApiKeyStatus } = require('../lib/apiKeyManager');

    const result = await getPublicApiKeyStatus(Date.UTC(2026, 7, 13, 12, 0, 0));

    expect(result.find((entry) => entry.id === 'vidmoly-1')).toEqual(expect.objectContaining({
      configured: true,
      label: 'Vidmoly 1',
    }));
    expect(JSON.stringify(result)).not.toContain(secretValue);
    expect(result.every((entry) => !Object.prototype.hasOwnProperty.call(entry, 'value'))).toBe(true);
  });
});
