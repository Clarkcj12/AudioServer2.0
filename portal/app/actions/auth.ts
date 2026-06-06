'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { signAdminToken, ADMIN_COOKIE } from '@/lib/auth';

export type LoginState = { error: string | null };

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 60 * 60 * 12, // 12 hours
  path: '/',
};

// ---------------------------------------------------------------------------
// Primary: credential login via relay (Argon2id, admin_users table)
// ---------------------------------------------------------------------------

export async function loginWithCredentials(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const username = formData.get('username');
  const password = formData.get('password');

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return { error: 'Username and password are required.' };
  }

  const relay = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3000';

  let res: Response;
  try {
    res = await fetch(`${relay}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'Could not reach the relay server.' };
  }

  if (res.status === 401) return { error: 'Invalid username or password.' };
  if (res.status === 503) return { error: 'Server error — database not available.' };
  if (!res.ok)           return { error: 'Authentication failed. Try again.' };

  const { jwt } = (await res.json()) as { jwt: string };
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, jwt, COOKIE_OPTS);

  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// Break-glass: ADMIN_SECRET env var (portal-side, no relay call)
// ---------------------------------------------------------------------------

export async function loginWithSecret(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const secret = formData.get('secret');

  if (typeof secret !== 'string' || secret !== process.env.ADMIN_SECRET) {
    return { error: 'Invalid admin secret.' };
  }

  const token = await signAdminToken();
  const jar = await cookies();
  jar.set(ADMIN_COOKIE, token, COOKIE_OPTS);

  redirect('/dashboard');
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

export async function logout(): Promise<never> {
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect('/login');
}
