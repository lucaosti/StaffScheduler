/**
 * Two-factor routes (F15). All require an authenticated session — for the
 * pre-session equivalent used during login (requesting a challenge for an
 * email/WebAuthn method before the session exists), see
 * `POST /api/auth/login/challenge` in `routes/auth.ts`.
 *
 *   GET  /api/auth/2fa/methods  list the caller's own enabled method types
 *   POST /api/auth/2fa/setup    start setup for a method, returns provider-specific setup data
 *   POST /api/auth/2fa/enable   verify a code/response, returns recovery codes
 *   POST /api/auth/2fa/disable  turn off ONE enrolled method (requires a valid code for THAT method, or a recovery code)
 *   POST /api/auth/2fa/verify   verify a code against one method (diagnostic / step-up use)
 *   POST /api/auth/2fa/challenge  request a fresh challenge for an already-enabled method (email code delivery, WebAuthn assertion options)
 *
 * `methodType` defaults to `'totp'` everywhere it's optional, so a caller
 * that only ever used TOTP (every request before #591) is unaffected.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, invalidateAuthContext } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { twoFactorChallengeBody, twoFactorCodeBody, twoFactorSetupBody } from '../schemas';
import { TwoFactorService } from '../services/TwoFactorService';
import { TwoFactorMethodType } from '../services/TwoFactorMethodProvider';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTwoFactorRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TwoFactorService(pool);

  router.use(authenticate);

  router.get('/methods', async (req: Request, res: Response) => {
    const methods = await service.listEnabledMethods(req.user!.id);
    res.json({ success: true, data: { methods } });
  });

  // No try/catch: a resolveProvider() ConflictError (unregistered method
  // type) reaches the central errorHandler and renders as its own proper
  // status/code, same as any other AppError; a genuine infrastructure
  // failure renders as 500 — swallowing both into one flat 400 here would
  // discard that distinction.
  router.post('/setup', validateBody(twoFactorSetupBody), async (req: Request, res: Response) => {
    const methodType = (res.locals.body.methodType as TwoFactorMethodType | undefined) ?? 'totp';
    const data = await service.beginSetup(req.user!.id, req.user!.email, methodType);
    res.json({ success: true, data });
  });

  router.post('/enable', validateBody(twoFactorCodeBody), async (req: Request, res: Response) => {
    const methodType = (res.locals.body.methodType as TwoFactorMethodType | undefined) ?? 'totp';
    try {
      const code = res.locals.body.code as string;
      const data = await service.confirmEnable(req.user!.id, code, methodType);
      // `twoFactorEnabled` is part of the cached auth context, so a stale entry
      // would keep telling the client 2FA is off and the settings page would
      // keep offering to set it up. The cache is opt-in and off by default;
      // this is what makes enabling it safe rather than subtly wrong.
      await invalidateAuthContext(req.user!.id);
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'TWO_FACTOR_ENABLE_FAILED', (err as Error).message);
    }
  });

  router.post('/disable', validateBody(twoFactorCodeBody), async (req: Request, res: Response) => {
    const methodType = (res.locals.body.methodType as TwoFactorMethodType | undefined) ?? 'totp';
    const code = res.locals.body.code as string;
    const userId = req.user!.id;
    // Disabling a method weakens the account, so it demands the same proof
    // of possession as login: a current code for THAT method, or an unused
    // recovery code (method-agnostic — it proves account ownership).
    const valid =
      (await service.verifyCode(userId, code, methodType)) ||
      (await service.consumeRecoveryCode(userId, code));
    if (!valid) {
      return respondError(res, 401, 'TWO_FACTOR_INVALID', 'Invalid two-factor authentication code');
    }
    await service.disable(userId, methodType);
    // Same reason as enable, and this direction matters more: a cached entry
    // still saying 2FA is ON would show a screen asking for a code the account
    // no longer has a secret for.
    await invalidateAuthContext(userId);
    res.json({ success: true });
  });

  router.post('/verify', validateBody(twoFactorCodeBody), async (req: Request, res: Response) => {
    const methodType = (res.locals.body.methodType as TwoFactorMethodType | undefined) ?? 'totp';
    const code = res.locals.body.code as string;
    const ok = await service.verifyCode(req.user!.id, code, methodType);
    res.json({ success: true, data: { valid: ok } });
  });

  // Same reasoning as /setup: let AppError subtypes (unregistered method,
  // "not enabled", "does not use a requested challenge" — all ConflictError)
  // reach the central errorHandler rather than flattening them into one code.
  router.post('/challenge', validateBody(twoFactorChallengeBody), async (req: Request, res: Response) => {
    const methodType = res.locals.body.methodType as TwoFactorMethodType;
    const data = await service.requestChallenge(req.user!.id, methodType);
    res.json({ success: true, data: data ?? null });
  });

  return router;
};
