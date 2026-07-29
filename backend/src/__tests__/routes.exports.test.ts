/**
 * The `/export` endpoints, one per dataset.
 *
 * WHAT THESE TESTS ARE FOR. Not the CSV — that is covered where the serializer
 * lives. These assert the two properties an export endpoint can quietly get
 * wrong:
 *
 *  - it must call the SAME service method as its JSON sibling, with the SAME
 *    filters. An export that built its own query would be a second, unreviewed
 *    authorization path — and the org-unit scope and the "pinned to your own
 *    records" rules are exactly the kind of clause that gets left out of a
 *    hurried second copy. Each case therefore asserts on the arguments the
 *    service received, not just on the status code.
 *
 *  - it must not be shadowed by the `/:id` route beside it. Every one of these
 *    routers has a numeric `/:id` and Express matches in declaration order, so
 *    "export" reaching the id handler as the string "export" is a live risk that
 *    a 200 here is the only thing ruling out.
 *
 * @author Luca Ostinelli
 */

import express from 'express';
import request from 'supertest';

export {};

const auditWrite = jest.fn().mockResolvedValue(undefined);
jest.mock('../services/AuditLogService', () => ({
  AuditLogService: jest.fn().mockImplementation(() => ({ write: auditWrite })),
}));

/** The authenticated caller each case runs as; reassigned per test. */
let currentUser: Record<string, unknown> = { id: 9, email: 'm@x.y', allowedOrgUnitIds: null };
/** What `userHasPermission` answers; the approver/non-approver switch. */
let hasPermission = true;

jest.mock('../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as { user: unknown }).user = currentUser;
    next();
  },
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireModuleForUser: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  userHasPermission: () => hasPermission,
}));

const reports = {
  hoursWorkedByUser: jest.fn(),
  costByDepartment: jest.fn(),
  fairnessForSchedule: jest.fn(),
};
jest.mock('../services/ReportsService', () => ({
  ReportsService: jest.fn().mockImplementation(() => reports),
}));

const employees = { getAllEmployees: jest.fn(), countEmployees: jest.fn() };
jest.mock('../services/EmployeeService', () => ({
  EmployeeService: jest.fn().mockImplementation(() => employees),
}));

const shifts = { getAllShifts: jest.fn(), countShifts: jest.fn() };
jest.mock('../services/ShiftService', () => ({
  ShiftService: jest.fn().mockImplementation(() => shifts),
}));

const assignments = { getAllAssignments: jest.fn(), countAssignments: jest.fn() };
jest.mock('../services/AssignmentService', () => ({
  AssignmentService: jest.fn().mockImplementation(() => assignments),
}));

const attendance = { list: jest.fn() };
jest.mock('../services/AttendanceService', () => ({
  AttendanceService: jest.fn().mockImplementation(() => attendance),
}));

const timeOff = { list: jest.fn() };
jest.mock('../services/TimeOffService', () => ({
  TimeOffService: jest.fn().mockImplementation(() => timeOff),
}));

const mount = (factoryName: string, modulePath: string, base: string) => {
  const factory = require(modulePath)[factoryName];
  const app = express();
  app.use(express.json());
  app.use(base, factory({} as never));
  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = { id: 9, email: 'm@x.y', allowedOrgUnitIds: null };
  hasPermission = true;
  reports.hoursWorkedByUser.mockResolvedValue([{ userId: 1, fullName: 'Rossi', hours: 8 }]);
  reports.costByDepartment.mockResolvedValue([
    { departmentId: 2, departmentName: 'Ward A', hours: 100, cost: 2500 },
  ]);
  reports.fairnessForSchedule.mockResolvedValue({
    scheduleId: 5,
    perUser: [{ userId: 1, fullName: 'Rossi', hours: 8 }],
    stats: { count: 1, min: 8, max: 8, mean: 8, stddev: 0 },
  });
  employees.getAllEmployees.mockResolvedValue([
    { id: 1, firstName: 'Anna', lastName: 'Rossi', email: 'a@x.y', isActive: true },
  ]);
  shifts.getAllShifts.mockResolvedValue([
    { id: 3, date: '2026-07-30', startTime: '08:00:00', endTime: '16:00:00', status: 'open' },
  ]);
  assignments.getAllAssignments.mockResolvedValue([
    { id: 4, shiftId: 3, userId: 1, status: 'confirmed', assignedAt: '2026-07-01T00:00:00Z' },
  ]);
  attendance.list.mockResolvedValue([{ id: 5, userId: 1, clockIn: '2026-07-30T08:00:00Z', status: 'pending' }]);
  timeOff.list.mockResolvedValue([
    { id: 6, userId: 1, startDate: '2026-08-01', endDate: '2026-08-05', type: 'vacation', status: 'approved' },
  ]);
});

