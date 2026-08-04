/**
 * Kiosk device authentication — see `services/KioskService.ts` for why this
 * is a separate credential type rather than a JWT.
 *
 * Uses the shared `database` singleton rather than an injected pool, the
 * same exception `authenticate` makes (see `config/database.ts`): both run
 * ahead of the router-factory pool-injection chain.
 *
 * @author Luca Ostinelli
 */

import { Request, Response, NextFunction } from 'express';
import { database } from '../config/database';
import { KioskService } from '../services/KioskService';

export const authenticateKiosk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const token = req.headers['x-kiosk-token'];
  if (typeof token !== 'string' || token.length === 0) {
    res.status(401).json({ success: false, error: { code: 'MISSING_KIOSK_TOKEN', message: 'A kiosk device token is required' } });
    return;
  }

  const kioskService = new KioskService(database.getPool());
  const device = await kioskService.authenticate(token);
  if (!device) {
    res.status(401).json({ success: false, error: { code: 'INVALID_KIOSK_TOKEN', message: 'Invalid or revoked kiosk token' } });
    return;
  }

  req.kiosk = { id: device.id, name: device.name, departmentId: device.departmentId };
  next();
};
