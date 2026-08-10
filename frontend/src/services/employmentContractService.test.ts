/**
 * Unit tests for employmentContractService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getContracts,
  createContract,
  updateContract,
  getUserContracts,
  assignContract,
} from './employmentContractService';

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

describe('getContracts', () => {
  it('GETs /employment-contracts', async () => {
    await getContracts();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employment-contracts$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getContracts()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createContract', () => {
  it('POSTs the body to /employment-contracts', async () => {
    const body = { name: 'Full-time', maxHoursPerWeek: 40 } as never;
    await createContract(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employment-contracts$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('updateContract', () => {
  it('PUTs to /employment-contracts/:id', async () => {
    await updateContract(3, { maxHoursPerWeek: 32 } as never);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employment-contracts\/3$/);
    expect(init?.method).toBe('PUT');
  });
});

describe('getUserContracts', () => {
  it('GETs /employment-contracts/users/:userId', async () => {
    await getUserContracts(7);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employment-contracts\/users\/7$/);
  });
});

describe('assignContract', () => {
  it('POSTs to /employment-contracts/users/:userId', async () => {
    const body = { contractId: 3, effectiveFrom: '2026-01-01' } as never;
    await assignContract(7, body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/employment-contracts\/users\/7$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});
