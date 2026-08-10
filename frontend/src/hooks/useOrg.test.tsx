import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  orgKeys,
  useOrgTreeQuery,
  useManagerChainQuery,
  useUnitMembersQuery,
  useOrgUnitsQuery,
  useOrgUnitMembersQuery,
  useOrgLoansQuery,
  useAuthorityQuery,
} from './useOrg';
import {
  getTree,
  getManagerChain,
  getAuthorityProfile,
  listMembersDetailed,
  listUnits,
  listMembers,
  listLoans,
} from '../services/orgService';

jest.mock('../services/orgService', () => ({
  __esModule: true,
  getTree: jest.fn(),
  getManagerChain: jest.fn(),
  getAuthorityProfile: jest.fn(),
  listMembersDetailed: jest.fn(),
  listUnits: jest.fn(),
  listMembers: jest.fn(),
  listLoans: jest.fn(),
}));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useOrgTreeQuery', () => {
  it('returns the tree, defaulting to empty', async () => {
    (getTree as jest.Mock).mockResolvedValue({ data: [{ id: 1, children: [] }] });
    const { result } = renderHook(() => useOrgTreeQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1, children: [] }]);
  });
});

describe('useManagerChainQuery', () => {
  it('defaults to empty on a missing data field', async () => {
    (getManagerChain as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useManagerChainQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useUnitMembersQuery', () => {
  it('does not fetch when no unit is selected', () => {
    renderHook(() => useUnitMembersQuery(null), { wrapper: makeWrapper() });
    expect(listMembersDetailed).not.toHaveBeenCalled();
  });

  it('fetches detailed members for the selected unit', async () => {
    (listMembersDetailed as jest.Mock).mockResolvedValue({ data: [{ userId: 1 }] });
    const { result } = renderHook(() => useUnitMembersQuery(4), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMembersDetailed).toHaveBeenCalledWith(4);
    expect(result.current.data).toEqual([{ userId: 1 }]);
  });
});

describe('useOrgUnitsQuery', () => {
  it('loads the flat list and the tree together', async () => {
    (listUnits as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    (getTree as jest.Mock).mockResolvedValue({ data: [{ id: 1, children: [] }] });
    const { result } = renderHook(() => useOrgUnitsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ units: [{ id: 1 }], tree: [{ id: 1, children: [] }] });
  });
});

describe('useOrgUnitMembersQuery', () => {
  it('does not fetch when no unit is selected', () => {
    renderHook(() => useOrgUnitMembersQuery(null), { wrapper: makeWrapper() });
    expect(listMembers).not.toHaveBeenCalled();
  });

  it('fetches membership rows for the selected unit', async () => {
    (listMembers as jest.Mock).mockResolvedValue({ data: [{ userId: 1 }] });
    renderHook(() => useOrgUnitMembersQuery(4), { wrapper: makeWrapper() });
    await waitFor(() => expect(listMembers).toHaveBeenCalledWith(4));
  });
});

describe('useOrgLoansQuery', () => {
  it('returns all loans', async () => {
    (listLoans as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useOrgLoansQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 1 }]);
  });
});

describe('useAuthorityQuery', () => {
  it('fetches for the caller when userId is null (not gated by enabled)', async () => {
    (getAuthorityProfile as jest.Mock).mockResolvedValue({ data: { userId: 1, orgUnits: [] } });
    const { result } = renderHook(() => useAuthorityQuery(null), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getAuthorityProfile).toHaveBeenCalledWith(undefined);
  });

  it('fetches for a named user', async () => {
    (getAuthorityProfile as jest.Mock).mockResolvedValue({ data: { userId: 7, orgUnits: [] } });
    renderHook(() => useAuthorityQuery(7), { wrapper: makeWrapper() });
    await waitFor(() => expect(getAuthorityProfile).toHaveBeenCalledWith(7));
  });
});

describe('orgKeys', () => {
  it('keys unit-scoped queries by unit id, and authority by subject', () => {
    expect(orgKeys.members(4)).toEqual(['org', 'members', 4]);
    expect(orgKeys.unitMembers(4)).toEqual(['org', 'unit-members', 4]);
    expect(orgKeys.authority(7)).toEqual(['org', 'authority', 7]);
    expect(orgKeys.authority(null)).toEqual(['org', 'authority', null]);
  });
});
