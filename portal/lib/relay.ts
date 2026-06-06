/**
 * Server-only fetch helper for the AudioServer relay REST API.
 *
 * Reads the admin JWT from the httpOnly cookie and adds it as a Bearer header.
 * Use this in React Server Components and Next.js Server Actions that need to
 * call the relay directly (no proxy hop).
 *
 * Do NOT import this in client components — it depends on `next/headers`.
 */
import { cookies } from 'next/headers';
import { ADMIN_COOKIE } from '@/lib/auth';

const RELAY = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

/**
 * Fetch from the Rust relay with the admin JWT from the session cookie.
 *
 * @param path  Path relative to the relay root, e.g. `"api/stats"`.
 * @param init  Standard `RequestInit` options (method, body, cache, etc.).
 */
export async function relayFetch(path: string, init?: RequestInit): Promise<Response> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value ?? '';

  return fetch(`${RELAY}/${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${token}`,
    },
  });
}
