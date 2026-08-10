/**
 * SSO (OIDC) login flow — `/api/v1/auth/sso/*`.
 *
 * Split out of `routes/auth.ts`, which had grown past ~600 lines mixing the
 * password-login session flow with this one. Mounted at the SAME `/auth`
 * prefix as that router (see `app.ts`) — a separate `Router` instance rather
 * than a sub-router of it, specifically so `req.baseUrl` here still resolves
 * to `/api/v1/auth` exactly as it did before the split, which is what the
 * state/nonce cookie paths and the IdP redirect URI are derived from.
 *
 * Issues the SAME session cookies `routes/auth.ts`'s `/login` issues on
 * success, via the shared `createSessionCookies` (`routes/authSession.ts`) —
 * one implementation of "what a session cookie is", not a second copy of it
 * for this flow.
 *
 * Provider CONFIGURATION (registering/editing an identity provider) is a
 * separate, `settings.manage`-gated concern in `routes/sso.ts` — this router
 * is the public login/callback flow only.
 *
 * @author Luca Ostinelli
 */

import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { Pool } from 'mysql2/promise';
import { validateParams, validateQuery } from '../middleware/validation';
import { idParam, ssoProvidersPublicQuery, ssoCallbackQuery } from '../schemas';
import { SsoProviderService } from '../services/SsoProviderService';
import { SsoAuthService } from '../services/SsoAuthService';
import { config } from '../config';
import { createSessionCookies } from './authSession';

const isProduction = config.server.env === 'production';

