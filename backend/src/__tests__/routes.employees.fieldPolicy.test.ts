/**
 * Field policies enforced on the employee write paths.
 *
 * Two properties, and both are about the seam between Zod and the policy:
 *
 *  - the policy runs AFTER the schema and BEFORE the service, so a refusal
 *    never reaches the database and never masquerades as a contract error;
 *  - the organization judged against is the ACTOR's, never a value from the
 *    payload — otherwise a caller could pick whose rules to be judged by, which
 *    is the entire ruleset defeated by one field.
 *
 * The create/update asymmetry is the other case that earns its place. A field
 * absent from an update is not being cleared, so requiring it there would make
 * every partial update of an incomplete record impossible — and that is the
 * record most in need of updating.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const listForOrganization = jest.fn();
jest.mock('../services/EmployeeFieldPolicyService', () => {
  const actual = jest.requireActual('../services/EmployeeFieldPolicyService');
  return { ...actual, EmployeeFieldPolicyService: jest.fn().mockImplementation(() => ({ listForOrganization })) };
});

const createEmployee = jest.fn();
const updateEmployee = jest.fn();
jest.mock('../services/EmployeeService', () => ({
  EmployeeService: jest.fn().mockImplementation(() => ({
    createEmployee,
    updateEmployee,
    getAllEmployees: jest.fn().mockResolvedValue([]),
    countEmployees: jest.fn().mockResolvedValue(0),
  })),
}));

jest.mock('../services/AuditLogService', () => ({
  AuditLogService: jest.fn().mockImplementation(() => ({ write: jest.fn() })),
}));

let organizationName: string | null = 'Acme';
jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = {
      id: 7,
      permissions: ['employee.manage'],
      organizationName,
      allowedOrgUnitIds: null,
    };
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  userHasPermission: () => true,
}));

const mount = () => {
  const { createEmployeesRouter } = require('../routes/employees');
  const { errorHandler } = require('../middleware/errorHandler');
  const app = express();
  app.use(express.json());
  app.use('/api/employees', createEmployeesRouter({} as never));
  // The real error middleware, not Express's default: the refusal's ENVELOPE is
  // part of what these cases assert, and the default handler renders HTML with
  // the right status, which would let an assertion on the status alone pass
  // while the client got something it cannot read.
  app.use(errorHandler);
  return app;
};

const policy = (over: Record<string, unknown> = {}) => ({
  fieldKey: 'phone',
  isRequired: true,
  visiblePermission: null,
  editPermission: null,
  minLength: null,
  maxLength: null,
  minValue: null,
  maxValue: null,
  pattern: null,
  allowedValues: null,
  helpText: null,
  ...over,
});

const newEmployee = {
  email: 'anna.rossi@example.com',
  password: 'Sup3rSecret!',
  firstName: 'Anna',
  lastName: 'Rossi',
};

beforeEach(() => {
  jest.clearAllMocks();
  organizationName = 'Acme';
  listForOrganization.mockResolvedValue([]);
  createEmployee.mockResolvedValue({ id: 1 });
  updateEmployee.mockResolvedValue({ id: 1 });
});

describe('creating an employee', () => {
  it('succeeds when no policy is configured', async () => {
    const res = await request(mount()).post('/api/employees').send(newEmployee);

    expect(res.status).toBe(201);
    expect(createEmployee).toHaveBeenCalled();
  });

  it('is refused when a required field is missing', async () => {
    listForOrganization.mockResolvedValue([policy()]);
    const res = await request(mount()).post('/api/employees').send(newEmployee);

    expect(res.status).toBe(400);
    // Named, so this cannot pass on an unrelated schema rejection — which is
    // exactly how it passed while the fixture had an invalid email in it.
    expect(res.body.error.message).toContain('phone is required');
    // Never reaches the database: a policy refusal is not a half-written record.
    expect(createEmployee).not.toHaveBeenCalled();
  });

  it('succeeds once the required field is supplied', async () => {
    listForOrganization.mockResolvedValue([policy()]);
    const res = await request(mount())
      .post('/api/employees')
      .send({ ...newEmployee, phone: '+39 02 1234' });

    expect(res.status).toBe(201);
  });

  it('applies a validation rule to a supplied value', async () => {
    listForOrganization.mockResolvedValue([
      policy({ isRequired: false, minLength: 8, helpText: 'Include the area code.' }),
    ]);
    const res = await request(mount()).post('/api/employees').send({ ...newEmployee, phone: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Include the area code.');
  });

  it('judges against the ACTOR\'s organization, not one from the payload', async () => {
    organizationName = 'Acme';
    listForOrganization.mockResolvedValue([]);
    await request(mount())
      .post('/api/employees')
      .send({ ...newEmployee, organizationName: 'Somewhere Else' });

    // Letting the payload choose would be the whole ruleset defeated by one
    // field.
    expect(listForOrganization).toHaveBeenCalledWith('Acme');
  });

  it('uses the global policy for a caller with no organization', async () => {
    organizationName = null;
    await request(mount()).post('/api/employees').send(newEmployee);
    expect(listForOrganization).toHaveBeenCalledWith(null);
  });
});

describe('updating an employee', () => {
  it('does not require a field the update does not mention', async () => {
    listForOrganization.mockResolvedValue([policy()]);
    const res = await request(mount()).put('/api/employees/1').send({ position: 'Nurse' });

    // The record most in need of updating is the incomplete one.
    expect(res.status).toBe(200);
    expect(updateEmployee).toHaveBeenCalled();
  });

  it('refuses an update that CLEARS a required field', async () => {
    listForOrganization.mockResolvedValue([policy()]);
    const res = await request(mount()).put('/api/employees/1').send({ phone: '' });

    expect(res.status).toBe(400);
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it('applies validation to a field the update does mention', async () => {
    listForOrganization.mockResolvedValue([policy({ isRequired: false, pattern: '^\\+' })]);
    const res = await request(mount()).put('/api/employees/1').send({ phone: '021234' });

    expect(res.status).toBe(400);
  });
});
