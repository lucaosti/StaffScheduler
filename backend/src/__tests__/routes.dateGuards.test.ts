/**
 * Date-format guard tests for query-string endpoints.
 *
 * These endpoints take dates from the query string, outside the Zod
 * validateBody/validateParams pipeline, so each router validates the format
 * by hand before touching SQL. The guards keep malformed input from ever
 * reaching a DATE/BETWEEN comparison (where MySQL would silently coerce and
 * return wrong ranges instead of failing). Each 400 arm is pinned here, plus
 * the org read-side endpoints that had no route-level tests.
 */

import request from 'supertest';

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
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  requireModule: () => (_req: any, _res: any, next: any) => next(),
  requireModuleForUser: () => (_req: any, _res: any, next: any) => next(),
  userHasPermission: (user: any, code: string) =>
    Boolean(user && user.permissions && user.permissions.includes(code)),
}));

jest.mock('../services/AuditLogService');
jest.mock('../services/ReportsService');
jest.mock('../services/SkillGapService');
jest.mock('../services/OrgUnitService');
jest.mock('../services/EmployeeLoanService');

import { AuditLogService } from '../services/AuditLogService';
import { ReportsService } from '../services/ReportsService';
import { SkillGapService } from '../services/SkillGapService';
import { OrgUnitService } from '../services/OrgUnitService';
import { createAuditLogsRouter } from '../routes/auditLogs';
import { createReportsRouter } from '../routes/reports';
import { createSkillGapRouter } from '../routes/skillGap';
import { createOrgRouter } from '../routes/org';
import { mountRouter } from './helpers/mountRouter';

const fakePool = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 1, role: 'admin', email: 'admin@example.com' };
});

describe('audit logs — date guards', () => {
  const app = () => mountRouter('/api/audit-logs', createAuditLogsRouter(fakePool));

  it.each(['fromDate', 'toDate'])('rejects a malformed %s', async (param) => {
    const res = await request(app()).get(`/api/audit-logs?${param}=20-07-2026`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts well-formed dates', async () => {
    (AuditLogService.prototype.list as jest.Mock).mockResolvedValue({ items: [], total: 0 });
    const res = await request(app()).get('/api/audit-logs?fromDate=2026-07-01&toDate=2026-07-31');
    expect(res.status).toBe(200);
  });
});

describe('reports — date guards', () => {
  const app = () => mountRouter('/api/reports', createReportsRouter(fakePool));

  it('rejects malformed dates on /hours-worked', async () => {
    const res = await request(app()).get('/api/reports/hours-worked?start=bad&end=2026-07-31');
    expect(res.status).toBe(400);
  });

  it('rejects malformed dates on /cost-by-department', async () => {
    const res = await request(app()).get('/api/reports/cost-by-department?start=2026-07-01&end=31/07');
    expect(res.status).toBe(400);
  });

  it('accepts well-formed dates on /cost-by-department', async () => {
    (ReportsService.prototype.costByDepartment as jest.Mock).mockResolvedValue([]);
    const res = await request(app()).get(
      '/api/reports/cost-by-department?start=2026-07-01&end=2026-07-31'
    );
    expect(res.status).toBe(200);
    expect(ReportsService.prototype.costByDepartment).toHaveBeenCalledWith('2026-07-01', '2026-07-31');
  });
});

describe('skill gap — date guards', () => {
  const app = () => mountRouter('/api/skill-gap', createSkillGapRouter(fakePool));

  it('rejects malformed dates', async () => {
    const res = await request(app()).get('/api/skill-gap?departmentId=1&start=07-2026&end=2026-07-31');
    expect(res.status).toBe(400);
  });

  it('accepts well-formed input', async () => {
    (SkillGapService.prototype.analyze as jest.Mock).mockResolvedValue({ gaps: [] });
    const res = await request(app()).get(
      '/api/skill-gap?departmentId=1&start=2026-07-01&end=2026-07-31'
    );
    expect(res.status).toBe(200);
  });
});

describe('org read-side endpoints', () => {
  const app = () => mountRouter('/api/org', createOrgRouter(fakePool));

  it('returns the display-ready member list', async () => {
    (OrgUnitService.prototype.listMembersDetailed as jest.Mock).mockResolvedValue([
      { userId: 5, name: 'A' },
    ]);
    const res = await request(app()).get('/api/org/units/3/members/detailed');
    expect(res.status).toBe(200);
    expect(OrgUnitService.prototype.listMembersDetailed).toHaveBeenCalledWith(3);
  });

  it('manager chain defaults to the caller', async () => {
    (OrgUnitService.prototype.getManagerChain as jest.Mock).mockResolvedValue([]);
    const res = await request(app()).get('/api/org/manager-chain');
    expect(res.status).toBe(200);
    expect(OrgUnitService.prototype.getManagerChain).toHaveBeenCalledWith(1);
  });

  it('manager chain accepts an explicit target user', async () => {
    (OrgUnitService.prototype.getManagerChain as jest.Mock).mockResolvedValue([]);
    await request(app()).get('/api/org/manager-chain/9');
    expect(OrgUnitService.prototype.getManagerChain).toHaveBeenCalledWith(9);
  });

  it('manager chain rejects a non-numeric target', async () => {
    const res = await request(app()).get('/api/org/manager-chain/abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
