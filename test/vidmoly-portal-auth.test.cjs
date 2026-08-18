function getSessionCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
}

async function validatePortalSession(account) {
  const login = process.env[account.loginEnv];
  const password = process.env[account.passwordEnv];
  expect(login).toBeTruthy();
  expect(password).toBeTruthy();

  const response = await fetch('https://vidmoly.me/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ login, password }),
  });
  expect(response.ok).toBe(true);

  const cookie = getSessionCookie(response);
  expect(cookie).toContain('vidmoly_session=');

  const usageResponse = await fetch('https://vidmoly.me/api/user/api-key', {
    headers: { cookie, accept: 'application/json' },
  });
  expect(usageResponse.ok).toBe(true);
  const usage = await usageResponse.json();
  expect(Number.isInteger(usage.apiDailyLimit)).toBe(true);
  expect(Number.isInteger(usage.apiUsedToday)).toBe(true);
  expect(usage.apiUsedToday).toBeGreaterThanOrEqual(0);
  expect(usage.apiUsedToday).toBeLessThanOrEqual(usage.apiDailyLimit);
}

describe('Vidmoly portal credentials', () => {
  const accounts = [
    { label: 'primary', loginEnv: 'VIDMOLY_PORTAL_LOGIN', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD' },
    { label: 'A', loginEnv: 'VIDMOLY_PORTAL_LOGIN_A', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_A' },
    { label: 'B', loginEnv: 'VIDMOLY_PORTAL_LOGIN_B', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_B' },
    { label: 'C', loginEnv: 'VIDMOLY_PORTAL_LOGIN_C', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_C' },
    { label: 'D', loginEnv: 'VIDMOLY_PORTAL_LOGIN_D', passwordEnv: 'VIDMOLY_PORTAL_PASSWORD_D' },
  ];

  for (const account of accounts) {
    it(`authenticates account ${account.label} and reads its daily API usage without exposing credentials`, async () => {
      await validatePortalSession(account);
    }, 20_000);
  }
});
