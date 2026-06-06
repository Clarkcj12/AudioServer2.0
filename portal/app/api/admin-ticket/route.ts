/**
 * Server-side ticket endpoint for the admin event stream WebSocket.
 *
 * WHY THIS EXISTS
 * The browser WebSocket API cannot send custom headers, so the httpOnly admin
 * cookie cannot reach the relay directly.  This route:
 *   1. Reads the cookie server-side.
 *   2. Calls relay `POST /api/admin/ticket` with Bearer auth.
 *   3. Returns {ticket, wsUrl} to the browser.
 *
 * The browser then opens ws://<relay>/ws/admin?ticket=<uuid>.  Each ticket is
 * single-use and expires in 15 s — fetch a fresh one on every (re)connect.
 */
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

export async function GET(): Promise<NextResponse> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(`${RELAY}/api/admin/ticket`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ error: 'Relay unreachable' }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json({ error: 'Ticket issuance failed' }, { status: res.status });
  }

  const { ticket } = (await res.json()) as { ticket: string };
  const wsUrl = RELAY.replace(/^http/, 'ws') + '/ws/admin';
  return NextResponse.json({ ticket, wsUrl });
}
