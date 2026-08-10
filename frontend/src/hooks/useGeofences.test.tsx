import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGeofencesQuery, useGeofenceMutations } from './useGeofences';
import { createGeofence, deleteGeofence, getGeofences, updateGeofence } from '../services/departmentService';

jest.mock('../services/departmentService', () => ({
  __esModule: true,
  getGeofences: jest.fn(),
  createGeofence: jest.fn(),
  updateGeofence: jest.fn(),
  deleteGeofence: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useGeofencesQuery', () => {
  it('does not fetch when no department is selected', () => {
    renderHook(() => useGeofencesQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getGeofences).not.toHaveBeenCalled();
  });

  it('fetches the selected department fences, defaulting to empty', async () => {
    (getGeofences as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useGeofencesQuery(3), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getGeofences).toHaveBeenCalledWith(3);
    expect(result.current.data).toEqual([]);
  });
});

describe('useGeofenceMutations', () => {
  beforeEach(() => {
    (createGeofence as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateGeofence as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deleteGeofence as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('create/update/remove all scope to the department they were constructed for', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useGeofenceMutations(3), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ points: [] } as never);
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    expect(createGeofence).toHaveBeenCalledWith(3, { points: [] });

    result.current.update.mutate({ id: 1, data: { points: [] } as never });
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(updateGeofence).toHaveBeenCalledWith(3, 1, { points: [] });

    result.current.remove.mutate(1);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(deleteGeofence).toHaveBeenCalledWith(3, 1);

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['geofences', 3]))).toBe(true);
  });
});