export const createSsoAuthRouter = (pool: Pool): Router => {
  const router = Router();
  const ssoProviders = new SsoProviderService(pool);
  const ssoAuth = new SsoAuthService(pool);
  const { setAccessCookie, setRefreshCookie } = createSessionCookies(pool);

  const STATE_COOKIE_NAME = 'sso_state';
  const NONCE_COOKIE_NAME = 'sso_nonce';

  /**
   * `redirect_uri` and the state/nonce cookie path both derive from
   * `req.baseUrl` + the literal route, the same reasoning
   * `refreshCookieOptions` already applies to the refresh cookie: a
   * hardcoded path is exactly what broke `/api/v1`'s refresh flow before,
   * and the identity provider is later asked to redirect back to this exact
   * URL, so it has to be right regardless of which prefix served the login.
   */
  const ssoCallbackPath = (req: Request, providerId: number): string =>
    `${req.baseUrl}/sso/${providerId}/callback`;

  const ssoRedirectUri = (req: Request, providerId: number): string =>
    `${req.protocol}://${req.get('host')}${ssoCallbackPath(req, providerId)}`;

  const ssoStateCookieOptions = (req: Request, providerId: number) => ({
    httpOnly: true,
    secure: isProduction,
    // NOT the strict cookie options `routes/auth.ts` uses, deliberately: this
    // cookie must survive the trip TO the identity provider and back — a
    // cross-SITE, top-level redirect FROM the IdP's own domain. `SameSite=
    // Strict` (used for every session cookie, all first-party XHR/fetch) is
    // never sent on a cross-site navigation, even a top-level GET, so a
    // Strict state cookie would silently never reach `/callback` and every
    // SSO login would fail with a state mismatch — indistinguishable from an
    // actual CSRF attempt. `Lax` is sent on top-level cross-site GETs, which
    // is exactly what an IdP redirect is, while still refusing it on a
    // cross-site POST/embed.
    sameSite: 'lax' as const,
    path: ssoCallbackPath(req, providerId),
    // Long enough for a real login (IdP consent screens, MFA prompts), short
    // enough that a stale cookie isn't a standing CSRF-window concern.
    maxAge: 5 * 60 * 1000,
  });

  const clearSsoCookies = (req: Request, res: Response, providerId: number): void => {
    const path = ssoCallbackPath(req, providerId);
    res.clearCookie(STATE_COOKIE_NAME, { path });
    res.clearCookie(NONCE_COOKIE_NAME, { path });
  };

  /**
   * Providers an unauthenticated login page may offer — name and id only,
   * never the client secret. `organizationName` is an optional query filter
   * so a caller who already knows which organization they belong to (e.g. a
   * subdomain-per-org frontend) sees only its own configured providers plus
   * any platform-wide one.
   *
   * @route GET /api/auth/sso/providers
   */
  router.get('/sso/providers', validateQuery(ssoProvidersPublicQuery), async (_req: Request, res: Response) => {
    const organizationName = (res.locals.query.organizationName as string | undefined) ?? null;
    const data = await ssoProviders.listPublic(organizationName);
    res.json({ success: true, data });
  });

  /**
   * Starts the OIDC authorization-code flow: redirects the browser to the
   * identity provider with a random `state` (CSRF) and `nonce` (ID-token
   * replay protection), each round-tripped via a short-lived, path-scoped
   * httpOnly cookie rather than server-side session state — this
   * application has none.
   *
   * @route GET /api/auth/sso/:id/login
   */
  router.get('/sso/:id/login', validateParams(idParam), async (req: Request, res: Response) => {
    const provider = await ssoProviders.getById(res.locals.params.id);
    if (!provider || !provider.isActive) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'SSO provider not found' } });
    }

    const state = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const cookieOptions = ssoStateCookieOptions(req, provider.id);
    res.cookie(STATE_COOKIE_NAME, state, cookieOptions);
    res.cookie(NONCE_COOKIE_NAME, nonce, cookieOptions);

    const authorizationUrl = ssoAuth.buildAuthorizationUrl(
      provider,
      ssoRedirectUri(req, provider.id),
      state,
      nonce
    );
    res.redirect(authorizationUrl);
  });

  /**
   * Completes the OIDC flow: verifies `state` against the cookie set at
   * `/login`, exchanges the authorization code for an ID token, verifies the
   * token (signature via the provider's JWKS, issuer, audience, and the
   * `nonce` against the cookie), resolves the result to a local account, and
   * issues the SAME session cookies `/login` issues on a password sign-in.
   *
   * This is a top-level BROWSER NAVIGATION (the identity provider redirects
   * the user's browser here), not an XHR/fetch call — on success it
   * redirects to the frontend rather than returning JSON, the same
   * expectation the browser already has for this request.
   *
   * @route GET /api/auth/sso/:id/callback
   */
  router.get('/sso/:id/callback', validateParams(idParam), validateQuery(ssoCallbackQuery), async (req: Request, res: Response) => {
    const providerId = res.locals.params.id as number;
    const provider = await ssoProviders.getById(providerId);
    if (!provider || !provider.isActive) {
      clearSsoCookies(req, res, providerId);
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'SSO provider not found' } });
    }

    const { code, state } = res.locals.query as { code?: string; state?: string };
    const cookieState = req.cookies?.[STATE_COOKIE_NAME] as string | undefined;
    const cookieNonce = req.cookies?.[NONCE_COOKIE_NAME] as string | undefined;
    clearSsoCookies(req, res, provider.id);

    // Constant-time-adjacent is not the concern here — `state` is a random
    // UUID with no secret comparison timing to leak; a plain equality check
    // is what every OAuth client library does for this exact comparison.
    if (!code || !state || !cookieState || !cookieNonce || state !== cookieState) {
      return res.status(400).json({
        success: false,
        error: { code: 'SSO_STATE_MISMATCH', message: 'This login attempt has expired or was not started here' },
      });
    }

    const idToken = await ssoAuth.exchangeCodeForIdToken(provider, code, ssoRedirectUri(req, provider.id));
    const profile = await ssoAuth.verifyIdToken(provider, idToken, cookieNonce);
    const user = await ssoAuth.findOrCreateUser(provider, profile);

    setAccessCookie(res, user.id);
    await setRefreshCookie(req, res, user.id);
    res.redirect(config.cors.origin);
  });

  return router;
};
