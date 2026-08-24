import { NextResponse } from 'next/server';
import routing from './lib/domainRouting';

const { routeForHost } = routing;

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
