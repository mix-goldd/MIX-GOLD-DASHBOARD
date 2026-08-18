const crypto = require('crypto');
const { authenticateCronRequest, _private } = require('../lib/manusCronAuth');

function makeCronToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('Manus cron callback authentication', () => {
  it('accepts a valid platform-signed cron session and resolves its task identifier', async () => {
    const secret = 'test-cron-secret';
    const token = makeCronToken({ openId: 'cron_project_task', exp: 2_000 }, secret);
    const fetchImpl = async (url, options) => {
      expect(url).toContain(_private.USER_INFO_WITH_JWT_PATH);
      expect(JSON.parse(options.body)).toMatchObject({ jwtToken: token, projectId: 'project-test' });
      return { ok: true, json: async () => ({ taskUid: 'task_123' }) };
    };
    await expect(authenticateCronRequest({ headers: { cookie: `app_session_id=${token}` } }, {
      env: { JWT_SECRET: secret, OAUTH_SERVER_URL: 'https://oauth.example/', VITE_APP_ID: 'project-test' },
      fetchImpl,
      nowSeconds: 1_000,
    })).resolves.toEqual({ isCron: true, taskUid: 'task_123' });
  });

  it('rejects a validly signed non-cron user session before any network request', async () => {
    const secret = 'test-cron-secret';
    const token = makeCronToken({ openId: 'ordinary_user', exp: 2_000 }, secret);
    const fetchImpl = async () => {
      throw new Error('must not be called');
    };
    await expect(authenticateCronRequest({ headers: { cookie: `app_session_id=${token}` } }, {
      env: { JWT_SECRET: secret, OAUTH_SERVER_URL: 'https://oauth.example/', VITE_APP_ID: 'project-test' },
      fetchImpl,
      nowSeconds: 1_000,
    })).resolves.toBeNull();
  });

  it('rejects a tampered cron session before any provider action', () => {
    const secret = 'test-cron-secret';
    const token = makeCronToken({ openId: 'cron_project_task', exp: 2_000 }, secret);
    expect(_private.verifyCronJwt(`${token}x`, secret, 1_000)).toBeNull();
  });
});
