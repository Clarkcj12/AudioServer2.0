/**
 * Player authentication helpers for the AudioServer 2.0 Advanced Portal.
 *
 * Player JWTs are signed by the Rust relay (not the portal) using the same
 * JWT_SECRET.  They have no `role` claim and a `sub` equal to the player's
 * Minecraft UUID.  Verification is used by the proxy to protect player routes.
 */
import { jwtVerify } from 'jose';

export const PLAYER_COOKIE = 'as_player_token';

const secret = () =>
  new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-CHANGE-ME');

/**
 * Verify a player JWT from the session cookie.
 * Returns `true` only if the token is valid, unexpired, and carries no admin role.
 */
export async function verifyPlayerToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === 'string' && !payload['role'];
  } catch {
    return false;
  }
}
