/**
 * Next.js 16 Proxy (replaces middleware.ts from earlier versions).
 * Runs in Node.js runtime — Edge runtime is not available here.
 *
 * Responsibilities:
 *  - Redirect `/` to `/dashboard` (admin authed), `/preferences` (player authed), or `/login`.
 *  - Protect admin routes — redirect unauthenticated requests to `/login`.
 *  - Protect player routes — redirect unauthenticated requests to `/auth/player-login`.
 *  - Redirect already-authed users away from login pages.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyAdminToken, ADMIN_COOKIE } from '@/lib/auth';
import { verifyPlayerToken, PLAYER_COOKIE } from '@/lib/player-auth';

const ADMIN_PREFIXES = [
  '/dashboard',
  '/sessions',
  '/regions',
  '/hardware',
  '/settings',
  '/events',
];

const PLAYER_PREFIXES = ['/preferences'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const adminToken  = request.cookies.get(ADMIN_COOKIE)?.value;
  const playerToken = request.cookies.get(PLAYER_COOKIE)?.value;

  const adminAuthed  = adminToken  ? await verifyAdminToken(adminToken)   : false;
  const playerAuthed = playerToken ? await verifyPlayerToken(playerToken)  : false;

  // Root redirect
  if (pathname === '/') {
    if (adminAuthed)  return NextResponse.redirect(new URL('/dashboard',   request.url));
    if (playerAuthed) return NextResponse.redirect(new URL('/preferences', request.url));
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Admin routes
  if (ADMIN_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!adminAuthed) {
      const url = new URL('/login', request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
  }

  // Player routes
  if (PLAYER_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!playerAuthed) {
      return NextResponse.redirect(new URL('/auth/player-login', request.url));
    }
  }

  // Redirect authed users away from login pages
  if (pathname === '/login' && adminAuthed) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  if (pathname === '/auth/player-login' && playerAuthed) {
    return NextResponse.redirect(new URL('/preferences', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.svg$).*)'],
};