/** Every export answers with the same content type and an attachment. */
const expectCsvAttachment = (res: request.Response, filenameStem: string) => {
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('text/csv');
  expect(res.headers['content-disposition']).toMatch(
    new RegExp(`^attachment; filename="${filenameStem}_\\d{4}-\\d{2}-\\d{2}\\.csv"$`)
  );
  // The BOM is the part a Windows Excel needs and the part a refactor drops.
  expect(res.text.charCodeAt(0)).toBe(0xfeff);
};

describe('report exports', () => {
  const app = () => mount('createReportsRouter', '../routes/reports', '/api/reports');

  it('exports hours worked over the requested range', async () => {
    const res = await request(app()).get('/api/reports/hours-worked/export?startDate=2026-07-01&endDate=2026-07-31');

    expectCsvAttachment(res, 'hours-worked');
    expect(reports.hoursWorkedByUser).toHaveBeenCalledWith('2026-07-01', '2026-07-31', undefined);
    expect(res.text).toContain('Employee ID,Employee,Hours');
    expect(res.text).toContain('Rossi');
  });

  it('honours the legacy start/end aliases, as the JSON endpoint does', async () => {
    // An export that only understood the documented pair would hand a caller
    // still using the old names a different window — worse than refusing them.
    await request(app()).get('/api/reports/hours-worked/export?start=2026-07-01&end=2026-07-31');
    expect(reports.hoursWorkedByUser).toHaveBeenCalledWith('2026-07-01', '2026-07-31', undefined);
  });

  it('refuses without a range rather than exporting everything', async () => {
    const res = await request(app()).get('/api/reports/hours-worked/export');
    expect(res.status).toBe(400);
    expect(reports.hoursWorkedByUser).not.toHaveBeenCalled();
  });

  it('passes the department filter through', async () => {
    await request(app()).get(
      '/api/reports/hours-worked/export?startDate=2026-07-01&endDate=2026-07-31&departmentId=4'
    );
    expect(reports.hoursWorkedByUser).toHaveBeenCalledWith('2026-07-01', '2026-07-31', 4);
  });

  it('exports cost by department', async () => {
    const res = await request(app()).get(
      '/api/reports/cost-by-department/export?startDate=2026-07-01&endDate=2026-07-31'
    );
    expectCsvAttachment(res, 'cost-by-department');
    expect(res.text).toContain('Ward A');
  });

  it('refuses cost-by-department without a range', async () => {
    const res = await request(app()).get('/api/reports/cost-by-department/export');
    expect(res.status).toBe(400);
  });

  it('exports the per-employee fairness breakdown, not the statistics', async () => {
    const res = await request(app()).get('/api/reports/fairness/5/export');

    expectCsvAttachment(res, 'fairness');
    expect(reports.fairnessForSchedule).toHaveBeenCalledWith(5);
    // The reason to open a spreadsheet is to sort people by hours; a single row
    // of min/max/mean is not that.
    expect(res.text).toContain('Rossi');
    expect(res.text).not.toContain('stddev');
  });

  it('records the schedule id in the audit entry rather than the dataset name', async () => {
    await request(app()).get('/api/reports/fairness/5/export');
    const entry = auditWrite.mock.calls[0][0];
    // A per-schedule entity type would make "show me every fairness export"
    // unanswerable.
    expect(entry.entityType).toBe('fairness');
    expect(entry.after.filters).toEqual({ scheduleId: 5 });
  });
});

describe('employee export', () => {
  const app = () => mount('createEmployeesRouter', '../routes/employees', '/api/employees');

  it('exports with the caller org-unit scope applied', async () => {
    currentUser = { id: 9, allowedOrgUnitIds: [3, 4] };
    const res = await request(app()).get('/api/employees/export');

    expectCsvAttachment(res, 'employees');
    // The scope clause is the one that decides whether someone sees employees
    // outside their own subtree, and it must reach the export unchanged.
    expect(employees.getAllEmployees).toHaveBeenCalledWith({ orgUnitIds: [3, 4] });
  });

  it('passes no filters at all for an unscoped caller', async () => {
    const res = await request(app()).get('/api/employees/export');
    expect(res.status).toBe(200);
    expect(employees.getAllEmployees).toHaveBeenCalledWith(undefined);
  });

  it('applies the same search and department filters as the list', async () => {
    await request(app()).get('/api/employees/export?search=rossi&department=Ward%20A&isActive=true');
    expect(employees.getAllEmployees).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'rossi', departmentName: 'Ward A', isActive: true })
    );
  });

  it('is unpaginated — a file is where "all of it" is the point', async () => {
    await request(app()).get('/api/employees/export?page=1&pageSize=1');
    // One argument means no pagination object was passed.
    expect(employees.getAllEmployees.mock.calls[0]).toHaveLength(1);
    expect(employees.countEmployees).not.toHaveBeenCalled();
  });

  it('publishes only the declared columns', async () => {
    employees.getAllEmployees.mockResolvedValue([
      { id: 1, firstName: 'Anna', lastName: 'Rossi', email: 'a@x.y', isActive: true, hourlyRate: 42 },
    ]);
    const res = await request(app()).get('/api/employees/export');
    // `hourlyRate` is on the entity and is not a column, so it does not leave.
    expect(res.text).not.toContain('42');
  });

  it('is not shadowed by the /:id route', async () => {
    const res = await request(app()).get('/api/employees/export');
    expect(res.status).toBe(200);
  });
});

