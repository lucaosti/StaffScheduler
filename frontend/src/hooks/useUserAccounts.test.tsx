import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUserAccountsQuery, useUserAccountMutations } from './useUserAccounts';
import { createUserAccount, deactivateUserAccount, getUserAccounts, updateUserAccount } from '../services/userAccountService';

jest.mock('../services/userAccountService', () => ({
  __esModule: true,
  createUserAccount: jest.fn(),
  deactivateUserAccount: jest.fn(),
  getUserAccounts: jest.fn(),
  updateUserAccount: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useUserAccountsQuery', () => {
  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useUserAccountsQuery({}, false), { wrapper: makeWrapper(makeClient()) });
    expect(getUserAccounts).not.toHaveBeenCalled();
  });

  it('fetches by default, defaulting to an empty list', async () => {
    (getUserAccounts as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useUserAccountsQuery({ isActive: true } as never), {
      wrapper: makeWrapper(makeClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getUserAccounts).toHaveBeenCalledWith({ isActive: true });
    expect(result.current.data).toEqual([]);
  });
});

describe('useUserAccountMutations', () => {
  beforeEach(() => {
    (createUserAccount as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateUserAccount as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deactivateUserAccount as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('every mutation invalidates the whole key (deactivation is soft, changes shape not a row)', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUserAccountMutations(), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ email: 'a@x.com' });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    result.current.update.mutate({ id: 1, firstName: 'Changed' });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateUserAccount).toHaveBeenCalledWith(1, { firstName: 'Changed' });

    result.current.deactivate.mutate(1);
    await waitFor(() => expect(result.current.deactivate.isSuccess).toBe(true));

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['user-accounts']))).toBe(true);
    expect(spy.mock.calls.length).toBe(3);
  });
});
