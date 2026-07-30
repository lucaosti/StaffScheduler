/**
 * The field-policy admin endpoints, and enforcement on the employee routes.
 *
 * The gating case is the one that matters: writing a policy needs
 * `settings.manage`, not `employee.manage`. Editing an employee and deciding
 * what an employee record must contain are different acts — the second changes
 * the rules everyone else works under and can make a field visible — and
 * `employee.manage` is held by every scheduling manager.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const listForOrganization = jest.fn();
const upsert = jest.fn();
const remove = jest.fn();
jest.mock('../services/EmployeeFieldPolicyService', () => {
  const actual = jest.requireActual('../services/EmployeeFieldPolicyService');
  return {
    ...actual,
    EmployeeFieldPolicyService: jest.fn().mockImplementation(() => ({
      listForOrganization,
      upsert,
      remove,
    })),
  };
});

let heldCodes: string[] = [];
let organizationName: string | null = null;

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = {
      id: 7,
      permissions: heldCodes,
      organizationName,
    };
    next();
  },
  requirePermission: (code: string) => (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    const user = (req as unknown as { user: { permissions: string[] } }).user;
    if (!user.permissions.includes(code)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
      return;
    }
    next();
  },
  userHasPermission: (user: { permissions?: string[] }, code: string) =>
    (user?.permissions ?? []).includes(code),
}));

const mount = () => {
  const { createEmployeeFieldPolicyRouter } = require('../routes/employeeFieldPolicies');
  const app = express();
  app.use(express.json());
  app.use('/api/employee-field-policies', createEmployeeFieldPolicyRouter({} as never));
  return app;
};

const body = { fieldKey: 'phone', isRequired: true };

beforeEach(() => {
  jest.clearAllMocks();
  heldCodes = ['settings.manage'];
  organizationName = 'Acme';
  listForOrganization.mockResolvedValue([]);
  upsert.mockResolvedValue(undefined);
  remove.mockResolvedValue(true);
});

describe('reading the policies', () => {
  it('is open to any authenticated caller', async () => {
    heldCodes = [];
    const res = await request(mount()).get('/api/employee-field-policies');

    // A form has to know the rules before someone fills it in, or the only way
    // to discover one is to break it.
    expect(res.status).toBe(200);
  });

  it('defaults to the caller\'s own organization', async () => {
    await request(mount()).get('/api/employee-field-policies');
    expect(listForOrganization).toHaveBeenCalledWith('Acme');
  });

  it('carries the governable allowlist, so a UI need not keep a copy', async () => {
    const res = await request(mount()).get('/api/employee-field-policies');

    expect(res.body.data.governableCoreFields).toEqual(
      expect.arrayContaining(['email', 'phone', 'hourlyRate'])
    );
    // And never anything outside it.
    expect(res.body.data.governableCoreFields).not.toContain('password_hash');
  });
});

describe('writing a policy', () => {
  it('needs settings.manage', async () => {
    const res = await request(mount()).put('/api/employee-field-policies').send(body);
    expect(res.status).toBe(200);
  });

  it('is refused to a plain employee manager', async () => {
    // Every scheduling manager holds employee.manage; deciding what a record
    // must contain is not their act.
    heldCodes = ['employee.manage'];
    const res = await request(mount()).put('/api/employee-field-policies').send(body);

    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('normalises the optional fields to null rather than leaving them undefined', async () => {
    await request(mount()).put('/api/employee-field-policies').send(body);

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'phone', isRequired: true, pattern: null, helpText: null })
    );
  });

  it('rejects an over-long pattern at the schema, before the service', async () => {
    const res = await request(mount())
      .put('/api/employee-field-policies')
      .send({ ...body, pattern: 'a'.repeat(201) });

    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('removing a policy', () => {
  it('needs settings.manage', async () => {
    heldCodes = ['employee.manage'];
    const res = await request(mount()).delete('/api/employee-field-policies?fieldKey=phone');
    expect(res.status).toBe(403);
  });

  it('404s when there was nothing to remove', async () => {
    remove.mockResolvedValue(false);
    const res = await request(mount()).delete('/api/employee-field-policies?fieldKey=phone');
    expect(res.status).toBe(404);
  });

  it('removes an organization row', async () => {
    const res = await request(mount()).delete(
      '/api/employee-field-policies?fieldKey=phone&organizationName=Acme'
    );

    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith('Acme', 'phone');
  });

  it('removes the global row when no organization is named', async () => {
    // Not the caller's own organization here, unlike the read: deleting the
    // global policy is a deliberate act and must be said explicitly, or an
    // administrator would silently remove their own organization's row while
    // meaning to remove the fallback.
    await request(mount()).delete('/api/employee-field-policies?fieldKey=phone');
    expect(remove).toHaveBeenCalledWith(null, 'phone');
  });

  it('requires the field key', async () => {
    const res = await request(mount()).delete('/api/employee-field-policies');
    expect(res.status).toBe(400);
  });
});
