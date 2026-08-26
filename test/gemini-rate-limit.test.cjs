const managerPath = require.resolve('../lib/apiKeyManager');
const geminiPath = require.resolve('../lib/gemini');
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete require.cache[managerPath];
  delete require.cache[geminiPath];
});

describe('Gemini rate-limit handling', () => {
  it('records Retry-After and retries once with the alternate configured key when Gemini returns 429', async () => {
    const getNextApiKey = vi.fn()
      .mockResolvedValueOnce({ id: 'gemini-1', value: 'server-only-test-value-1' })
      .mockResolvedValueOnce({ id: 'gemini-2', value: 'server-only-test-value-2' });
    const recordApiOutcome = vi.fn().mockResolvedValue(undefined);
    require.cache[managerPath] = {
      id: managerPath,
      filename: managerPath,
      loaded: true,
      exports: { getNextApiKey, recordApiOutcome },
    };
    delete require.cache[geminiPath];
    const { generateContent } = require('../lib/gemini');
    global.fetch = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }), {
          status: 429,
          headers: { 'Retry-After': '17', 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'done' }] } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

    await expect(generateContent([{ text: 'test' }])).resolves.toMatchObject({ text: 'done' });

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(getNextApiKey).toHaveBeenCalledTimes(2);
    expect(getNextApiKey).toHaveBeenNthCalledWith(2, 'gemini', { excludeIds: ['gemini-1'] });
    expect(recordApiOutcome).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      keyId: 'gemini-1',
      httpStatus: 429,
      retryAfter: '17',
    }));
    expect(recordApiOutcome).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'gemini',
      keyId: 'gemini-2',
      httpStatus: 200,
    }));
  });
});
