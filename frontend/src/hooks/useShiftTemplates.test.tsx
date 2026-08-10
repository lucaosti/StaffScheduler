import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useShiftTemplatesQuery, useShiftTemplateMutations } from './useShiftTemplates';
import { createShiftTemplate, deleteShiftTemplate, getShiftTemplates, updateShiftTemplate } from '../services/shiftService';

jest.mock('../services/shiftService', () => ({
  __esModule: true,
  createShiftTemplate: jest.fn(),
  deleteShiftTemplate: jest.fn(),
  getShiftTemplates: jest.fn(),
  updateShiftTemplate: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useShiftTemplatesQuery', () => {
  it('does not fetch when explicitly disabled', () => {
    renderHook(() => useShiftTemplatesQuery(false), { wrapper: makeWrapper(makeClient()) });
    expect(getShiftTemplates).not.toHaveBeenCalled();
  });

  it('fetches by default, defaulting to empty', async () => {
    (getShiftTemplates as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useShiftTemplatesQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useShiftTemplateMutations', () => {
  beforeEach(() => {
    (createShiftTemplate as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateShiftTemplate as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deleteShiftTemplate as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('every mutation invalidates the whole template list (a retire changes shape, not a row)', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useShiftTemplateMutations(), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ name: 'Morning' });
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    result.current.update.mutate({ id: 1, name: 'Renamed' });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateShiftTemplate).toHaveBeenCalledWith(1, { name: 'Renamed' });

    result.current.remove.mutate(1);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['shift-templates']))).toBe(true);
    expect(spy.mock.calls.length).toBe(3);
  });
});
