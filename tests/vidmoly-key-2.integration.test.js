import { describe, expect, it } from 'vitest';

describe('Vidmoly secondary credential', () => {
  it('is accepted by the lightweight account-info endpoint', async () => {
    expect(process.env.VIDMOLY_API_KEY_2).toBeTruthy();
    const response = await fetch(
      `https://vidmoly.me/api/account/info?${new URLSearchParams({ key: process.env.VIDMOLY_API_KEY_2 })}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DashboardCredentialCheck/1.0)' } }
    );
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body.status).toBe(200);
  }, 20000);
});
