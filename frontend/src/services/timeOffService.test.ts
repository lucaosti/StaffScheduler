/**
 * Unit tests for timeOffService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getTimeOffRequests,
  createTimeOffRequest,
  approveTimeOff,
  rejectTimeOff,
  cancelTimeOff,
} from './timeOffService';

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

describe('getTimeOffRequests', () => {
  it('GETs /time-off with filters', async () => {
    await getTimeOffRequests({ status: 'pending' } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/time-off\?/);
    expect(url).toContain('status=pending');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getTimeOffRequests()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createTimeOffRequest', () => {
  it('POSTs the body to /time-off', async () => {
    const body = { startDate: '2026-02-01', endDate: '2026-02-05' } as never;
    await createTimeOffRequest(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/time-off$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('approveTimeOff / rejectTimeOff', () => {
  it('POSTs to /time-off/:id/approve', async () => {
    await approveTimeOff(6, 'ok');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/time-off\/6\/approve$/);
    expect(init?.method).toBe('POST');
  });

  it('POSTs to /time-off/:id/reject', async () => {
    await rejectTimeOff(6, 'understaffed that week');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/time-off\/6\/reject$/);
    expect(init?.method).toBe('POST');
  });
});

describe('cancelTimeOff', () => {
  it('POSTs to /time-off/:id/cancel with no body', async () => {
    await cancelTimeOff(6);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/time-off\/6\/cancel$/);
    expect(init?.method).toBe('POST');
  });
});
