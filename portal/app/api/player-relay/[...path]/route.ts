/**
 * Same-origin proxy for player-facing relay endpoints.
 *
 * Mirrors the admin proxy at /api/relay/[...path] but reads the player
 * session cookie (as_player_token) instead of the admin cookie.
 * Used by the preferences page client component to call /api/player/*.
 *
 * Routing:
 *   portal /api/player-relay/player/me       → relay /api/player/me
 *   portal /api/player-relay/player/settings → relay /api/player/settings
 */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { PLAYER_COOKIE } from '@/lib/player-auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const jar      = await cookies();
  const token    = jar.get(PLAYER_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const relayUrl = `${RELAY}/api/${path.join('/')}`;
  const headers  = new Headers();
  headers.set('Authorization', `Bearer ${token}`);

  const ct = request.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);

  const body =
    request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.arrayBuffer()
      : undefined;

  let relayRes: Response;
  try {
    relayRes = await fetch(relayUrl, { method: request.method, headers, body });
  } catch {
    return NextResponse.json({ error: 'Relay unreachable' }, { status: 502 });
  }

  const data = await relayRes.arrayBuffer();
  return new NextResponse(data, {
    status: relayRes.status,
    headers: {
      'Content-Type': relayRes.headers.get('Content-Type') ?? 'application/json',
    },
  });
}

export const GET = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
export const PUT = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
