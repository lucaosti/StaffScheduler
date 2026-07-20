/**
 * Route handler tests for `routes/modules.ts`.
 *
 * Auth middleware is stubbed so that req.user is configurable per test.
 * ModuleService is fully mocked. The 401 and 403 scenarios are exercised by
 * temporarily swapping the stubbed middleware to return the appropriate
 * response, which matches real middleware behaviour without a live DB.
 *
 * Endpoints covered:
 *   GET  /api/modules           — list all modules (requires settings.manage)
 *   PUT  /api/modules/:code     — enable / disable a module (requires settings.manage)
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

// ── Configurable user for authenticated tests ─────────────────────────────────

let currentUser: { id: number; role: 'admin' | 'manager' | 'employee'; email: string } = {
  id: 1,
  role: 'admin',
  email: 'admin@example.com',
};

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      ...currentUser,
      isActive: true,
      permissions: require('./helpers/permissions').permissionsForRole(currentUser.role),
    };
    next();
  },
  // Enforce the permission check rather than bypassing it so that 403 tests work.
  requirePermission: (code: string) => (req: any, res: any, next: any) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    }
    if (!user.permissions || !user.permissions.includes(code)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Permission '${code}' required` } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
  // routes/modules.ts uses the shared singleton so its ModuleService.prototype
  // mocks (below) are the ones actually exercised by the route.
  getModuleService: () => new (require('../services/ModuleService').ModuleService)(),
}));

jest.mock('../services/ModuleService');

import { ModuleService } from '../services/ModuleService';
import { createModulesRouter } from '../routes/modules';
import { NotFoundError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/modules', createModulesRouter(fakePool));
  app.use(errorHandler);
  return app;
};

/** Build an app where authenticate always returns 401. */
const mountUnauthApp = (): express.Express => {
  const authModule = require('../middleware/auth');
  const saved = authModule.authenticate;
  authModule.authenticate = (_req: any, res: any, _next: any) =>
    res.status(401).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Authorization token is required' } });

  const app = express();
  app.use(express.json());
  app.use('/api/modules', createModulesRouter(fakePool));

  authModule.authenticate = saved;
  app.use(errorHandler);
  return app;
};

const moduleRows = [
  { id: 1, code: 'delegation', name: 'Delegation', description: 'Delegation feature', isEnabled: true, updatedAt: new Date() },
  { id: 2, code: 'approvals', name: 'Approvals', description: null, isEnabled: false, updatedAt: new Date() },
];

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('modules router GET /', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(mountUnauthApp()).get('/api/modules');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated user lacks settings.manage', async () => {
    currentUser = { id: 5, role: 'employee', email: 'emp@example.com' };

    const res = await request(mountApp()).get('/api/modules');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 with all modules for an admin', async () => {
    (ModuleService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue(moduleRows);

    const res = await request(mountApp()).get('/api/modules');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].code).toBe('delegation');
  });

  it('returns 200 with empty array when no modules exist', async () => {
    (ModuleService.prototype.list as jest.Mock) = jest.fn().mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/modules');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('returns 500 when service throws', async () => {
    (ModuleService.prototype.list as jest.Mock) = jest.fn().mockRejectedValue(new Error('db error'));

    const res = await request(mountApp()).get('/api/modules');

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('returns 403 when a manager (without settings.manage) requests the list', async () => {
    currentUser = { id: 9, role: 'manager', email: 'mgr@example.com' };

    const res = await request(mountApp()).get('/api/modules');

    expect(res.status).toBe(403);
  });
});

// ── PUT /:code ────────────────────────────────────────────────────────────────

describe('modules router PUT /:code', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(mountUnauthApp()).put('/api/modules/delegation').send({ isEnabled: true });
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated user lacks settings.manage', async () => {
    currentUser = { id: 5, role: 'employee', email: 'emp@example.com' };

    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: true });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 200 when module is enabled successfully', async () => {
    const updated = { ...moduleRows[0], isEnabled: true };
    (ModuleService.prototype.setEnabled as jest.Mock) = jest.fn().mockResolvedValue(updated);

    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isEnabled).toBe(true);
    expect(res.body.message).toContain('delegation');
    expect(res.body.message).toContain('enabled');
  });

  it('returns 200 when module is disabled successfully', async () => {
    const updated = { ...moduleRows[0], isEnabled: false };
    (ModuleService.prototype.setEnabled as jest.Mock) = jest.fn().mockResolvedValue(updated);

    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('disabled');
  });

  it('returns 400 when isEnabled is missing', async () => {
    const res = await request(mountApp()).put('/api/modules/delegation').send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when isEnabled is not a boolean', async () => {
    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when isEnabled is a number instead of boolean', async () => {
    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when module code does not exist', async () => {
    (ModuleService.prototype.setEnabled as jest.Mock) = jest.fn().mockRejectedValue(
      new NotFoundError('Module not found: ghost')
    );

    const res = await request(mountApp()).put('/api/modules/ghost').send({ isEnabled: true });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 500 on unknown service error', async () => {
    (ModuleService.prototype.setEnabled as jest.Mock) = jest.fn().mockRejectedValue(
      new Error('unexpected failure')
    );

    const res = await request(mountApp()).put('/api/modules/delegation').send({ isEnabled: true });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('passes the correct code and isEnabled flag to setEnabled', async () => {
    const setFn = jest.fn().mockResolvedValue({ code: 'approvals', isEnabled: false });
    (ModuleService.prototype.setEnabled as jest.Mock) = setFn;

    await request(mountApp()).put('/api/modules/approvals').send({ isEnabled: false });

    expect(setFn).toHaveBeenCalledWith('approvals', false, 1, null);
  });
});

