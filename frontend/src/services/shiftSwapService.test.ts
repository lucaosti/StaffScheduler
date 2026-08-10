/**
 * Unit tests for shiftSwapService.
 *
 * @author Luca Ostinelli
 */

import { ApiError } from './apiUtils';
import {
  getSwapRequests,
  createSwapRequest,
  respondToSwap,
  approveSwap,
  declineSwap,
  cancelSwap,
  getSwapCandidates,
  getOpenOffers,
  createOpenOffer,
  claimOpenOffer,
  cancelOpenOffer,
} from './shiftSwapService';

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

describe('getSwapRequests', () => {
  it('GETs /shift-swap', async () => {
    await getSwapRequests();
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap$/);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(500, 'INTERNAL_ERROR', 'boom'));
    await expect(getSwapRequests()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('createSwapRequest', () => {
  it('POSTs the body to /shift-swap', async () => {
    const body = { requesterAssignmentId: 1, targetAssignmentId: 2 } as never;
    await createSwapRequest(body);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(body);
  });
});

describe('respondToSwap', () => {
  it('POSTs accepted + notes to /shift-swap/:id/respond', async () => {
    await respondToSwap(1, true, 'sure');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/1\/respond$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ accepted: true, notes: 'sure' });
  });
});

describe('approveSwap / declineSwap', () => {
  it('POSTs to /shift-swap/:id/approve', async () => {
    await approveSwap(1, 'ok');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/1\/approve$/);
    expect(init?.method).toBe('POST');
  });

  it('POSTs to /shift-swap/:id/decline', async () => {
    await declineSwap(1, 'no');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/1\/decline$/);
    expect(init?.method).toBe('POST');
  });
});

describe('cancelSwap', () => {
  it('POSTs to /shift-swap/:id/cancel with no body', async () => {
    await cancelSwap(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/1\/cancel$/);
    expect(init?.method).toBe('POST');
  });
});

describe('getSwapCandidates', () => {
  it('GETs /assignments/:id/swap-candidates', async () => {
    await getSwapCandidates(42);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/assignments\/42\/swap-candidates$/);
  });
});

describe('getOpenOffers', () => {
  it('GETs /shift-swap/open without mine by default', async () => {
    await getOpenOffers();
    const [url] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/open/);
    expect(url).not.toContain('mine=1');
  });

  it('passes mine=1 when requested', async () => {
    await getOpenOffers(true);
    const [url] = fetchMock().mock.calls[0];
    expect(url).toContain('mine=1');
  });
});

describe('createOpenOffer', () => {
  it('POSTs assignmentId and notes to /shift-swap/open', async () => {
    await createOpenOffer(5, 'flexible');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/open$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ assignmentId: 5, notes: 'flexible' });
  });
});

describe('claimOpenOffer', () => {
  it('POSTs to /shift-swap/open/:id/claim', async () => {
    await claimOpenOffer(3, 7, 'happy to take it');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/open\/3\/claim$/);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ assignmentId: 7, notes: 'happy to take it' });
  });

  it('propagates ApiError on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue(errJson(409, 'CONFLICT', 'already claimed'));
    await expect(claimOpenOffer(3, 7)).rejects.toBeInstanceOf(ApiError);
  });
});

describe('cancelOpenOffer', () => {
  it('POSTs to /shift-swap/open/:id/cancel', async () => {
    await cancelOpenOffer(3);
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toMatch(/\/shift-swap\/open\/3\/cancel$/);
    expect(init?.method).toBe('POST');
  });
});
