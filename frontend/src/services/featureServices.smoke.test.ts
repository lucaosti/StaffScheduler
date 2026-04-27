/**
 * Smoke tests for the F-feature service modules (F01–F22 frontend clients).
 * Same fetch-mock pattern as services.smoke.test.ts.
 */

import * as notifications from './notificationService';
import * as timeOff from './timeOffService';
import * as shiftSwap from './shiftSwapService';
import * as calendar from './calendarService';
import * as onCall from './onCallService';
import * as directory from './directoryService';
import * as reports from './reportsService';

const okJsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(
    okJsonResponse({ success: true, data: [] })
  ) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = (): jest.Mock => global.fetch as jest.Mock;

describe('notificationService', () => {
  it('listNotifications appends ?unreadOnly=1 when requested', async () => {
    await notifications.listNotifications({ unreadOnly: true });
    expect(fetchMock().mock.calls[0][0]).toContain('unreadOnly=1');
  });

  it('markRead uses PATCH', async () => {
    await notifications.markRead(1);
    expect(fetchMock().mock.calls[0][1].method).toBe('PATCH');
  });

  it('unreadCount hits /unread-count', async () => {
    await notifications.unreadCount();
    expect(fetchMock().mock.calls[0][0]).toMatch(/unread-count/);
  });
});

describe('timeOffService', () => {
  it('list passes status filter', async () => {
    await timeOff.list({ status: 'pending' });
    expect(fetchMock().mock.calls[0][0]).toContain('status=pending');
  });

  it('create POSTs the body', async () => {
    await timeOff.create({ startDate: '2026-05-01', endDate: '2026-05-03' });
    expect(fetchMock().mock.calls[0][1].method).toBe('POST');
  });

  it('approve POSTs to /:id/approve', async () => {
    await timeOff.approve(1, 'OK');
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/time-off\/1\/approve$/);
  });

  it('cancel POSTs to /:id/cancel', async () => {
    await timeOff.cancel(1);
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/time-off\/1\/cancel$/);
  });
});

describe('shiftSwapService', () => {
  it('create POSTs to /shift-swap', async () => {
    await shiftSwap.create({ requesterAssignmentId: 1, targetAssignmentId: 2 });
    expect(fetchMock().mock.calls[0][1].method).toBe('POST');
  });

  it('approve POSTs to /:id/approve', async () => {
    await shiftSwap.approve(1);
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/shift-swap\/1\/approve$/);
  });
});

describe('calendarService', () => {
  it('getOrCreateToken POSTs to /calendar/token', async () => {
    await calendar.getOrCreateToken();
    expect(fetchMock().mock.calls[0][1].method).toBe('POST');
  });

  it('rotateToken POSTs to /calendar/token/rotate', async () => {
    await calendar.rotateToken();
    expect(fetchMock().mock.calls[0][0]).toMatch(/rotate$/);
  });

  it('buildSubscriptionUrl produces a token-bearing URL', () => {
    const url = calendar.buildSubscriptionUrl('abc');
    expect(url).toContain('feed.ics');
    expect(url).toContain('token=abc');
  });

  it('buildDepartmentSubscriptionUrl includes the department id', () => {
    const url = calendar.buildDepartmentSubscriptionUrl(3, 'abc');
    expect(url).toContain('department/3.ics');
  });
});

describe('onCallService', () => {
  it('listMine hits /on-call/me', async () => {
    await onCall.listMine();
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/on-call\/me/);
  });

  it('createPeriod POSTs', async () => {
    await onCall.createPeriod({
      departmentId: 3,
      date: '2026-05-01',
      startTime: '20:00',
      endTime: '08:00',
    });
    expect(fetchMock().mock.calls[0][1].method).toBe('POST');
  });

  it('assignUser POSTs to /:id/assign', async () => {
    await onCall.assignUser(1, 7);
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/periods\/1\/assign$/);
  });

  it('unassignUser DELETEs', async () => {
    await onCall.unassignUser(1, 7);
    expect(fetchMock().mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('directoryService', () => {
  it('getMe hits /directory/me', async () => {
    await directory.getMe();
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/directory\/me$/);
  });

  it('setFields uses PUT', async () => {
    await directory.setFields(7, [{ key: 'birthday', value: '1990-01-01' }]);
    expect(fetchMock().mock.calls[0][1].method).toBe('PUT');
  });

  it('buildVCardUrl returns the absolute vCard URL', () => {
    expect(directory.buildVCardUrl(7)).toMatch(/\/directory\/users\/7\/vcard$/);
  });

  it('buildMultiVCardUrl encodes ids', () => {
    expect(directory.buildMultiVCardUrl([1, 2, 3])).toMatch(/ids=1,2,3$/);
  });

  it('importVcf POSTs the body', async () => {
    await directory.importVcf('BEGIN:VCARD\r\nVERSION:4.0\r\nFN:X\r\nEND:VCARD\r\n');
    expect(fetchMock().mock.calls[0][1].method).toBe('POST');
  });
});

describe('reportsService', () => {
  it('hoursWorked passes start, end, and optional departmentId', async () => {
    await reports.hoursWorked('2026-05-01', '2026-05-31', 3);
    const url = fetchMock().mock.calls[0][0] as string;
    expect(url).toContain('start=2026-05-01');
    expect(url).toContain('end=2026-05-31');
    expect(url).toContain('departmentId=3');
  });

  it('costByDepartment hits /cost-by-department', async () => {
    await reports.costByDepartment('2026-05-01', '2026-05-31');
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/cost-by-department/);
  });

  it('fairness hits /fairness/:scheduleId', async () => {
    await reports.fairness(1);
    expect(fetchMock().mock.calls[0][0]).toMatch(/\/fairness\/1$/);
  });
});
