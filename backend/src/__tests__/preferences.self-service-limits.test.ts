/**
 * An employee must not be able to change their own working-time limits.
 *
 * `PUT /api/preferences/me` is guarded by `authenticate` alone — deliberately,
 * because it is self-service. But its body used to accept `maxHoursPerWeek`,
 * `minHoursPerWeek` and `maxConsecutiveDays`, which are not preferences at
 * all: they are the limits the optimizer enforces as HARD constraints. Any
 * employee could therefore raise their own maximum weekly hours and
 * consecutive working days, and the scheduler would then legitimately assign
 * them more work. In most jurisdictions those are legally bounded.
 *
 * WHY THESE ASSERT THE STORED VALUE AND NOT THE RESPONSE STATUS. Zod strips
 * unknown keys, so the request succeeds either way and returns 200 with the
 * unchanged preferences. A test asserting "the call worked" passes against the
 * defect. What has to be checked is that the limit never reached the UPDATE.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const upsert = jest.fn();

jest.mock('../services/PreferencesService', () => ({
  PreferencesService: jest.fn().mockImplementation(() => ({
    getByUserId: jest.fn().mockResolvedValue(null),
    upsert,
  })),
}));

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = { id: 7, permissions: ['preferences.manage'] };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mountApp = () => {
  // Required lazily so the mocks above are in place first.
  const { createPreferencesRouter } = require('../routes/preferences');
  const app = express();
  app.use(express.json());
  app.use('/api/preferences', createPreferencesRouter({} as never));
  return app;
};

describe('PUT /api/preferences/me', () => {
  beforeEach(() => {
    upsert.mockReset();
    upsert.mockResolvedValue({ userId: 7 });
  });

  it('accepts the genuine preferences', async () => {
    const res = await request(mountApp())
      .put('/api/preferences/me')
      .send({ preferredShifts: [1, 2], avoidShifts: [3], notes: 'mornings please' });

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(7, {
      preferredShifts: [1, 2],
      avoidShifts: [3],
      notes: 'mornings please',
    });
  });

  it.each([
    ['maxHoursPerWeek', 80],
    ['minHoursPerWeek', 60],
    ['maxConsecutiveDays', 14],
  ])('does not pass %s through to the service', async (field, value) => {
    await request(mountApp())
      .put('/api/preferences/me')
      .send({ [field]: value, notes: 'unrelated' });

    // The request is accepted — Zod strips the unknown key rather than
    // rejecting — so the meaningful assertion is that the limit never
    // reached the write path.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][1]).not.toHaveProperty(field);
  });

  it('still lets a manager set limits for someone else', async () => {
    // The counterpart route is gated on `preferences.manage`, so the limits
    // remain settable by someone with the authority to set them. Narrowing the
    // self-service body must not have removed the capability entirely.
    const res = await request(mountApp())
      .put('/api/preferences/9')
      .send({ maxHoursPerWeek: 32, maxConsecutiveDays: 4 });

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(9, { maxHoursPerWeek: 32, maxConsecutiveDays: 4 });
  });
});
