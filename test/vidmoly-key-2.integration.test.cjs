describe('Vidmoly additional credentials', () => {
  ['VIDMOLY_API_KEY_2', 'VIDMOLY_API_KEY_3', 'VIDMOLY_API_KEY_4', 'VIDMOLY_API_KEY_5'].forEach((name) => {
    it(`${name} is configured for the server-side credential pool`, () => {
      const key = process.env[name];
      expect(key).toBeTruthy();
    });

    const externalIt = process.env.RUN_EXTERNAL_VIDMOLY_TESTS === 'true' ? it : it.skip;
    externalIt(`${name} is accepted by the lightweight account-info endpoint`, async () => {
      const key = process.env[name];
      const response = await fetch(
        `https://vidmoly.me/api/account/info?${new URLSearchParams({ key })}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DashboardCredentialCheck/1.0)' } }
      );
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.status).toBe(200);
    }, 20000);
  });
});
