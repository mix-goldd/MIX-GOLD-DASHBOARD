const vidmoly = require('../lib/vidmoly');

describe('Vidmoly server credential', () => {
  it('is available to the server-side credential manager', () => {
    expect(process.env.VIDMOLY_API_KEY).toBeTruthy();
  });

  const externalIt = process.env.RUN_EXTERNAL_VIDMOLY_TESTS === 'true' ? it : it.skip;
  externalIt('retrieves the authenticated account envelope', async () => {
    const response = await vidmoly.accountInfo();

    expect(response).toBeTypeOf('object');
    expect(response).toHaveProperty('status');
  }, 20_000);
});
