/**
 * Route handler tests for `routes/responsibilityRules.ts`.
 *
 * Auth middleware is stubbed. ResponsibilityRuleService is fully mocked.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

const authState = { mode: 'pass' as 'pass' | 'reject401' | 'reject403' };

jest.mock('../middleware/auth', () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (authState.mode === 'reject401') {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No token' } });
    }
    req.user = { id: 1, isActive: true, permissions: ['responsibility.read', 'responsibility.manage'] };
    next();
  },
  requirePermission: () => (_req: any, res: any, next: any) => {
    if (authState.mode === 'reject403') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Missing permission' } });
    }
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user?.permissions?.includes(code)),
}));

jest.mock('../services/ResponsibilityRuleService');

import { ResponsibilityRuleService } from '../services/ResponsibilityRuleService';
import { createResponsibilityRulesRouter } from '../routes/responsibilityRules';
import { NotFoundError } from '../errors';
import { errorHandler } from '../middleware/errorHandler';

const fakePool = {} as never;

const mountApp = (): express.Express => {
  const app = express();
  app.use(express.json());
  app.use('/api/responsibility-rules', createResponsibilityRulesRouter(fakePool));
  app.use(errorHandler);
  return app;
};

const fakeRule = {
  id: 1,
  subjectType: 'org_unit',
  subjectId: 5,
  permissionCode: 'schedule.manage',
  responsibleOrgUnitId: 10,
  delegatedToRoleId: null,
  description: 'HQ manages all org-unit schedules',
  isActive: true,
  createdBy: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  authState.mode = 'pass';
});

// ── GET / ─────────────────────────────────────────────────────────────────────

describe('GET /api/responsibility-rules', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/responsibility-rules');
    expect(res.status).toBe(401);
  });

  it('returns 403 when missing responsibility.read', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).get('/api/responsibility-rules');
    expect(res.status).toBe(403);
  });

  it('returns 200 with rule list', async () => {
    (ResponsibilityRuleService.prototype.list as jest.Mock).mockResolvedValue([fakeRule]);
    const res = await request(mountApp()).get('/api/responsibility-rules');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('forwards filter params to service', async () => {
    (ResponsibilityRuleService.prototype.list as jest.Mock).mockResolvedValue([]);
    await request(mountApp()).get('/api/responsibility-rules?permissionCode=schedule.manage&isActive=true');
    expect(ResponsibilityRuleService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ permissionCode: 'schedule.manage', isActive: true })
    );
  });

  it('returns 500 on service error', async () => {
    (ResponsibilityRuleService.prototype.list as jest.Mock).mockRejectedValue(new Error('DB error'));
    const res = await request(mountApp()).get('/api/responsibility-rules');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ── GET /resolve ──────────────────────────────────────────────────────────────

describe('GET /api/responsibility-rules/resolve', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/responsibility-rules/resolve?permissionCode=schedule.manage');
    expect(res.status).toBe(401);
  });

  it('returns 400 when permissionCode is missing', async () => {
    const res = await request(mountApp()).get('/api/responsibility-rules/resolve');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with resolved user IDs', async () => {
    (ResponsibilityRuleService.prototype.resolveResponsibleUsers as jest.Mock).mockResolvedValue([3, 7]);
    const res = await request(mountApp())
      .get('/api/responsibility-rules/resolve?permissionCode=schedule.manage&orgUnitId=5');
    expect(res.status).toBe(200);
    expect(res.body.data.userIds).toEqual([3, 7]);
  });

  it('parses departmentIds and roleIds from comma-separated strings', async () => {
    (ResponsibilityRuleService.prototype.resolveResponsibleUsers as jest.Mock).mockResolvedValue([2]);
    await request(mountApp())
      .get('/api/responsibility-rules/resolve?permissionCode=x&departmentIds=1,2,3&roleIds=10,20');
    expect(ResponsibilityRuleService.prototype.resolveResponsibleUsers).toHaveBeenCalledWith(
      expect.objectContaining({ departmentIds: [1, 2, 3], roleIds: [10, 20] })
    );
  });

  it('returns 500 on service error', async () => {
    (ResponsibilityRuleService.prototype.resolveResponsibleUsers as jest.Mock).mockRejectedValue(new Error('fail'));
    const res = await request(mountApp()).get('/api/responsibility-rules/resolve?permissionCode=x');
    expect(res.status).toBe(500);
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

describe('GET /api/responsibility-rules/:id', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).get('/api/responsibility-rules/1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when not found', async () => {
    (ResponsibilityRuleService.prototype.getById as jest.Mock).mockResolvedValue(null);
    const res = await request(mountApp()).get('/api/responsibility-rules/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 with the rule', async () => {
    (ResponsibilityRuleService.prototype.getById as jest.Mock).mockResolvedValue(fakeRule);
    const res = await request(mountApp()).get('/api/responsibility-rules/1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
    expect(res.body.data.permissionCode).toBe('schedule.manage');
  });

  it('returns 400 on non-numeric id', async () => {
    const res = await request(mountApp()).get('/api/responsibility-rules/notanumber');
    expect(res.status).toBe(400);
  });
});

// ── POST / ────────────────────────────────────────────────────────────────────

describe('POST /api/responsibility-rules', () => {
  const validBody = {
    subjectType: 'org_unit',
    subjectId: 5,
    permissionCode: 'schedule.manage',
    responsibleOrgUnitId: 10,
  };

  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).post('/api/responsibility-rules').send(validBody);
    expect(res.status).toBe(401);
  });

  it('returns 403 when missing responsibility.manage', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).post('/api/responsibility-rules').send(validBody);
    expect(res.status).toBe(403);
  });

  it('returns 400 on invalid subjectType', async () => {
    const res = await request(mountApp())
      .post('/api/responsibility-rules')
      .send({ ...validBody, subjectType: 'invalid_type' });
    expect(res.status).toBe(400);
  });

  it('returns 201 on success', async () => {
    (ResponsibilityRuleService.prototype.create as jest.Mock).mockResolvedValue(fakeRule);
    const res = await request(mountApp()).post('/api/responsibility-rules').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(1);
    expect(res.body.message).toBe('Responsibility rule created');
  });

  it('returns 500 on service error', async () => {
    (ResponsibilityRuleService.prototype.create as jest.Mock).mockRejectedValue(new Error('DB fail'));
    const res = await request(mountApp()).post('/api/responsibility-rules').send(validBody);
    expect(res.status).toBe(500);
  });
});

// ── PUT /:id ──────────────────────────────────────────────────────────────────

describe('PUT /api/responsibility-rules/:id', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).put('/api/responsibility-rules/1').send({ isActive: false });
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid id', async () => {
    const res = await request(mountApp()).put('/api/responsibility-rules/abc').send({ isActive: false });
    expect(res.status).toBe(400);
  });

  it('returns 404 when service throws not found', async () => {
    (ResponsibilityRuleService.prototype.update as jest.Mock).mockRejectedValue(new NotFoundError('Responsibility rule not found'));
    const res = await request(mountApp()).put('/api/responsibility-rules/99').send({ isActive: false });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 on success', async () => {
    (ResponsibilityRuleService.prototype.update as jest.Mock).mockResolvedValue({ ...fakeRule, isActive: false });
    const res = await request(mountApp()).put('/api/responsibility-rules/1').send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(res.body.message).toBe('Responsibility rule updated');
  });
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

describe('DELETE /api/responsibility-rules/:id', () => {
  it('returns 401 when not authenticated', async () => {
    authState.mode = 'reject401';
    const res = await request(mountApp()).delete('/api/responsibility-rules/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 when missing responsibility.manage', async () => {
    authState.mode = 'reject403';
    const res = await request(mountApp()).delete('/api/responsibility-rules/1');
    expect(res.status).toBe(403);
  });

  it('returns 404 when service throws not found', async () => {
    (ResponsibilityRuleService.prototype.delete as jest.Mock).mockRejectedValue(new NotFoundError('Responsibility rule not found'));
    const res = await request(mountApp()).delete('/api/responsibility-rules/99');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 200 on success', async () => {
    (ResponsibilityRuleService.prototype.delete as jest.Mock).mockResolvedValue(undefined);
    const res = await request(mountApp()).delete('/api/responsibility-rules/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Responsibility rule deleted');
  });

  it('returns 500 on unexpected error', async () => {
    (ResponsibilityRuleService.prototype.delete as jest.Mock).mockRejectedValue(new Error('DB crash'));
    const res = await request(mountApp()).delete('/api/responsibility-rules/1');
    expect(res.status).toBe(500);
  });
});

// ── Read-side endpoints not previously covered ───────────────────────────────

describe('responsibility rules GET / — query-parameter parsing', () => {
  it('parses isActive=true and a numeric org unit filter', async () => {
    (ResponsibilityRuleService.prototype.list as jest.Mock).mockResolvedValue([]);

    const res = await request(mountApp()).get(
      '/api/responsibility-rules?isActive=true&responsibleOrgUnitId=7'
    );

    expect(res.status).toBe(200);
    expect(ResponsibilityRuleService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: true, responsibleOrgUnitId: 7 })
    );
  });

  it('parses isActive=false', async () => {
    (ResponsibilityRuleService.prototype.list as jest.Mock).mockResolvedValue([]);

    await request(mountApp()).get('/api/responsibility-rules?isActive=false');

    expect(ResponsibilityRuleService.prototype.list).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });
});

describe('responsibility rules GET /resolve', () => {
  it('requires permissionCode', async () => {
    const res = await request(mountApp()).get('/api/responsibility-rules/resolve');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('splits departmentIds/roleIds CSV lists into numbers, dropping junk', async () => {
    (ResponsibilityRuleService.prototype.resolveResponsibleUsers as jest.Mock).mockResolvedValue([4, 5]);

    const res = await request(mountApp()).get(
      '/api/responsibility-rules/resolve?permissionCode=timeoff.approve&orgUnitId=3&departmentIds=1,2,x&roleIds=9'
    );

    expect(res.status).toBe(200);
    expect(res.body.data.userIds).toEqual([4, 5]);
    expect(ResponsibilityRuleService.prototype.resolveResponsibleUsers).toHaveBeenCalledWith({
      permissionCode: 'timeoff.approve',
      orgUnitId: 3,
      departmentIds: [1, 2],
      roleIds: [9],
    });
  });

  it('defaults org unit to null and id lists to empty', async () => {
    (ResponsibilityRuleService.prototype.resolveResponsibleUsers as jest.Mock).mockResolvedValue([]);

    await request(mountApp()).get('/api/responsibility-rules/resolve?permissionCode=timeoff.approve');

    expect(ResponsibilityRuleService.prototype.resolveResponsibleUsers).toHaveBeenCalledWith({
      permissionCode: 'timeoff.approve',
      orgUnitId: null,
      departmentIds: [],
      roleIds: [],
    });
  });
});

describe('responsibility rules GET /matrix and /my-responsibilities', () => {
  it('returns the pivot matrix', async () => {
    (ResponsibilityRuleService.prototype.getMatrix as jest.Mock).mockResolvedValue([{ key: 'x' }]);

    const res = await request(mountApp()).get('/api/responsibility-rules/matrix');

    expect(res.status).toBe(200);
    expect(res.body.data.matrix).toEqual([{ key: 'x' }]);
  });

  it("returns the caller's own responsibilities", async () => {
    (ResponsibilityRuleService.prototype.getMyResponsibilities as jest.Mock).mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/responsibility-rules/my-responsibilities');

    expect(res.status).toBe(200);
    expect(ResponsibilityRuleService.prototype.getMyResponsibilities).toHaveBeenCalledWith(1);
  });
});

describe('responsibility rules GET /:id/conflicts', () => {
  it('reports overlaps with a hasConflicts flag', async () => {
    (ResponsibilityRuleService.prototype.getConflicts as jest.Mock).mockResolvedValue([{ id: 2 }]);

    const res = await request(mountApp()).get('/api/responsibility-rules/1/conflicts');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ conflicts: [{ id: 2 }], hasConflicts: true });
  });

  it('reports a clean rule with hasConflicts=false', async () => {
    (ResponsibilityRuleService.prototype.getConflicts as jest.Mock).mockResolvedValue([]);

    const res = await request(mountApp()).get('/api/responsibility-rules/1/conflicts');

    expect(res.body.data.hasConflicts).toBe(false);
  });
});

describe('responsibility rules POST /bulk', () => {
  it('creates rules with explicit ids and forwards actor id', async () => {
    (ResponsibilityRuleService.prototype.bulkCreate as jest.Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const res = await request(mountApp())
      .post('/api/responsibility-rules/bulk')
      .send({
        subjectType: 'department',
        subjectIds: [1, 2],
        permissionCodes: ['timeoff.approve'],
        responsibleOrgUnitId: 3,
        delegatedToRoleId: 4,
        description: 'coverage rules',
      });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('2 responsibility rules created');
    expect(ResponsibilityRuleService.prototype.bulkCreate).toHaveBeenCalledWith(
      {
        subjectType: 'department',
        subjectIds: [1, 2],
        permissionCodes: ['timeoff.approve'],
        responsibleOrgUnitId: 3,
        delegatedToRoleId: 4,
        description: 'coverage rules',
      },
      1
    );
  });

  it('defaults optional fields (subjectIds [], delegatedToRoleId/description null)', async () => {
    (ResponsibilityRuleService.prototype.bulkCreate as jest.Mock).mockResolvedValue([]);

    const res = await request(mountApp())
      .post('/api/responsibility-rules/bulk')
      .send({ subjectType: 'all', permissionCodes: ['timeoff.approve'], responsibleOrgUnitId: 3 });

    expect(res.status).toBe(201);
    expect(ResponsibilityRuleService.prototype.bulkCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subjectIds: [], delegatedToRoleId: null, description: null }),
      1
    );
  });

  it('rejects a body without permissionCodes', async () => {
    const res = await request(mountApp())
      .post('/api/responsibility-rules/bulk')
      .send({ subjectType: 'all', responsibleOrgUnitId: 3 });
    expect(res.status).toBe(400);
  });
});
