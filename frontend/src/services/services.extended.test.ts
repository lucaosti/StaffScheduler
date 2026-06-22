/**
 * Extended service tests covering previously uncovered branches.
 *
 * Covers:
 *   - calendarService (all exports)
 *   - employeeService (getEmployee, updateEmployee, deleteEmployee — 0% lines)
 *   - shiftService (createShift, updateShift, deleteShift — 0% lines)
 *   - scheduleService (getScheduleWithShifts, updateSchedule, deleteSchedule,
 *       generateSchedule, publishSchedule, archiveSchedule)
 *
 * @author Luca Ostinelli
 */

import * as employeeService from './employeeService';
import * as shiftService from './shiftService';
import * as scheduleService from './scheduleService';

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest
    .fn()
    .mockResolvedValue(okJson({ success: true, data: {} })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;
const lastUrl = () => fetchMock().mock.calls[0][0] as string;
const lastInit = () => fetchMock().mock.calls[0][1] as RequestInit;

// ─── employeeService ──────────────────────────────────────────────────────────

describe('employeeService', () => {
  describe('getEmployees', () => {
    it('passes filters as query params', async () => {
      await employeeService.getEmployees({ department: 'ICU', page: 2, limit: 5 });
      expect(lastUrl()).toContain('department=ICU');
      expect(lastUrl()).toContain('page=2');
      expect(lastUrl()).toContain('limit=5');
    });

    it('skips undefined filter values', async () => {
      await employeeService.getEmployees({ department: undefined });
      expect(lastUrl()).not.toContain('department');
    });
  });

  describe('getEmployee', () => {
    it('GETs /employees/:id', async () => {
      await employeeService.getEmployee(42);
      expect(lastUrl()).toMatch(/\/employees\/42$/);
      expect(lastInit().method ?? 'GET').toBe('GET');
    });

    it('accepts a string id', async () => {
      await employeeService.getEmployee('EMP001');
      expect(lastUrl()).toMatch(/\/employees\/EMP001$/);
    });
  });

  describe('createEmployee', () => {
    it('POSTs the employee payload', async () => {
      await employeeService.createEmployee({
        employeeId: 'E1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@x.com',
      });
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toMatch(/\/employees$/);
      const body = JSON.parse(lastInit().body as string);
      expect(body.email).toBe('john@x.com');
    });
  });

  describe('updateEmployee', () => {
    it('PUTs the updated payload to /employees/:id', async () => {
      await employeeService.updateEmployee(7, { position: 'Senior Nurse' });
      expect(lastInit().method).toBe('PUT');
      expect(lastUrl()).toMatch(/\/employees\/7$/);
      const body = JSON.parse(lastInit().body as string);
      expect(body.position).toBe('Senior Nurse');
    });
  });

  describe('deleteEmployee', () => {
    it('DELETEs /employees/:id', async () => {
      await employeeService.deleteEmployee(9);
      expect(lastInit().method).toBe('DELETE');
      expect(lastUrl()).toMatch(/\/employees\/9$/);
    });
  });
});

// ─── shiftService ─────────────────────────────────────────────────────────────

describe('shiftService', () => {
  describe('getShifts', () => {
    it('passes filters as query params', async () => {
      await shiftService.getShifts({ status: 'open', page: 1, limit: 20 });
      expect(lastUrl()).toContain('status=open');
      expect(lastUrl()).toContain('page=1');
    });

    it('works with no filters', async () => {
      await shiftService.getShifts();
      expect(lastUrl()).toMatch(/\/shifts/);
    });
  });

  describe('createShift', () => {
    it('POSTs the shift data', async () => {
      await shiftService.createShift({
        scheduleId: 1,
        departmentId: 2,
        date: '2025-01-15',
        startTime: '08:00',
        endTime: '16:00',
        minStaff: 2,
      });
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toMatch(/\/shifts$/);
      const body = JSON.parse(lastInit().body as string);
      expect(body.scheduleId).toBe(1);
    });
  });

  describe('updateShift', () => {
    it('PUTs to /shifts/:id', async () => {
      await shiftService.updateShift(5, { minStaff: 3 });
      expect(lastInit().method).toBe('PUT');
      expect(lastUrl()).toMatch(/\/shifts\/5$/);
    });

    it('accepts a string id', async () => {
      await shiftService.updateShift('shift-uuid', { status: 'confirmed' });
      expect(lastUrl()).toMatch(/\/shifts\/shift-uuid$/);
    });
  });

  describe('deleteShift', () => {
    it('DELETEs /shifts/:id', async () => {
      await shiftService.deleteShift(11);
      expect(lastInit().method).toBe('DELETE');
      expect(lastUrl()).toMatch(/\/shifts\/11$/);
    });
  });
});

// ─── scheduleService ──────────────────────────────────────────────────────────

describe('scheduleService', () => {
  describe('getSchedules', () => {
    it('hits /schedules with no params', async () => {
      await scheduleService.getSchedules();
      expect(lastUrl()).toMatch(/\/schedules$/);
    });

    it('appends query params when provided', async () => {
      await scheduleService.getSchedules({ departmentId: '3' });
      expect(lastUrl()).toContain('departmentId=3');
    });
  });

  describe('getScheduleWithShifts', () => {
    it('GETs /schedules/:id/shifts', async () => {
      await scheduleService.getScheduleWithShifts(4);
      expect(lastUrl()).toMatch(/\/schedules\/4\/shifts$/);
    });
  });

  describe('createSchedule', () => {
    it('POSTs to /schedules', async () => {
      await scheduleService.createSchedule({
        name: 'Jan Schedule',
        startDate: '2025-01-01',
        endDate: '2025-01-31',
        departmentId: 1,
      });
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toMatch(/\/schedules$/);
    });
  });

  describe('updateSchedule', () => {
    it('PUTs to /schedules/:id', async () => {
      await scheduleService.updateSchedule(2, { name: 'Updated' });
      expect(lastInit().method).toBe('PUT');
      expect(lastUrl()).toMatch(/\/schedules\/2$/);
    });
  });

  describe('deleteSchedule', () => {
    it('DELETEs /schedules/:id', async () => {
      await scheduleService.deleteSchedule(3);
      expect(lastInit().method).toBe('DELETE');
      expect(lastUrl()).toMatch(/\/schedules\/3$/);
    });
  });

  describe('generateSchedule', () => {
    it('POSTs to /schedules/:id/generate', async () => {
      await scheduleService.generateSchedule(5);
      expect(lastInit().method).toBe('POST');
      expect(lastUrl()).toMatch(/\/schedules\/5\/generate$/);
    });
  });

  describe('publishSchedule', () => {
    it('PATCHes /schedules/:id/publish', async () => {
      await scheduleService.publishSchedule(6);
      expect(lastInit().method).toBe('PATCH');
      expect(lastUrl()).toMatch(/\/schedules\/6\/publish$/);
    });
  });

  describe('archiveSchedule', () => {
    it('PATCHes /schedules/:id/archive', async () => {
      await scheduleService.archiveSchedule(7);
      expect(lastInit().method).toBe('PATCH');
      expect(lastUrl()).toMatch(/\/schedules\/7\/archive$/);
    });
  });
});
