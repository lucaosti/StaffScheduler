/**
 * OIDC authorization-code flow: builds the authorization redirect, exchanges
 * a code for tokens, verifies the ID token, and resolves the result to a
 * local account.
 *
 * WHY HAND-ROLLED RATHER THAN PASSPORT. `passport`'s strategy model assumes
 * `req.session`/`req.login()` — this application has no `express-session`
 * anywhere (JWT cookies are the entire session model, by design), and every
 * `sso_providers` row is a DIFFERENT, per-organization IdP configuration
 * resolved at request time, not a strategy registered once at startup the
 * way passport expects. Adding a session-based auth framework on top of a
 * stateless-JWT app to gain a library wrapper around "redirect here, verify
 * that" would be more surface area than the wrapper saves. The actual
 * protocol work below — building the authorization URL, exchanging a code,
 * verifying a JWT against a JWKS endpoint — is exactly what `WebhookWorker`/
 * `GustoProvider` already do for their own outbound HTTP calls in this
 * codebase, so this follows the same fetch+AbortController shape rather than
 * introducing a different one.
 *
 * WHY MANUAL ENDPOINT CONFIGURATION, NOT `.well-known/openid-configuration`
 * DISCOVERY. Discovery is one more runtime network call and one more trust
 * decision (does the deployment fetch and cache a document from a URL an
 * admin typed once, and for how long). An administrator configuring a
 * provider already has to know which IdP they are pointing at; asking them
 * to paste the three URLs OIDC discovery would otherwise resolve is a modest
 * extra step for a meaningfully smaller runtime attack surface, and every
 * major IdP (Google, Microsoft Entra ID, Okta, Auth0) publishes these
 * plainly in its own documentation.
 *
 * SECURITY PROPERTIES THIS FLOW DEPENDS ON, STATED EXPLICITLY:
 *   - `state` is a random value round-tripped through the IdP and checked
 *     against a short-lived httpOnly cookie set at `/login` — CSRF
 *     protection: without it, an attacker could send a victim a crafted
 *     callback URL for the ATTACKER's own IdP session.
 *   - `nonce` is likewise random, sent in the authorization request and
 *     required back inside the verified ID token's own claims — replay
 *     protection: without it, a previously-issued, still-valid ID token
 *     could be replayed against a fresh login attempt.
 *   - The ID token signature is verified against the provider's OWN JWKS
 *     endpoint, with the algorithm PINNED to `RS256` rather than trusting
 *     the token's own `alg` header — the standard defense against
 *     algorithm-confusion attacks (an attacker cannot downgrade to `HS256`
 *     and sign with a public value like the issuer's own public key).
 *   - `iss` and `aud` are verified against the configured provider, so a
 *     validly-signed token from a DIFFERENT client registration on the SAME
 *     IdP cannot be replayed here.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import crypto from 'crypto';
import jwt, { JwtHeader, JwtPayload, SigningKeyCallback } from 'jsonwebtoken';
import type { JwksClient } from 'jwks-rsa';
import { UserService } from './UserService';
import { ConflictError, ForbiddenError } from '../errors';
import { logger } from '../config/logger';
import type { User } from '../types';
import type { SsoProvider } from './SsoProviderService';

const REQUEST_TIMEOUT_MS = 15_000;

export interface OidcProfile {
  sub: string;
  email?: string;
  givenName?: string;
  familyName?: string;
  fullName?: string;
}

/**
 * One JWKS client per issuer, reused across requests for its own key cache.
 *
 * `jwks-rsa` is required LAZILY, on first actual use, rather than imported
 * at module load — its own dependency chain includes an ESM-only package,
 * and this service is imported (via `routes/auth.ts`) by every consumer of
 * the auth router, including tests that never touch SSO at all. A top-level
 * import would force that ESM package through Jest's CJS transform on every
 * such test, whether or not it ever verifies a token.
 */
const jwksClients = new Map<string, JwksClient>();
const getJwksClientFor = async (provider: SsoProvider): Promise<JwksClient> => {
  let client = jwksClients.get(provider.jwksUrl);
  if (!client) {
    const { default: jwksClientFactory } = await import('jwks-rsa');
    client = jwksClientFactory({ jwksUri: provider.jwksUrl, cache: true, cacheMaxEntries: 10, cacheMaxAge: 3_600_000, rateLimit: true });
    jwksClients.set(provider.jwksUrl, client);
  }
  return client;
};

export class SsoAuthService {
  constructor(private pool: Pool) {}

  /** The URL to redirect the browser to, to start the IdP's login flow. */
  buildAuthorizationUrl(
    provider: SsoProvider,
    redirectUri: string,
    state: string,
    nonce: string
  ): string {
    const url = new URL(provider.authorizationUrl);
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    return url.toString();
  }

