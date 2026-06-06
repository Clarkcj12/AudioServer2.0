/**
 * Player portal OTT callback — `GET /auth/callback?token=<ott>`
 *
 * The Minecraft plugin sends players a link to this URL after they run
 * `/audio portal`.  This handler:
 *   1. Exchanges the OTT for a player JWT via the relay.
 *   2. Stores the JWT in a httpOnly cookie.
 *   3. Redirects to /preferences.
 *
 * Uses NextResponse.redirect() + response.cookies.set() — the correct
 * cookie-on-redirect pattern for Next.js 16 Route Handlers.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { PLAYER_COOKIE } from '@/lib/player-auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/auth/error?reason=missing-token', request.url));
  }

  let res: Response;
  try {
    res = await fetch(`${RELAY}/api/auth/player-callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(new URL('/auth/error?reason=relay-unreachable', request.url));
  }

  if (res.status === 503) {
    return NextResponse.redirect(new URL('/auth/error?reason=no-database', request.url));
  }
  if (!res.ok) {
    return NextResponse.redirect(new URL('/auth/error?reason=invalid-token', request.url));
  }

  const { jwt } = (await res.json()) as { jwt: string };

  const response = NextResponse.redirect(new URL('/preferences', request.url));
  response.cookies.set(PLAYER_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 12, // 12 hours
    path: '/',
  });
  return response;
}
