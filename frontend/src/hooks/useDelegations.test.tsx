import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { delegationsKey, useDelegationsQuery } from './useDelegations';
import { listDelegations } from '../services/delegationService';

jest.mock('../services/delegationService', () => ({ __esModule: true, listDelegations: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useDelegationsQuery', () => {
  it('returns the delegation list', async () => {
    (listDelegations as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useDelegationsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });

  it('defaults to an empty list when the response carries no data', async () => {
    (listDelegations as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useDelegationsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('is keyed under ["delegations"], the key the page invalidates on reload()', () => {
    expect(delegationsKey).toEqual(['delegations']);
  });
});