describe('shift export', () => {
  const app = () => mount('createShiftsRouter', '../routes/shifts', '/api/shifts');

  it('applies the caller scope and the range filters', async () => {
    currentUser = { id: 9, allowedOrgUnitIds: [7] };
    const res = await request(app()).get('/api/shifts/export?startDate=2026-07-01&endDate=2026-07-31');

    expectCsvAttachment(res, 'shifts');
    expect(shifts.getAllShifts).toHaveBeenCalledWith(
      expect.objectContaining({ orgUnitIds: [7], startDate: '2026-07-01', endDate: '2026-07-31' })
    );
  });

  it('expands the single-day `date` form the same way the list does', async () => {
    await request(app()).get('/api/shifts/export?date=2026-07-15');
    expect(shifts.getAllShifts).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2026-07-15', endDate: '2026-07-15' })
    );
  });

  it('does not leak pagination parameters into the SQL filters', async () => {
    await request(app()).get('/api/shifts/export?page=2&pageSize=5');
    const filters = shifts.getAllShifts.mock.calls[0][0];
    expect(filters).not.toHaveProperty('page');
    expect(filters).not.toHaveProperty('pageSize');
  });
});

describe('assignment export', () => {
  const app = () => mount('createAssignmentsRouter', '../routes/assignments', '/api/assignments');

  it('exports with the list filters and without pagination', async () => {
    const res = await request(app()).get('/api/assignments/export?userId=1&page=1&pageSize=2');

    expectCsvAttachment(res, 'assignments');
    const filters = assignments.getAllAssignments.mock.calls[0][0];
    expect(filters).toMatchObject({ userId: 1 });
    expect(filters).not.toHaveProperty('page');
    expect(assignments.getAllAssignments.mock.calls[0]).toHaveLength(1);
  });
});

describe('attendance export', () => {
  const app = () => mount('createAttendanceRouter', '../routes/attendance', '/api/attendance');

  it('lets an approver export the records their filters select', async () => {
    hasPermission = true;
    const res = await request(app()).get('/api/attendance/export?userId=3');

    expectCsvAttachment(res, 'attendance');
    expect(attendance.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 3 }));
  });

  it('pins a non-approver to their own records, ignoring the userId they asked for', async () => {
    hasPermission = false;
    currentUser = { id: 9, allowedOrgUnitIds: null };
    await request(app()).get('/api/attendance/export?userId=3');

    // Obeying that filter would let anyone download anyone's clock-in times.
    expect(attendance.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 9 }));
  });
});

describe('time-off export', () => {
  const app = () => mount('createTimeOffRouter', '../routes/timeOff', '/api/time-off');

  it('lets an approver export any request', async () => {
    hasPermission = true;
    const res = await request(app()).get('/api/time-off/export?status=approved');

    expectCsvAttachment(res, 'time-off');
    expect(timeOff.list).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
  });

  it('pins everyone else to their own requests', async () => {
    hasPermission = false;
    currentUser = { id: 9, allowedOrgUnitIds: null };
    await request(app()).get('/api/time-off/export?userId=3');

    // A stated reason for absence is the most private field in this system.
    expect(timeOff.list).toHaveBeenCalledWith(expect.objectContaining({ userId: 9 }));
  });

  it('says whether an approved request has actually been recorded', async () => {
    const res = await request(app()).get('/api/time-off/export');
    expect(res.text).toContain('Recorded As Unavailable');
    // Approval alone does not free the person — only the unavailability row does.
    expect(res.text.trim().split('\r\n')[1]).toMatch(/,no$/);
  });
});

describe('every export is audited', () => {
  it('records the actor, the dataset and the row count', async () => {
    await request(mount('createEmployeesRouter', '../routes/employees', '/api/employees')).get(
      '/api/employees/export'
    );

    expect(auditWrite).toHaveBeenCalledTimes(1);
    expect(auditWrite.mock.calls[0][0]).toMatchObject({
      actorId: 9,
      action: 'export',
      entityType: 'employees',
    });
    expect(auditWrite.mock.calls[0][0].after.rowCount).toBe(1);
  });
});
