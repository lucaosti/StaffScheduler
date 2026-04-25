/**
 * Two-factor routes (F15). All require an authenticated session.
 *
 *   POST /api/auth/2fa/setup    start setup, returns secret + otpauth uri
 *   POST /api/auth/2fa/enable   verify code, returns recovery codes
 *   POST /api/auth/2fa/disable  turn 2FA off
 *   POST /api/auth/2fa/verify   verify a code (used by future login flow)
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { TwoFactorService } from '../services/TwoFactorService';

const respondError = (res: Response, status: number, code: string, message: string): void => {
  res.status(status).json({ success: false, error: { code, message } });
};

export const createTwoFactorRouter = (pool: Pool): Router => {
  const router = Router();
  const service = new TwoFactorService(pool);

  router.use(authenticate);

  router.post('/setup', async (req: Request, res: Response) => {
    const data = await service.beginSetup(req.user!.id, req.user!.email);
    res.json({ success: true, data });
  });

  router.post('/enable', async (req: Request, res: Response) => {
    try {
      const code = (req.body?.code as string | undefined) ?? '';
      const data = await service.confirmEnable(req.user!.id, code);
      res.json({ success: true, data });
    } catch (err) {
      respondError(res, 400, 'TOTP_ENABLE_FAILED', (err as Error).message);
    }
  });

  router.post('/disable', async (req: Request, res: Response) => {
    await service.disable(req.user!.id);
    res.json({ success: true });
  });

  router.post('/verify', async (req: Request, res: Response) => {
    const code = (req.body?.code as string | undefined) ?? '';
    const ok = await service.verifyCode(req.user!.id, code);
    res.json({ success: true, data: { valid: ok } });
  });

  return router;
};
