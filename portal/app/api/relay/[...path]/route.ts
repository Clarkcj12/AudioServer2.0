/**
 * Same-origin proxy for the AudioServer relay REST API.
 *
 * WHY THIS EXISTS
 * The admin JWT is stored as an httpOnly cookie — browser JS and the WebSocket
 * API cannot read it, so client components cannot call the relay directly with
 * `Authorization: Bearer`.  This route handler runs server-side, reads the
 * cookie, injects the header, and forwards the request transparently.
 *
 * Routing convention:
 *   portal   /api/relay/stats              → relay  /api/stats
 *   portal   /api/relay/sessions           → relay  /api/sessions
 *   portal   /api/relay/settings/<uuid>    → relay  /api/settings/<uuid>
 */
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE } from '@/lib/auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

type Ctx = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const relayUrl = `${RELAY}/api/${path.join('/')}`;
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);

  // Forward Content-Type for mutation requests
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

export const GET    = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
export const POST   = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
export const PUT    = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
export const DELETE = (req: NextRequest, ctx: Ctx) => proxy(req, ctx);
