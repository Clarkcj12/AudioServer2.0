/**
 * Admin portal in-game OTT callback — `GET /auth/admin-callback?token=<ott>`
 *
 * Admins receive this URL when they run `/audio admin` in Minecraft.
 * This handler:
 *   1. Exchanges the OTT for an admin JWT via the relay.
 *   2. Stores the JWT in the httpOnly admin session cookie.
 *   3. Redirects to /dashboard.
 *
 * The token is single-use (GETDEL) and expires in 5 minutes.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(new URL('/auth/error?reason=missing-token', request.url));
  }

  let res: Response;
  try {
    res = await fetch(`${RELAY}/api/auth/admin-ott`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.redirect(new URL('/auth/error?reason=relay-unreachable', request.url));
  }

  if (!res.ok) {
    return NextResponse.redirect(new URL('/auth/error?reason=invalid-token', request.url));
  }

  const { jwt } = (await res.json()) as { jwt: string };

  const response = NextResponse.redirect(new URL('/dashboard', request.url));
  response.cookies.set(ADMIN_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 12,
    path: '/',
  });
  return response;
}