  /** Exchanges an authorization code for an ID token at the provider's token endpoint. */
  async exchangeCodeForIdToken(
    provider: SsoProvider,
    code: string,
    redirectUri: string
  ): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
        }).toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new ConflictError(
          `Identity provider token exchange failed (${response.status})${body ? `: ${body}` : ''}`
        );
      }
      const data = (await response.json().catch(() => ({}))) as { id_token?: string };
      if (!data.id_token) {
        throw new ConflictError('Identity provider response did not include an id_token');
      }
      return data.id_token;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Verifies the ID token's signature (RS256 only, against the provider's own
   * JWKS), issuer, audience and nonce, then extracts the profile.
   */
  async verifyIdToken(provider: SsoProvider, idToken: string, expectedNonce: string): Promise<OidcProfile> {
    const client = await getJwksClientFor(provider);
    const getKey = (header: JwtHeader, callback: SigningKeyCallback): void => {
      if (!header.kid) {
        callback(new Error('ID token header is missing "kid"'));
        return;
      }
      client.getSigningKey(header.kid, (err, key) => {
        if (err || !key) {
          callback(err ?? new Error('Signing key not found'));
          return;
        }
        callback(null, key.getPublicKey());
      });
    };

    const claims = await new Promise<JwtPayload>((resolve, reject) => {
      jwt.verify(
        idToken,
        getKey,
        // Pinned, never taken from the token's own header — the standard
        // defense against algorithm-confusion attacks.
        { algorithms: ['RS256'], issuer: provider.issuer, audience: provider.clientId },
        (err, decoded) => {
          if (err || !decoded || typeof decoded === 'string') {
            reject(err ?? new Error('ID token verification failed'));
            return;
          }
          resolve(decoded);
        }
      );
    });

    if (claims.nonce !== expectedNonce) {
      throw new ConflictError('ID token nonce did not match the login attempt');
    }
    if (!claims.sub) {
      throw new ConflictError('ID token is missing a subject claim');
    }

    return {
      sub: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      givenName: typeof claims.given_name === 'string' ? claims.given_name : undefined,
      familyName: typeof claims.family_name === 'string' ? claims.family_name : undefined,
      fullName: typeof claims.name === 'string' ? claims.name : undefined,
    };
  }

  /**
   * Resolves a verified profile to a local `User`, in order:
   *   1. An existing `sso_identities` link for this (provider, subject) —
   *      the ordinary returning-user case.
   *   2. An existing local account matched by email — account linking, on
   *      the FIRST federated login for a person who already has a password
   *      account. Recorded as a link so future logins skip straight to (1).
   *   3. A newly-created account, only when the provider has JIT
   *      provisioning enabled — the access-control decision an
   *      administrator opts into per provider, never assumed.
   *
   * An inactive account is refused at every branch rather than silently
   * granted a session — successfully authenticating at the IdP is not by
   * itself a reason to override an administrator having deactivated the
   * local account.
   */
  async findOrCreateUser(provider: SsoProvider, profile: OidcProfile): Promise<User> {
    const userService = new UserService(this.pool);

    const [linkedRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM sso_identities WHERE provider_id = ? AND subject_id = ? LIMIT 1`,
      [provider.id, profile.sub]
    );
    if (linkedRows.length > 0) {
      const user = await userService.getUserById(linkedRows[0].user_id as number);
      if (!user || !user.isActive) throw new ForbiddenError('This account is not active');
      return user;
    }

    if (!profile.email) {
      throw new ConflictError('The identity provider did not supply an email address');
    }

    const existingUser = await userService.getUserByEmail(profile.email);
    if (existingUser) {
      if (!existingUser.isActive) throw new ForbiddenError('This account is not active');
      await this.linkIdentity(existingUser.id as number, provider.id, profile);
      return existingUser;
    }

    if (!provider.jitProvisioningEnabled) {
      throw new ForbiddenError(
        'No account exists for this identity, and just-in-time provisioning is disabled for this provider'
      );
    }

    const [givenFallback, ...familyFallback] = (profile.fullName ?? 'SSO User').split(' ');
    const created = await userService.createUser({
      email: profile.email,
      // Never used to sign in locally — this account only ever authenticates
      // through the IdP, so a random value nobody knows is the whole point,
      // not a placeholder pending a "set your password" step.
      password: crypto.randomBytes(32).toString('hex'),
      firstName: profile.givenName || givenFallback || 'SSO',
      lastName: profile.familyName || familyFallback.join(' ') || 'User',
      roleIds: provider.defaultRoleId ? [provider.defaultRoleId] : undefined,
    });
    if (provider.organizationName) {
      await userService.updateUser(created.id as number, { organizationName: provider.organizationName });
    }
    await this.linkIdentity(created.id as number, provider.id, profile);
    logger.info(`JIT-provisioned user ${created.id} via SSO provider ${provider.id} (${provider.name})`);
    return created;
  }

  private async linkIdentity(userId: number, providerId: number, profile: OidcProfile): Promise<void> {
    await this.pool.execute(
      `INSERT INTO sso_identities (user_id, provider_id, subject_id, raw_profile) VALUES (?, ?, ?, ?)`,
      [userId, providerId, profile.sub, JSON.stringify(profile)]
    );
  }
}
