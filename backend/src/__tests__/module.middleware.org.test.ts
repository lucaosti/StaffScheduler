/**
 * requireModuleForUser middleware tests.
 *
 * Covers:
 *   - passes when module is globally enabled and user has no org
 *   - blocks (404) when module is globally disabled and user has no org
 *   - passes when module is enabled by org override (global disabled, org enabled)
 *   - blocks when module is disabled by org override (global enabled, org disabled)
 *   - falls back to global when req.user is undefined
 *   - returns 503 on service error
 */

import { Request, Response, NextFunction } from 'express';

const mockIsEnabled = jest.fn();
const mockIsEnabledForOrg = jest.fn();

jest.mock('../services/ModuleService', () => ({
  ModuleService: jest.fn().mockImplementation(() => ({
    isEnabled: mockIsEnabled,
    isEnabledForOrg: mockIsEnabledForOrg,
  })),
}));

jest.mock('../config/database', () => ({
  database: { getPool: jest.fn().mockReturnValue({}) },
}));

// Import after mocks are in place
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requireModuleForUser } = require('../middleware/auth') as typeof import('../middleware/auth');

const makeReq = (user?: Partial<{ organizationName: string | null }>) =>
  ({ user, cookies: {} } as unknown as Request);

const makeRes = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status, json } as unknown as Response, status, json };
};

const makeNext = (): NextFunction => jest.fn();

afterEach(() => {
  mockIsEnabled.mockReset();
  mockIsEnabledForOrg.mockReset();
});

describe('requireModuleForUser', () => {
  it('calls next() when module is globally enabled and user has no org', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const req = makeReq({ organizationName: null });
    const { res } = makeRes();
    const next = makeNext();

    await requireModuleForUser('reporting')(req, res, next);

    expect(mockIsEnabled).toHaveBeenCalledWith('reporting');
    expect(mockIsEnabledForOrg).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when module is globally disabled and user has no org', async () => {
    mockIsEnabled.mockResolvedValue(false);
    const req = makeReq({ organizationName: null });
    const { res, status, json } = makeRes();
    const next = makeNext();

    await requireModuleForUser('reporting')(req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when org override enables a globally-disabled module', async () => {
    mockIsEnabledForOrg.mockResolvedValue(true);
    const req = makeReq({ organizationName: 'acme' });
    const { res } = makeRes();
    const next = makeNext();

    await requireModuleForUser('reporting')(req, res, next);

    expect(mockIsEnabledForOrg).toHaveBeenCalledWith('reporting', 'acme');
    expect(mockIsEnabled).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when org override disables a globally-enabled module', async () => {
    mockIsEnabledForOrg.mockResolvedValue(false);
    const req = makeReq({ organizationName: 'acme' });
    const { res, status, json } = makeRes();
    const next = makeNext();

    await requireModuleForUser('reporting')(req, res, next);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(next).not.toHaveBeenCalled();
  });

  it('falls back to global check when req.user is undefined', async () => {
    mockIsEnabled.mockResolvedValue(true);
    const req = makeReq(undefined);
    const { res } = makeRes();
    const next = makeNext();

    await requireModuleForUser('scheduling')(req, res, next);

    expect(mockIsEnabled).toHaveBeenCalledWith('scheduling');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 503 when the module service throws', async () => {
    mockIsEnabled.mockRejectedValue(new Error('DB connection lost'));
    const req = makeReq({ organizationName: null });
    const { res, status, json } = makeRes();
    const next = makeNext();

    await requireModuleForUser('scheduling')(req, res, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'SERVICE_UNAVAILABLE' }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
