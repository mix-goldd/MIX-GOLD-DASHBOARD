const managerPath = require.resolve('../lib/apiKeyManager');
const geminiPath = require.resolve('../lib/gemini');
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete require.cache[managerPath];
  delete require.cache[geminiPath];
});

describe('Gemini rate-limit handling', () => {
  it('records Retry-After and stops after one request when Gemini returns 429', async () => {
    const getNextApiKey = vi.fn().mockResolvedValue({ id: 'gemini-1', value: 'server-only-test-value' });
    const recordApiOutcome = vi.fn().mockResolvedValue(undefined);
    require.cache[managerPath] = {
      id: managerPath,
      filename: managerPath,
      loaded: true,
      exports: { getNextApiKey, recordApiOutcome },
    };
    delete require.cache[geminiPath];
    const { generateContent } = require('../lib/gemini');
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }), {
        status: 429,
        headers: { 'Retry-After': '17', 'Content-Type': 'application/json' },
      })
    );

    await expect(generateContent([{ text: 'test' }])).rejects.toThrow('quota is exhausted');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(getNextApiKey).toHaveBeenCalledTimes(1);
    expect(recordApiOutcome).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      keyId: 'gemini-1',
      httpStatus: 429,
      retryAfter: '17',
    }));
  });
});
