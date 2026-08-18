const crypto = require('crypto');

const CRON_PREFIX = 'cron_';
const USER_INFO_WITH_JWT_PATH = '/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt';

function getCookieValue(cookieHeader, name) {
  if (typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

function getSessionToken(req) {
  const cookieToken = getCookieValue(req.headers?.cookie, 'app_session_id');
  if (cookieToken) return cookieToken;
  const authorization = req.headers?.authorization;
  return typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;
}

function decodeBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function verifyCronJwt(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(decodeBase64Url(headerPart));
    payload = JSON.parse(decodeBase64Url(payloadPart));
  } catch (_) {
    return null;
  }
  if (header?.alg !== 'HS256' || typeof payload?.openId !== 'string' || !payload.openId.startsWith(CRON_PREFIX)) {
    return null;
  }
  if (payload.exp !== undefined && (!Number.isFinite(payload.exp) || payload.exp < nowSeconds)) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest();
  let received;
  try {
    received = Buffer.from(signaturePart, 'base64url');
  } catch (_) {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  return payload;
}

async function authenticateCronRequest(req, {
  env = process.env,
  fetchImpl = fetch,
  nowSeconds,
} = {}) {
  const token = getSessionToken(req);
  const payload = verifyCronJwt(token, env.JWT_SECRET, nowSeconds);
  if (!payload) return null;

  const baseUrl = env.OAUTH_SERVER_URL;
  const projectId = env.VITE_APP_ID;
  if (!baseUrl || !projectId) return null;
  const response = await fetchImpl(new URL(USER_INFO_WITH_JWT_PATH, baseUrl).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jwtToken: token, projectId }),
  });
  if (!response.ok) return null;
  const userInfo = await response.json().catch(() => null);
  if (!userInfo || !userInfo.taskUid) return null;
  return { isCron: true, taskUid: String(userInfo.taskUid) };
}

module.exports = {
  authenticateCronRequest,
  _private: { getCookieValue, getSessionToken, verifyCronJwt, USER_INFO_WITH_JWT_PATH },
};