// Org-override endpoints: per-org module state layered on the global flag.
// These pin the Zod param validation (org identifiers are length-bounded like
// every other URL param) and the exact argument wiring into ModuleService.

describe('modules router GET /org/:org', () => {
  it('returns the org-adjusted module list', async () => {
    (ModuleService.prototype.listWithOrgOverrides as jest.Mock) = jest
      .fn()
      .mockResolvedValue([{ code: 'attendance', isEnabled: false }]);

    const res = await request(mountApp()).get('/api/modules/org/acme');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ code: 'attendance', isEnabled: false }]);
    expect(ModuleService.prototype.listWithOrgOverrides).toHaveBeenCalledWith('acme');
  });

  it('rejects an org name longer than 120 characters', async () => {
    const res = await request(mountApp()).get('/api/modules/org/' + 'x'.repeat(121));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('is forbidden without settings.manage', async () => {
    currentUser = { id: 2, role: 'employee', email: 'e@example.com' };
    const res = await request(mountApp()).get('/api/modules/org/acme');
    expect(res.status).toBe(403);
  });

  it('returns 500 when the service fails', async () => {
    (ModuleService.prototype.listWithOrgOverrides as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new Error('db down'));

    const res = await request(mountApp()).get('/api/modules/org/acme');
    expect(res.status).toBe(500);
  });
});

describe('modules router PUT /:code/org/:org', () => {
  it('creates the override with actor id and justification', async () => {
    const setFn = jest.fn().mockResolvedValue({ code: 'attendance', org: 'acme', isEnabled: false });
    (ModuleService.prototype.setOrgOverride as jest.Mock) = setFn;

    const res = await request(mountApp())
      .put('/api/modules/attendance/org/acme')
      .send({ isEnabled: false, justification: 'pilot rollout' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("disabled for org 'acme'");
    expect(setFn).toHaveBeenCalledWith('attendance', 'acme', false, 1, 'pilot rollout');
  });

  it('defaults justification to null', async () => {
    const setFn = jest.fn().mockResolvedValue({});
    (ModuleService.prototype.setOrgOverride as jest.Mock) = setFn;

    await request(mountApp()).put('/api/modules/attendance/org/acme').send({ isEnabled: true });

    expect(setFn).toHaveBeenCalledWith('attendance', 'acme', true, 1, null);
  });

  it('rejects a non-boolean isEnabled', async () => {
    const res = await request(mountApp())
      .put('/api/modules/attendance/org/acme')
      .send({ isEnabled: 'yes' });
    expect(res.status).toBe(400);
  });

  it('renders a typed 404 when the module does not exist', async () => {
    (ModuleService.prototype.setOrgOverride as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new NotFoundError('Module not found: nope'));

    const res = await request(mountApp()).put('/api/modules/nope/org/acme').send({ isEnabled: true });
    expect(res.status).toBe(404);
  });
});

describe('modules router DELETE /:code/org/:org', () => {
  it('removes the override', async () => {
    (ModuleService.prototype.removeOrgOverride as jest.Mock) = jest.fn().mockResolvedValue(undefined);

    const res = await request(mountApp()).delete('/api/modules/attendance/org/acme');

    expect(res.status).toBe(200);
    expect(ModuleService.prototype.removeOrgOverride).toHaveBeenCalledWith('attendance', 'acme');
  });

  it('renders a typed 404 when there is no override', async () => {
    (ModuleService.prototype.removeOrgOverride as jest.Mock) = jest
      .fn()
      .mockRejectedValue(new NotFoundError('Override not found'));

    const res = await request(mountApp()).delete('/api/modules/attendance/org/acme');
    expect(res.status).toBe(404);
  });
});
