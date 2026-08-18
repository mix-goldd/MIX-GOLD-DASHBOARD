const { syncVidmolyPortalUsage } = require('../lib/vidmolyPortalSync');

describe('Vidmoly portal usage sync integration', () => {
  it('reads all authorized portal counters, maps them to five configured accounts, and returns only safe status data', async () => {
    const result = await syncVidmolyPortalUsage();
    const vidmolyKeys = result.keys.filter((key) => key.provider === 'vidmoly' && key.configured);

    expect(vidmolyKeys).toHaveLength(5);
    expect(result.sync).toMatchObject({
      lastSuccessAt: expect.any(Number),
      lastErrorCode: null,
      mappings: expect.any(Array),
    });
    expect(result.sync.mappings).toHaveLength(5);
    expect(result.sync.mappings.every((item) => /^vidmoly-[1-5]$/.test(item.keyId))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/VIDMOLY_PORTAL|apiKey|password|login/i);
  }, 30000);
});
