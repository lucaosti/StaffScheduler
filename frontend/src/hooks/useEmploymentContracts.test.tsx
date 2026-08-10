import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useContractsQuery, useUserContractsQuery, useContractMutations } from './useEmploymentContracts';
import { assignContract, createContract, getContracts, getUserContracts, updateContract } from '../services/employmentContractService';

jest.mock('../services/employmentContractService', () => ({
  __esModule: true,
  assignContract: jest.fn(),
  createContract: jest.fn(),
  getContracts: jest.fn(),
  getUserContracts: jest.fn(),
  updateContract: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useContractsQuery', () => {
  it('returns the catalogue, defaulting to empty', async () => {
    (getContracts as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useContractsQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useUserContractsQuery', () => {
  it('does not fetch when no user is selected', () => {
    renderHook(() => useUserContractsQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getUserContracts).not.toHaveBeenCalled();
  });

  it('fetches the selected user history', async () => {
    (getUserContracts as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useUserContractsQuery(9), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getUserContracts).toHaveBeenCalledWith(9);
  });
});

describe('useContractMutations', () => {
  beforeEach(() => {
    (createContract as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateContract as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (assignContract as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('create/update/assign all invalidate the whole employment-contracts cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useContractMutations(), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ name: 'Full-time' });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    result.current.update.mutate({ id: 1, name: 'Renamed' });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateContract).toHaveBeenCalledWith(1, { name: 'Renamed' });

    result.current.assign.mutate({ userId: 9, contractId: 1, effectiveFrom: '2026-01-01' });
    await waitFor(() => expect(result.current.assign.isSuccess).toBe(true));
    expect(assignContract).toHaveBeenCalledWith(9, { contractId: 1, effectiveFrom: '2026-01-01' });

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['employment-contracts']))).toBe(true);
    expect(spy.mock.calls.length).toBe(3);
  });
});
