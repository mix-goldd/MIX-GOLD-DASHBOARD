const PUBLIC_SITE_HOST = 'mix-goldd.vercel.app';
const DASHBOARD_HOST = 'mix-gold-dashboard.vercel.app';

function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
}

function isPublicSiteHost(hostname) {
  const host = normalizeHostname(hostname);
  return host === PUBLIC_SITE_HOST || host === `www.${PUBLIC_SITE_HOST}`;
}

function isDashboardHost(hostname) {
  return normalizeHostname(hostname) === DASHBOARD_HOST;
}

function routeForHost(hostname, pathname) {
  const path = pathname || '/';

  if (isPublicSiteHost(hostname)) {
    if (path === '/' || path === '/site' || path === '/site/' || path === '/login' || path === '/setup' || path.startsWith('/dashboard')) {
      return { type: 'internal', destination: '/site/index.html' };
    }
    return null;
  }

  if (isDashboardHost(hostname)) {
    if (path === '/') {
      return { type: 'internal', destination: '/dashboard' };
    }
    if (path === '/site' || path.startsWith('/site/')) {
      return { type: 'external', destination: `https://${PUBLIC_SITE_HOST}/` };
    }
    if (path.startsWith('/post/') || path.startsWith('/watch/')) {
      return { type: 'external', destination: `https://${PUBLIC_SITE_HOST}${path}` };
    }
  }

  return null;
}

module.exports = {
  DASHBOARD_HOST,
  PUBLIC_SITE_HOST,
  isDashboardHost,
  isPublicSiteHost,
  normalizeHostname,
  routeForHost,
};
