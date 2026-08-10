import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useDepartmentsQuery } from './useDepartments';
import { getDepartments } from '../services/departmentService';

jest.mock('../services/departmentService', () => ({ __esModule: true, getDepartments: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useDepartmentsQuery', () => {
  it('returns the department list, defaulting to empty', async () => {
    (getDepartments as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useDepartmentsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useDepartmentsQuery(false), { wrapper: makeWrapper() });
    expect(getDepartments).not.toHaveBeenCalled();
  });

  it('fetches by default (enabled=true)', async () => {
    (getDepartments as jest.Mock).mockResolvedValue({ data: [{ id: 1 }] });
    const { result } = renderHook(() => useDepartmentsQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getDepartments).toHaveBeenCalled();
  });
});
