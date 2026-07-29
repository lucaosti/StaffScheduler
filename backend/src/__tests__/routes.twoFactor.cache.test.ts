/**
 * Two-factor transitions must drop the cached auth context.
 *
 * `twoFactorEnabled` travels on the authenticated user, and that object is what
 * `_setCachedAuthContext` serialises. The cache is opt-in and off by default —
 * which is exactly why this is worth a test rather than an assumption: nothing
 * in a default-configuration test run would ever notice the omission, and the
 * failure only appears in the deployments that turned an optimisation on.
 *
 * Enabling with a stale entry leaves the settings page offering to set up 2FA
 * that is already on. Disabling with a stale entry is worse: the page asks for
 * a code from a secret the account no longer has.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const invalidateAuthContext = jest.fn();
const service = {
  beginSetup: jest.fn(),
  confirmEnable: jest.fn(),
  disable: jest.fn(),
  verifyCode: jest.fn(),
  consumeRecoveryCode: jest.fn(),
};

jest.mock('../services/TwoFactorService', () => ({
  TwoFactorService: jest.fn().mockImplementation(() => service),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7, email: 'a@b.c' };
    next();
  },
  invalidateAuthContext: (...args: unknown[]) => invalidateAuthContext(...args),
}));

const mountApp = () => {
  const { createTwoFactorRouter } = require('../routes/twoFactor');
  const app = express();
  app.use(express.json());
  app.use('/api/auth/2fa', createTwoFactorRouter({} as never));
  return app;
};

beforeEach(() => {
  invalidateAuthContext.mockReset().mockResolvedValue(undefined);
  Object.values(service).forEach((fn) => fn.mockReset());
});

describe('two-factor cache invalidation', () => {
  it('drops the cached context when 2FA is enabled', async () => {
    service.confirmEnable.mockResolvedValue({ recoveryCodes: ['a', 'b'] });

    const res = await request(mountApp()).post('/api/auth/2fa/enable').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(invalidateAuthContext).toHaveBeenCalledWith(7);
  });

  it('drops the cached context when 2FA is disabled', async () => {
    service.verifyCode.mockResolvedValue(true);

    const res = await request(mountApp()).post('/api/auth/2fa/disable').send({ code: '123456' });

    expect(res.status).toBe(200);
    expect(invalidateAuthContext).toHaveBeenCalledWith(7);
  });

  it('leaves the cache alone when enabling is refused', async () => {
    service.confirmEnable.mockRejectedValue(new Error('Invalid code'));

    const res = await request(mountApp()).post('/api/auth/2fa/enable').send({ code: '000000' });

    expect(res.status).toBe(400);
    // Nothing changed, so nothing to invalidate — and dropping a valid entry
    // on every rejected attempt would turn a typo into a burst of re-reads.
    expect(invalidateAuthContext).not.toHaveBeenCalled();
  });

  it('leaves the cache alone when disabling is refused', async () => {
    service.verifyCode.mockResolvedValue(false);
    service.consumeRecoveryCode.mockResolvedValue(false);

    const res = await request(mountApp()).post('/api/auth/2fa/disable').send({ code: '000000' });

    expect(res.status).toBe(401);
    expect(service.disable).not.toHaveBeenCalled();
    expect(invalidateAuthContext).not.toHaveBeenCalled();
  });

  it('does not invalidate on setup, which changes nothing observable', async () => {
    service.beginSetup.mockResolvedValue({ secret: 's', otpauthUri: 'otpauth://x' });

    await request(mountApp()).post('/api/auth/2fa/setup').send({});

    // Setup stores a secret and leaves `totp_enabled` false, so the cached
    // user is still accurate.
    expect(invalidateAuthContext).not.toHaveBeenCalled();
  });
});
