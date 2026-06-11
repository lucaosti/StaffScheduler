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
import { authenticate } from '../middleware/auth';
import { validateBody } from '../middleware/validation';
import { twoFactorCodeBody } from '../schemas';
import { TwoFactorService } from '../services/TwoFactorService';
import { logger } from '../config/logger';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTwoFactorRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TwoFactorService(pool);

  router.use(authenticate);

  router.post('/setup', async (req: Request, res: Response) => {
    try {
      const data = await service.beginSetup(req.user!.id, req.user!.email);
      res.json({ success: true, data });
    } catch (err) {
      logger.error('2fa setup error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to start 2FA setup');
    }
  });

  router.post('/enable', validateBody(twoFactorCodeBody), async (_req: Request, res: Response) => {
    try {
      const code = res.locals.body.code as string;
      const data = await service.confirmEnable(_req.user!.id, code);
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'TOTP_ENABLE_FAILED', (err as Error).message);
    }
  });

  router.post('/disable', validateBody(twoFactorCodeBody), async (req: Request, res: Response) => {
    try {
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
      res.json({ success: true });
    } catch (err) {
      logger.error('2fa disable error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to disable 2FA');
    }
  });

  router.post('/verify', validateBody(twoFactorCodeBody), async (_req: Request, res: Response) => {
    try {
      const code = res.locals.body.code as string;
      const ok = await service.verifyCode(_req.user!.id, code);
      res.json({ success: true, data: { valid: ok } });
    } catch (err) {
      logger.error('2fa verify error:', err);
      respondError(res, 500, 'INTERNAL_ERROR', 'Failed to verify 2FA code');
    }
  });

  return router;
};
