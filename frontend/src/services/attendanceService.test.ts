/**
 * Unit tests for attendanceService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  clockIn,
  clockOut,
  getAttendanceRecords,
  getPendingApprovals,
  approveAttendance,
  rejectAttendance,
  punchKiosk,
  getCostEstimate,
} from './attendanceService';

const okJson = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const errJson = (status: number, code: string, message: string): Response =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(okJson({ success: true, data: [] })) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('clockIn', () => {
  it('POSTs notes and coordinates to /attendance/clock-in', async () => {
    await clockIn('running late', { latitude: 45.1, longitude: 9.2 });
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/clock-in$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      notes: 'running late',
      latitude: 45.1,
      longitude: 9.2,
    });
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(409, 'ALREADY_CLOCKED_IN', 'already in'));
    await expect(clockIn()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('clockOut', () => {
  it('POSTs to /attendance/:id/clock-out', async () => {
    await clockOut(3, 'done');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/3\/clock-out$/);
    expect(init?.method).toBe('POST');
  });
});

describe('getAttendanceRecords', () => {
  it('GETs /attendance with filters', async () => {
    await getAttendanceRecords({ status: 'confirmed' } as never);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\?/);
    expect(url).toContain('status=confirmed');
  });

  it('defaults to no filters', async () => {
    await getAttendanceRecords();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance/);
  });
});

describe('getPendingApprovals', () => {
  it('GETs /attendance filtered to pending', async () => {
    await getPendingApprovals();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toContain('status=pending');
  });
});

describe('approveAttendance / rejectAttendance', () => {
  it('POSTs to /attendance/:id/approve', async () => {
    await approveAttendance(9, 'looks right');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/9\/approve$/);
    expect(init?.method).toBe('POST');
  });

  it('POSTs to /attendance/:id/reject', async () => {
    await rejectAttendance(9, 'wrong time');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/9\/reject$/);
    expect(init?.method).toBe('POST');
  });
});

describe('punchKiosk', () => {
  it('POSTs with the kiosk token header, not an Authorization header', async () => {
    await punchKiosk('kiosk-tok', 'EMP-1');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/kiosk\/punch$/);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Kiosk-Token']).toBe('kiosk-tok');
    expect(headers['Authorization']).toBeUndefined();
    expect(JSON.parse(String(init?.body))).toEqual({ employeeId: 'EMP-1' });
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(401, 'INVALID_KIOSK_TOKEN', 'bad token'));
    await expect(punchKiosk('bad', 'EMP-1')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getCostEstimate', () => {
  it('GETs /attendance/cost-estimate with the given params', async () => {
    await getCostEstimate({ startDate: '2026-01-01', endDate: '2026-01-31' } as never);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/attendance\/cost-estimate\?/);
    expect(url).toContain('startDate=2026-01-01');
  });
});
