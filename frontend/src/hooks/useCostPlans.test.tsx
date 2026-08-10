import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCostPlansQuery,
  useCreateCostPlan,
  useUpdateCostPlan,
  useDeleteCostPlan,
} from './useCostPlans';
import { createCostPlan, deleteCostPlan, listCostPlans, updateCostPlan } from '../services/costPlanService';

jest.mock('../services/costPlanService', () => ({
  __esModule: true,
  createCostPlan: jest.fn(),
  deleteCostPlan: jest.fn(),
  listCostPlans: jest.fn(),
  updateCostPlan: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useCostPlansQuery', () => {
  it('returns the plan list, defaulting to empty', async () => {
    (listCostPlans as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useCostPlansQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateCostPlan', () => {
  it('invalidates both the cost-plans and dashboard caches', async () => {
    (createCostPlan as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCostPlan(), { wrapper: makeWrapper(client) });

    result.current.mutate({ departmentId: 1, targetAmount: 1000 } as never);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['cost-plans']);
    expect(keys).toContainEqual(['dashboard']);
  });
});

describe('useUpdateCostPlan', () => {
  it('calls the service with id + targetAmount and invalidates both caches', async () => {
    (updateCostPlan as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateCostPlan(), { wrapper: makeWrapper(client) });

    result.current.mutate({ id: 1, targetAmount: 2000 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(updateCostPlan).toHaveBeenCalledWith(1, { targetAmount: 2000 });
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['cost-plans']);
    expect(keys).toContainEqual(['dashboard']);
  });
});

describe('useDeleteCostPlan', () => {
  it('invalidates both caches', async () => {
    (deleteCostPlan as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteCostPlan(), { wrapper: makeWrapper(client) });

    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['cost-plans']);
    expect(keys).toContainEqual(['dashboard']);
  });
});
