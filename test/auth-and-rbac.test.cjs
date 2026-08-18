const {
  clearSessionCookie,
  createSessionCookie,
  getSessionFromReq,
  hashPassword,
  verifyPassword,
} = require('../lib/auth');
const { requireAuth } = require('../lib/api-auth');

function responseRecorder() {
  const record = { statusCode: null, body: null };
  return {
    record,
    status(code) {
      record.statusCode = code;
      return this;
    },
    json(body) {
      record.body = body;
      return this;
    },
  };
}

describe('JWT session and role guard', () => {
  it('signs, verifies, and clears a secure HTTP-only session', () => {
    const hash = hashPassword('correct-horse-battery-staple');
    expect(verifyPassword('correct-horse-battery-staple', hash)).toBe(true);
    expect(verifyPassword('wrong-password', hash)).toBe(false);

    const cookie = createSessionCookie({ id: 7, username: 'admin', role: 'admin' });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(getSessionFromReq({ headers: { cookie } })).toMatchObject({
      id: 7,
      username: 'admin',
      role: 'admin',
    });
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  it('rejects anonymous users and restricts admin operations by role', () => {
    const anonymousRes = responseRecorder();
    expect(requireAuth({ headers: {} }, anonymousRes)).toBeNull();
    expect(anonymousRes.record).toEqual({ statusCode: 401, body: { error: 'Not signed in.' } });

    const memberCookie = createSessionCookie({ id: 8, username: 'member', role: 'member' });
    const memberRes = responseRecorder();
    expect(
      requireAuth({ headers: { cookie: memberCookie } }, memberRes, { role: 'admin' })
    ).toBeNull();
    expect(memberRes.record).toEqual({
      statusCode: 403,
      body: { error: "You don't have permission to do that." },
    });
  });
});
