const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

const COOKIE_NAME = 'ds_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secret() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not set. Add it to your .env.local file — see .env.example.'
    );
  }
  return process.env.JWT_SECRET;
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createSessionCookie(user) {
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    secret(),
    { expiresIn: MAX_AGE_SECONDS }
  );
  return cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

function clearSessionCookie() {
  return cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

// Reads and verifies the session cookie from an incoming request.
// Returns the decoded { id, username, role } payload, or null.
function getSessionFromReq(req) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, secret());
  } catch (err) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionCookie,
  clearSessionCookie,
  getSessionFromReq,
  COOKIE_NAME,
};
