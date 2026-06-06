/**
 * Admin authentication helpers for AudioServer 2.0 Pro Portal.
 *
 * ⚠️  PHASE 1 PLACEHOLDER — admin auth is not defined in the project spec.
 *
 * Current implementation: the admin logs in with a pre-shared secret
 * ({@code ADMIN_SECRET} env var). A short-lived HS256 JWT is issued using
 * the same {@code JWT_SECRET} as the Rust relay, stored in an httpOnly cookie.
 *
 * This is intentionally minimal. Production alternatives to evaluate:
 *  - Auth.js (NextAuth) with an OAuth provider
 *  - Clerk / WorkOS for managed auth
 *  - mTLS client certificates for internal tooling
 *
 * The cookie name and JWT claim shape below are stable contracts —
 * changing them requires updating {@link middleware.ts} too.
 */

import { SignJWT, jwtVerify } from 'jose';

export const ADMIN_COOKIE = 'as_admin_token';

const secret = () =>
  new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-CHANGE-ME');

/**
 * Sign a new admin JWT valid for 12 hours.
 * Called by the login API route after validating the admin secret.
 */
export async function signAdminToken(): Promise<string> {
  return new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('portal-admin')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());
}

/**
 * Verify an admin JWT. Safe to call in Edge middleware (no Node.js APIs).
 *
 * @returns `true` if the token is valid and carries {@code role: "admin"}
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.role === 'admin';
  } catch {
    return false;
  }
}
