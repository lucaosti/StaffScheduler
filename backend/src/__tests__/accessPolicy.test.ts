/**
 * Unit tests for AccessPolicy and the accessScope route guards (#867): the
 * branches of the one rule deciding whether a caller reaches a row. The rule is
 * exercised end to end, per operation and per kind of caller, by
 * `integration/authorization.integration.test.ts`.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';
import {
  AccessPolicy,
  assertInScope,
  assertOwnerOr,
  inScope,
  memberCondition,
  scopeFilter,
  scopeFor,
  unitCondition,
} from '../services/access/AccessPolicy';
import { accessScope, idsAt } from '../middleware/accessScope';
import { errorHandler } from '../middleware/errorHandler';
import { ForbiddenError, NotFoundError } from '../errors';
import { User } from '../types';
import { policyPool } from './helpers/policyPool';

const user = (over: Partial<User> = {}): User =>
  ({ id: 1, email: 'u@x', firstName: 'U', lastName: 'X', isActive: true, permissions: ['schedule.read'], ...over }) as User;

describe('scopeFor / scopeFilter', () => {
  it('is the role scope, or unrestricted when there is none', () => {
    expect(scopeFor(user(), 'schedule.read')).toBeNull();
    expect(scopeFor(user({ allowedOrgUnitIds: [3] }), 'schedule.read')).toEqual([3]);
  });

  it('is overridden per code by a delegation scope', () => {
    const delegatee = user({ allowedOrgUnitIds: null, delegationScopes: [{ permissionCode: 'schedule.read', allowedOrgUnitIds: [7] }] });
    expect(scopeFor(delegatee, 'schedule.read')).toEqual([7]);
    expect(scopeFor(delegatee, 'employee.read')).toBeNull();
  });

  it('filters by the scope of one code, and by the union of the held ones', () => {
    expect(scopeFilter(user(), 'schedule.read')).toBeUndefined();
    expect(scopeFilter(user({ allowedOrgUnitIds: [] }), 'schedule.read')).toEqual([]);
    const both = user({
      permissions: ['a', 'b'],
      allowedOrgUnitIds: [1],
      delegationScopes: [{ permissionCode: 'b', allowedOrgUnitIds: [2, 1] }],
    });
    expect(scopeFilter(both, ['a', 'b', 'c'])).toEqual([1, 2]);
    expect(scopeFilter(user({ permissions: ['a'] }), ['a', 'b'])).toBeUndefined();
    expect(scopeFilter(user({ permissions: [] }), ['a'])).toEqual([]);
    expect(scopeFilter(user({ permissions: undefined }), ['a'])).toEqual([]);
  });
});

describe('inScope / assertInScope / assertOwnerOr', () => {
  it('places NULL units in no scope', () => {
    expect(inScope(null, [null])).toBe(true);
    expect(inScope([1], [null, 1])).toBe(true);
    expect(inScope([1], [null])).toBe(false);
    expect(inScope([1], [])).toBe(false);
  });

  it('refuses out-of-scope rows with the 404 a missing row gets', () => {
    const scoped = user({ allowedOrgUnitIds: [1] });
    expect(() => assertInScope(scoped, 'schedule.read', 1)).not.toThrow();
    expect(() => assertInScope(scoped, 'schedule.read', [2, 1])).not.toThrow();
    expect(() => assertInScope(scoped, 'schedule.read', null, 'Schedule')).toThrow(new NotFoundError('Schedule not found'));
    expect(() => assertInScope(scoped, 'schedule.read', 2)).toThrow('Record not found');
  });

  it('admits the owner, defers a permission holder to the scope check, and refuses anyone else', () => {
    expect(assertOwnerOr(user(), 1, 'x')).toBe(true);
    expect(assertOwnerOr(user(), 2, 'schedule.read')).toBe(false);
    expect(assertOwnerOr(user(), null, ['x', 'schedule.read'])).toBe(false);
    expect(() => assertOwnerOr(user(), 2, 'x')).toThrow(ForbiddenError);
    expect(() => assertOwnerOr(user({ permissions: undefined }), 2, 'x')).toThrow(ForbiddenError);
  });
});

describe('SQL conditions', () => {
  it('apply no condition when unrestricted, and match nothing for an empty scope', () => {
    expect(unitCondition('d.org_unit_id', undefined)).toBeNull();
    expect(unitCondition('d.org_unit_id', [])).toEqual({ sql: '1 = 0', params: [] });
    expect(unitCondition('d.org_unit_id', [4, 5])).toEqual({ sql: 'd.org_unit_id IN (?, ?)', params: [4, 5] });
    expect(memberCondition('u.id', undefined)).toBeNull();
    expect(memberCondition('u.id', [4])).toEqual({
      sql: 'u.id IN (SELECT user_id FROM user_org_units WHERE org_unit_id IN (?))',
      params: [4],
    });
  });
});

describe('AccessPolicy', () => {
  const scoped = user({ allowedOrgUnitIds: [1] });

  it('lets unrestricted callers through without a query', async () => {
    const p = policyPool();
    const policy = new AccessPolicy(p.pool);
    await policy.assertReach(user(), 'schedule.read', 'schedule', 9);
    await policy.assertOwnerOrReach(user(), 'schedule.read', 'assignment', 9);
    expect(p.execute).not.toHaveBeenCalled();
  });

  it('reaches a row in scope and refuses one outside it or missing', async () => {
    const p = policyPool();
    const policy = new AccessPolicy(p.pool);
    p.row(null, [1]);
    await expect(policy.assertReach(scoped, 'schedule.read', 'schedule', 9)).resolves.toBeUndefined();
    p.row(null, [2, null]);
    await expect(policy.assertReach(scoped, 'schedule.read', 'shift', 9)).rejects.toThrow('Shift not found');
    p.missing();
    await expect(policy.assertReach(scoped, 'schedule.read', 'department', 9)).rejects.toThrow('Department not found');
    expect(p.execute.mock.calls[0][1]).toEqual([9]);
  });

  it('refuses a caller holding none of the codes, however unscoped', async () => {
    const p = policyPool();
    p.row(null, [1]);
    await expect(new AccessPolicy(p.pool).assertReach(user({ permissions: [] }), 'x', 'user', 9)).rejects.toThrow('User not found');
  });

  it('decides ownership from the row', async () => {
    const p = policyPool();
    const policy = new AccessPolicy(p.pool);
    const employee = user({ id: 5, permissions: [] });
    p.row(5, [2]);
    await expect(policy.assertOwnerOrReach(employee, 'assignment.manage', 'assignment', 9)).resolves.toBeUndefined();
    p.row(6, [2]);
    await expect(policy.assertOwnerOrReach(employee, 'assignment.manage', 'assignment', 9)).rejects.toThrow(ForbiddenError);
    const manager = user({ id: 7, permissions: ['assignment.manage'], allowedOrgUnitIds: [2] });
    await expect(policy.assertOwnerOrReach(manager, 'assignment.manage', 'timeOff', 9)).resolves.toBeUndefined();
    p.row(6, [3]);
    await expect(policy.assertOwnerOrReach(manager, 'assignment.manage', 'attendance', 9)).rejects.toThrow('Attendance record not found');
    p.missing();
    await expect(policy.assertOwnerOrReach(employee, 'assignment.manage', 'loan', 9)).rejects.toThrow('Loan not found');
  });

  it('resolves many ids of a kind in one query', async () => {
    const p = policyPool();
    p.row(null, [1]);
    await new AccessPolicy(p.pool).assertReach(scoped, 'schedule.read', 'schedule', [4, 5, 4]);
    expect(p.execute).toHaveBeenCalledTimes(1);
    expect(p.execute.mock.calls[0][1]).toEqual([4, 5]);
  });

  it('checks a batch row by row after resolving it once', async () => {
    const p = policyPool();
    p.execute.mockResolvedValue([[{ id: 4, unit: 1, owner: null }, { id: 5, unit: 2, owner: null }], null]);
    const check = await new AccessPolicy(p.pool).reachChecker(scoped, 'schedule.read', 'shift', [4, 5, 6]);
    expect(() => check(4)).not.toThrow();
    expect(() => check(5)).toThrow('Shift not found');
    expect(() => check(6)).toThrow('Shift not found');
    expect(p.execute).toHaveBeenCalledTimes(1);
    const unscoped = await new AccessPolicy(p.pool).reachChecker(user(), 'schedule.read', 'shift', [9]);
    expect(() => unscoped(9)).not.toThrow();
    expect(p.execute).toHaveBeenCalledTimes(1);
  });

  it('reaches a swap only when both of its assignments are in scope', async () => {
    const p = policyPool();
    const policy = new AccessPolicy(p.pool);
    const approver = user({ permissions: ['shiftswap.approve'], allowedOrgUnitIds: [1] });
    p.row(null, [1, 1]);
    await expect(policy.assertReach(approver, 'shiftswap.approve', 'shiftSwap', 3)).resolves.toBeUndefined();
    p.row(null, [1, 2]);
    await expect(policy.assertReach(approver, 'shiftswap.approve', 'shiftSwap', 3)).rejects.toThrow('Shift swap request not found');
    p.row(null, [1, null]);
    await expect(policy.assertOwnerOrReach(approver, 'shiftswap.approve', 'shiftSwap', 3)).rejects.toThrow(NotFoundError);
  });

  it('knows every kind of row', async () => {
    const p = policyPool();
    const policy = new AccessPolicy(p.pool);
    p.missing();
    for (const [kind, label] of [
      ['costPlan', 'Cost plan'],
      ['orgUnit', 'Org unit'],
      ['timeOff', 'Time-off request'],
    ] as const) {
      await expect(policy.assertReach(scoped, 'schedule.read', kind, 1)).rejects.toThrow(`${label} not found`);
    }
  });
});

describe('accessScope guards', () => {
  it('reads ids from params, body and arrays, ignoring absent values', () => {
    const locals = { params: { id: 3 }, body: { rows: [{ shiftId: 1 }, { shiftId: 2 }, {}], ids: [4], none: null }, query: {} };
    expect(idsAt(locals, 'params.id')).toEqual([3]);
    expect(idsAt(locals, 'body.rows[].shiftId')).toEqual([1, 2]);
    expect(idsAt(locals, 'body.ids[]')).toEqual([4]);
    expect(idsAt(locals, 'body.missing[]')).toEqual([]);
    expect(idsAt(locals, 'body.none[]')).toEqual([]);
    expect(idsAt(locals, 'query.departmentId')).toEqual([]);
  });

  // Fail closed: a mis-ordered guard or a non-id value must not check nothing.
  it('throws when the source is not parsed yet or a value is not an id', () => {
    expect(() => idsAt({}, 'body.x')).toThrow(/runs before its validate\* middleware/);
    expect(() => idsAt({ body: { ids: [4, 'x'] } }, 'body.ids[]')).toThrow(/not an id/);
    expect(() => idsAt({ body: { id: '4' } }, 'body.id')).toThrow(/not an id/);
    expect(() => idsAt({ body: { id: 1.5 } }, 'body.id')).toThrow(/not an id/);
    expect(() => idsAt({ body: { ids: 4 } }, 'body.ids[]')).toThrow(/expects an array/);
  });

  it('answers a guard placed before its validation with an internal fault', async () => {
    const scope = accessScope({} as never);
    const app = express();
    app.post('/x', (req, _res, next) => { req.user = user(); next(); }, scope.reach('schedule.read', 'schedule', 'body.id'), (_req, res) => res.json({}));
    app.use(errorHandler);
    expect((await request(app).post('/x')).status).toBe(500);
  });

  const appWith = (pool: never, caller: User, guard: 'reach' | 'ownerOr') => {
    const scope = accessScope(pool);
    const app = express();
    app.use(express.json());
    app.post(
      '/x/:id',
      (req, res, next) => {
        req.user = caller;
        res.locals.params = { id: Number(req.params.id) };
        res.locals.body = req.body;
        next();
      },
      guard === 'reach' ? scope.reach('schedule.read', 'schedule', 'params.id') : scope.ownerOr(['schedule.read'], 'assignment', 'params.id'),
      (_req, res) => res.json({ success: true })
    );
    app.use(errorHandler);
    return app;
  };

  it('tags each guard with its rule, for the authorization matrix', () => {
    const scope = accessScope({} as never);
    expect((scope.reach('a', 'shift', 'params.id') as unknown as { accessRule: unknown }).accessRule).toEqual({
      type: 'reach', permissions: ['a'], kind: 'shift', at: 'params.id',
    });
    expect((scope.ownerOr(['a', 'b'], 'user', 'params.userId') as unknown as { accessRule: unknown }).accessRule).toEqual({
      type: 'ownerOr', permissions: ['a', 'b'], kind: 'user', at: 'params.userId',
    });
  });

  it('passes in scope and answers 404 outside it', async () => {
    const p = policyPool();
    p.row(null, [1]);
    expect((await request(appWith(p.pool, scoped(), 'reach')).post('/x/5').send({})).status).toBe(200);
    p.row(null, [2]);
    const res = await request(appWith(p.pool, scoped(), 'reach')).post('/x/5').send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 403 to a non-owner without the permission', async () => {
    const p = policyPool();
    p.row(99, [1]);
    const res = await request(appWith(p.pool, user({ permissions: [] }), 'ownerOr')).post('/x/5').send({});
    expect(res.status).toBe(403);
  });

  function scoped(): User {
    return user({ allowedOrgUnitIds: [1] });
  }
});
