describe('Gemini credential', () => {
  it('authenticates when listing available models', async () => {
    const apiKey = process.env.GEMINI_API_KEY;
    expect(apiKey).toBeTruthy();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );

    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body.models)).toBe(true);
  }, 20_000);

  it('validates the secondary credential when it is configured', async () => {
    const apiKey = process.env.GEMINI_API_KEY_2;
    if (!apiKey) return;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );

    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body.models)).toBe(true);
  }, 20_000);
});
