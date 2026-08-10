/**
 * Unit tests for pendingApprovalService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  listPendingApprovals,
  approvePendingItem,
  rejectPendingItem,
  keepPendingItem,
  delegatePendingItem,
  openPendingItemToStructure,
  getDecisionChain,
} from './pendingApprovalService';

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
  global.fetch = jest.fn().mockResolvedValue(
    okJson({ success: true, data: { items: [], total: 0 } })
  ) as jest.Mock;
  localStorage.clear();
  localStorage.setItem('token', 'jwt-token');
});

afterEach(() => jest.resetAllMocks());

const fetchMock = () => global.fetch as jest.Mock;

describe('listPendingApprovals', () => {
  it('GETs /pending-approvals defaulting to status=pending', async () => {
    await listPendingApprovals();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\?/);
    expect(url).toContain('status=pending');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('honors an explicit status', async () => {
    await listPendingApprovals('escalated');
    const [url] = fetchMock().mock.calls[0];
    expect(url).toContain('status=escalated');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(listPendingApprovals()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('approvePendingItem / rejectPendingItem', () => {
  it('POSTs the note to /pending-approvals/:id/approve', async () => {
    await approvePendingItem(1, 'looks good');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/approve$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ note: 'looks good' });
  });

  it('sends null note when none is given', async () => {
    await approvePendingItem(1);
    const [, init] = fetchMock().mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ note: null });
  });

  it('POSTs to /pending-approvals/:id/reject', async () => {
    await rejectPendingItem(1, 'not now');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/reject$/);
    expect(init?.method).toBe('POST');
  });

  it('sends null note when none is given to rejectPendingItem', async () => {
    await rejectPendingItem(1);
    const [, init] = fetchMock().mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ note: null });
  });
});

describe('keepPendingItem', () => {
  it('POSTs to /pending-approvals/:id/keep with no body', async () => {
    await keepPendingItem(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/keep$/);
    expect(init?.method).toBe('POST');
  });
});

describe('delegatePendingItem', () => {
  it('POSTs targetUserId to /pending-approvals/:id/delegate', async () => {
    await delegatePendingItem(1, 9);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/delegate$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ targetUserId: 9 });
  });
});

describe('openPendingItemToStructure', () => {
  it('POSTs to /pending-approvals/:id/open-to-structure', async () => {
    await openPendingItemToStructure(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/open-to-structure$/);
    expect(init?.method).toBe('POST');
  });
});

describe('getDecisionChain', () => {
  it('GETs /pending-approvals/:id/chain', async () => {
    await getDecisionChain(1);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/pending-approvals\/1\/chain$/);
  });
});
