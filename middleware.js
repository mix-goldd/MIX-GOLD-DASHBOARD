import { NextResponse } from 'next/server';

// Middleware executes in Vercel's Edge runtime. Keep this routing code
// self-contained and ESM-only; importing the CommonJS helper used by the
// server pages can fail at runtime and would affect every public request.
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

function routeForHost(hostname, pathname) {
  const host = normalizeHostname(hostname);
  const path = pathname || '/';

  if (host === PUBLIC_SITE_HOST || host === `www.${PUBLIC_SITE_HOST}`) {
    if (path === '/' || path === '/login' || path === '/setup' || path.startsWith('/dashboard')) {
      return { type: 'internal', destination: '/site' };
    }
    return null;
  }

  if (host === DASHBOARD_HOST) {
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

export function middleware(request) {
  const route = routeForHost(request.headers.get('host'), request.nextUrl.pathname);

  if (!route) {
    return NextResponse.next();
  }

  if (route.type === 'external') {
    const destination = new URL(route.destination);
    destination.search = request.nextUrl.search;
    return NextResponse.redirect(destination);
  }

  const destination = request.nextUrl.clone();
  destination.pathname = route.destination;
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
