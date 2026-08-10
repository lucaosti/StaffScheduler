import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { policiesKey, usePoliciesPageData } from './usePolicies';
import { listPolicies, listExceptions, listMatrix, listPresets } from '../services/policyService';
import { listRoles } from '../services/rbacService';

jest.mock('../services/policyService', () => ({
  __esModule: true,
  listPolicies: jest.fn(),
  listExceptions: jest.fn(),
  listMatrix: jest.fn(),
  listPresets: jest.fn(),
}));
jest.mock('../services/rbacService', () => ({ __esModule: true, listRoles: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => {
  jest.clearAllMocks();
  (listPolicies as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
  (listExceptions as jest.Mock).mockResolvedValue({ data: [{ id: 2 }] });
  (listPresets as jest.Mock).mockResolvedValue({ data: [{ code: 'eu_working_time_directive' }] });
  (listMatrix as jest.Mock).mockResolvedValue({ data: [{ changeType: 'x' }] });
  (listRoles as jest.Mock).mockResolvedValue({ data: [{ id: 1, name: 'Admin' }] });
});

describe('usePoliciesPageData', () => {
  it('fetches the admin-only lists (matrix, roles) for an admin', async () => {
    const { result } = renderHook(() => usePoliciesPageData(true), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMatrix).toHaveBeenCalled();
    expect(listRoles).toHaveBeenCalled();
    expect(result.current.data).toEqual({
      policies: [{ id: 1 }],
      exceptions: [{ id: 2 }],
      matrix: [{ changeType: 'x' }],
      roles: [{ id: 1, name: 'Admin' }],
      presets: [{ code: 'eu_working_time_directive' }],
    });
  });

  it('skips the admin-only lists (they resolve empty) for a non-admin', async () => {
    const { result } = renderHook(() => usePoliciesPageData(false), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listMatrix).not.toHaveBeenCalled();
    expect(listRoles).not.toHaveBeenCalled();
    expect(result.current.data?.matrix).toEqual([]);
    expect(result.current.data?.roles).toEqual([]);
    // Presets are fetched regardless — same read gate as the policy list itself.
    expect(listPresets).toHaveBeenCalled();
  });

  it('keys the query on isAdmin so switching privilege re-fetches', () => {
    expect(policiesKey).toEqual(['policies-page']);
  });
});
