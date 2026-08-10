import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useSwapRequestsQuery,
  useSwapCandidatesQuery,
  useSwapMutations,
  useOpenOffersQuery,
  useOpenOfferMutations,
} from './useShiftSwaps';
import {
  getSwapRequests,
  getSwapCandidates,
  createSwapRequest,
  respondToSwap,
  approveSwap,
  declineSwap,
  cancelSwap,
  getOpenOffers,
  createOpenOffer,
  claimOpenOffer,
  cancelOpenOffer,
} from '../services/shiftSwapService';

jest.mock('../services/shiftSwapService', () => ({
  __esModule: true,
  getSwapRequests: jest.fn(),
  getSwapCandidates: jest.fn(),
  createSwapRequest: jest.fn(),
  respondToSwap: jest.fn(),
  approveSwap: jest.fn(),
  declineSwap: jest.fn(),
  cancelSwap: jest.fn(),
  getOpenOffers: jest.fn(),
  createOpenOffer: jest.fn(),
  claimOpenOffer: jest.fn(),
  cancelOpenOffer: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useSwapRequestsQuery', () => {
  it('returns the list, defaulting to empty', async () => {
    (getSwapRequests as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useSwapRequestsQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });
});

describe('useSwapCandidatesQuery', () => {
  it('does not fetch when no assignment is selected', () => {
    renderHook(() => useSwapCandidatesQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getSwapCandidates).not.toHaveBeenCalled();
  });

  it('fetches candidates for the selected assignment', async () => {
    (getSwapCandidates as jest.Mock).mockResolvedValue({ data: { candidates: [], truncated: true } });
    const { result } = renderHook(() => useSwapCandidatesQuery(5), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getSwapCandidates).toHaveBeenCalledWith(5);
    expect(result.current.data).toEqual({ candidates: [], truncated: true });
  });
});

describe('useSwapMutations', () => {
  const mocks: Array<[jest.Mock, unknown]> = [
    [createSwapRequest as jest.Mock, { success: true, data: { id: 1 } }],
    [respondToSwap as jest.Mock, { success: true, data: { id: 1 } }],
    [approveSwap as jest.Mock, { success: true, data: { id: 1 } }],
    [declineSwap as jest.Mock, { success: true, data: { id: 1 } }],
    [cancelSwap as jest.Mock, { success: true, data: { id: 1 } }],
  ];

  beforeEach(() => mocks.forEach(([fn, value]) => fn.mockResolvedValue(value)));

  it('propose invalidates the shift-swap cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSwapMutations(), { wrapper: makeWrapper(client) });
    result.current.propose.mutate({ requesterAssignmentId: 1, targetAssignmentId: 2 });
    await waitFor(() => expect(result.current.propose.isSuccess).toBe(true));
    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(['shift-swap']);
  });

  it('respond/approve/decline/cancel all invalidate the shift-swap cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSwapMutations(), { wrapper: makeWrapper(client) });

    result.current.respond.mutate({ id: 1, accepted: true });
    await waitFor(() => expect(result.current.respond.isSuccess).toBe(true));

    result.current.approve.mutate({ id: 1 });
    await waitFor(() => expect(result.current.approve.isSuccess).toBe(true));

    result.current.decline.mutate({ id: 1 });
    await waitFor(() => expect(result.current.decline.isSuccess).toBe(true));

    result.current.cancel.mutate(1);
    await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true));

    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

describe('useOpenOffersQuery', () => {
  it('passes mine through to the service', async () => {
    (getOpenOffers as jest.Mock).mockResolvedValue({ data: [] });
    renderHook(() => useOpenOffersQuery(true), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(getOpenOffers).toHaveBeenCalledWith(true));
  });
});

describe('useOpenOfferMutations', () => {
  beforeEach(() => {
    (createOpenOffer as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (claimOpenOffer as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (cancelOpenOffer as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('post/claim/cancel each invalidate the shift-swap cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useOpenOfferMutations(), { wrapper: makeWrapper(client) });

    result.current.post.mutate({ assignmentId: 1 });
    await waitFor(() => expect(result.current.post.isSuccess).toBe(true));

    result.current.claim.mutate({ id: 1, assignmentId: 2 });
    await waitFor(() => expect(result.current.claim.isSuccess).toBe(true));

    result.current.cancel.mutate(1);
    await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true));

    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual(
      expect.arrayContaining([['shift-swap'], ['shift-swap'], ['shift-swap']])
    );
  });
});
