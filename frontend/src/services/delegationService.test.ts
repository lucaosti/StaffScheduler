/**
 * Unit tests for delegationService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import { listDelegations, createDelegation, revokeDelegation } from './delegationService';

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

describe('listDelegations', () => {
  it('GETs /delegations', async () => {
    await listDelegations();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/delegations$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(listDelegations()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createDelegation', () => {
  it('POSTs the body to /delegations', async () => {
    const body = {
      delegateeId: 3,
      permissionCodes: ['shift.manage'],
      startsAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-02-01T00:00:00Z',
    } as never;
    await createDelegation(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/delegations$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('revokeDelegation', () => {
  it('DELETEs /delegations/:id carrying the justification in the body', async () => {
    await revokeDelegation(5, 'no longer needed');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/delegations\/5$/);
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(String(init?.body))).toEqual({ justification: 'no longer needed' });
  });

  it('sends null justification when none is given', async () => {
    await revokeDelegation(5);
    const [, init] = fetchMock().mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ justification: null });
  });
});
