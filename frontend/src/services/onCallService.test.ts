/**
 * Unit tests for onCallService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getMyOnCall,
  getOnCallPeriods,
  createOnCallPeriod,
  updateOnCallPeriod,
  deleteOnCallPeriod,
  getPeriodAssignments,
  assignToPeriod,
  removeFromPeriod,
} from './onCallService';

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

describe('getMyOnCall', () => {
  it('GETs /on-call/me', async () => {
    await getMyOnCall();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/me/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getMyOnCall()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getOnCallPeriods', () => {
  it('GETs /on-call/periods with filters', async () => {
    await getOnCallPeriods({ departmentId: 3 } as never);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\?/);
    expect(url).toContain('departmentId=3');
  });

  it('defaults to no filters', async () => {
    await getOnCallPeriods();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods/);
  });
});

describe('createOnCallPeriod', () => {
  it('POSTs the body to /on-call/periods', async () => {
    const body = { departmentId: 3, date: '2026-01-01', startTime: '08:00', endTime: '16:00' } as never;
    await createOnCallPeriod(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('updateOnCallPeriod', () => {
  it('PUTs to /on-call/periods/:id', async () => {
    await updateOnCallPeriod(4, { notes: 'updated' } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\/4$/);
    expect(init?.method).toBe('PUT');
  });
});

describe('deleteOnCallPeriod', () => {
  it('DELETEs /on-call/periods/:id', async () => {
    await deleteOnCallPeriod(4);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\/4$/);
    expect(init?.method).toBe('DELETE');
  });
});

describe('getPeriodAssignments', () => {
  it('GETs /on-call/periods/:id/assignments', async () => {
    await getPeriodAssignments(4);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\/4\/assignments$/);
  });
});

describe('assignToPeriod', () => {
  it('POSTs userId to /on-call/periods/:id/assign', async () => {
    await assignToPeriod(4, 7);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\/4\/assign$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ userId: 7 });
  });
});

describe('removeFromPeriod', () => {
  it('DELETEs /on-call/periods/:id/assign/:userId', async () => {
    await removeFromPeriod(4, 7);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/on-call\/periods\/4\/assign\/7$/);
    expect(init?.method).toBe('DELETE');
  });
});
