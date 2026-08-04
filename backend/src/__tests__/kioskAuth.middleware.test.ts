/**
 * kioskAuth middleware unit tests.
 */

jest.mock('../config/database', () => ({
  database: { getPool: jest.fn() },
}));

jest.mock('../services/KioskService');

import { authenticateKiosk } from '../middleware/kioskAuth';
import { KioskService } from '../services/KioskService';

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('authenticateKiosk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 MISSING_KIOSK_TOKEN when the header is absent', async () => {
    const req: any = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    await authenticateKiosk(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'MISSING_KIOSK_TOKEN' }) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 MISSING_KIOSK_TOKEN when the header is an empty string', async () => {
    const req: any = { headers: { 'x-kiosk-token': '' } };
    const res = mockRes();
    const next = jest.fn();

    await authenticateKiosk(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 INVALID_KIOSK_TOKEN when the token does not resolve to a device', async () => {
    (KioskService.prototype.authenticate as jest.Mock).mockResolvedValue(null);
    const req: any = { headers: { 'x-kiosk-token': 'deadbeef' } };
    const res = mockRes();
    const next = jest.fn();

    await authenticateKiosk(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: 'INVALID_KIOSK_TOKEN' }) })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches req.kiosk and calls next for a valid token', async () => {
    (KioskService.prototype.authenticate as jest.Mock).mockResolvedValue({
      id: 9,
      name: 'Break room tablet',
      departmentId: 3,
      isActive: true,
      createdAt: 'x',
      lastUsedAt: null,
    });
    const req: any = { headers: { 'x-kiosk-token': 'sometoken' } };
    const res = mockRes();
    const next = jest.fn();

    await authenticateKiosk(req, res, next);

    expect(req.kiosk).toEqual({ id: 9, name: 'Break room tablet', departmentId: 3 });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
