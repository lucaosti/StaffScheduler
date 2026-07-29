/**
 * Two-factor routes (F15). All require an authenticated session.
 *
 *   POST /api/auth/2fa/setup    start setup, returns secret + otpauth uri
 *   POST /api/auth/2fa/enable   verify code, returns recovery codes
 *   POST /api/auth/2fa/disable  turn 2FA off (requires a valid TOTP or recovery code)
 *   POST /api/auth/2fa/verify   verify a code
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate, invalidateAuthContext } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validation';
import { twoFactorCodeBody } from '../schemas';
import { TwoFactorService } from '../services/TwoFactorService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTwoFactorRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TwoFactorService(pool);

  router.use(authenticate);

  router.post('/setup', asyncHandler(async (req: Request, res: Response) => {
    const data = await service.beginSetup(req.user!.id, req.user!.email);
    res.json({ success: true, data });
  }));

  router.post('/enable', validateBody(twoFactorCodeBody), async (_req: Request, res: Response) => {
    try {
      const code = res.locals.body.code as string;
      const data = await service.confirmEnable(_req.user!.id, code);
      // `twoFactorEnabled` is part of the cached auth context, so a stale entry
      // would keep telling the client 2FA is off and the settings page would
      // keep offering to set it up. The cache is opt-in and off by default;
      // this is what makes enabling it safe rather than subtly wrong.
      await invalidateAuthContext(_req.user!.id);
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'TOTP_ENABLE_FAILED', (err as Error).message);
    }
  });

  router.post('/disable', validateBody(twoFactorCodeBody), asyncHandler(async (req: Request, res: Response) => {
    const code = res.locals.body.code as string;
    const userId = req.user!.id;
    // Disabling 2FA weakens the account, so it demands the same proof of
    // possession as login: a current TOTP code or an unused recovery code.
    const valid =
      (await service.verifyCode(userId, code)) ||
      (await service.consumeRecoveryCode(userId, code));
    if (!valid) {
      return respondError(res, 401, 'TOTP_INVALID', 'Invalid two-factor authentication code');
    }
    await service.disable(userId);
    // Same reason as enable, and this direction matters more: a cached entry
    // still saying 2FA is ON would show a screen asking for a code the account
    // no longer has a secret for.
    await invalidateAuthContext(userId);
    res.json({ success: true });
  }));

  router.post('/verify', validateBody(twoFactorCodeBody), asyncHandler(async (_req: Request, res: Response) => {
    const code = res.locals.body.code as string;
    const ok = await service.verifyCode(_req.user!.id, code);
    res.json({ success: true, data: { valid: ok } });
  }));

  return router;
};
