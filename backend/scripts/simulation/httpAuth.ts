/**
 * Session minting for HTTP actors.
 *
 * `POST /api/auth/login` is cookie-only by design (the JWT is never
 * returned in the response body, in any environment — see
 * `backend/src/routes/auth.ts`) — a deliberate security invariant this
 * harness does not touch. Every HTTP actor still calls the real endpoint
 * with the synthetic user's real (bcrypt-hashed) password, so the login
 * route itself — password verification, 2FA branch, rate limiting — gets
 * genuinely exercised and its success is asserted (200, `data.user`
 * present). For the *session* that authenticates the actor's subsequent
 * calls, the harness signs its own JWT locally: it already runs as a
 * trusted Node process with access to `config.jwt.secret`, and mints the
 * exact `{userId, jti}` payload shape `authenticate` expects
 * (`backend/src/middleware/auth.ts`), passed as a Bearer header. This
 * exercises the full authenticate/RBAC middleware chain on every downstream
 * call without requiring any change to the login route or its response
 * contract.
 *
 * @author Luca Ostinelli
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config';
import { HttpClient } from './httpClient';
import { MegaLog } from './megaLog';

/**
 * Logs in as `email` (verifying the real login endpoint), then mints a
 * locally-signed bearer token for the same user and attaches it to `client`.
 * Throws if the login call itself doesn't succeed — a login failure means
 * the synthetic user setup is broken, not a business-rule outcome to log
 * and continue past.
 */
export async function establishSession(
  client: HttpClient,
  log: MegaLog,
  email: string,
  password: string
): Promise<number> {
  const loginRes = await client.post<{ user: { id: number } }>('/auth/login', { email, password });
  if (loginRes.status !== 200 || !loginRes.body.data?.user?.id) {
    throw new Error(
      `HTTP actor login failed for ${email}: status=${loginRes.status} body=${JSON.stringify(loginRes.body)}`
    );
  }
  const userId = loginRes.body.data.user.id;

  const jti = crypto.randomUUID();
  const token = jwt.sign({ userId, jti }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
  client.setToken(token);
  log.info(`HTTP session established for user #${userId} (login verified + bearer token minted)`);
  return userId;
}
