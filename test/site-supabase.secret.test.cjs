const siteDb = require('../lib/siteDb');

describe('Site Supabase server credential', () => {
  it('retrieves a stored dashboard setting through the production data layer', async () => {
    expect(process.env.SITE_SUPABASE_URL).toMatch(/^https:\/\//);
    expect(process.env.SITE_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

    const setting = await siteDb.getSetting('sidebar_items', null);

    expect(setting).not.toBeNull();
  }, 20_000);
});
