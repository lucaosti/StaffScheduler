/**
 * Unit tests for userAccountService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getUserAccounts,
  createUserAccount,
  updateUserAccount,
  deactivateUserAccount,
} from './userAccountService';

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

describe('getUserAccounts', () => {
  it('GETs /users with filters', async () => {
    await getUserAccounts({ isActive: true } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/users\?/);
    expect(url).toContain('isActive=true');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getUserAccounts()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createUserAccount', () => {
  it('POSTs the body to /users', async () => {
    const body = { email: 'new@x.com', firstName: 'A', lastName: 'B' } as never;
    await createUserAccount(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/users$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('updateUserAccount', () => {
  it('PUTs to /users/:id', async () => {
    await updateUserAccount(8, { firstName: 'Changed' } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/users\/8$/);
    expect(init?.method).toBe('PUT');
  });
});

describe('deactivateUserAccount', () => {
  it('DELETEs /users/:id (soft delete server-side)', async () => {
    await deactivateUserAccount(8);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/users\/8$/);
    expect(init?.method).toBe('DELETE');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(403, 'FORBIDDEN', 'no access'));
    await expect(deactivateUserAccount(8)).rejects.toBeInstanceOf(ApiError);
  });
});
