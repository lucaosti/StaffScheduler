import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useKioskDevicesQuery, useKioskDeviceMutations } from './useKioskDevices';
import { createKioskDevice, deleteKioskDevice, getKioskDevices } from '../services/departmentService';

jest.mock('../services/departmentService', () => ({
  __esModule: true,
  getKioskDevices: jest.fn(),
  createKioskDevice: jest.fn(),
  deleteKioskDevice: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useKioskDevicesQuery', () => {
  it('does not fetch when no department is selected', () => {
    renderHook(() => useKioskDevicesQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getKioskDevices).not.toHaveBeenCalled();
  });

  it('fetches the selected department devices, defaulting to empty', async () => {
    (getKioskDevices as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useKioskDevicesQuery(3), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getKioskDevices).toHaveBeenCalledWith(3);
    expect(result.current.data).toEqual([]);
  });
});

describe('useKioskDeviceMutations', () => {
  beforeEach(() => {
    (createKioskDevice as jest.Mock).mockResolvedValue({ success: true, data: { id: 1, rawToken: 'tok' } });
    (deleteKioskDevice as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('create returns the unwrapped device and invalidates the department key', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useKioskDeviceMutations(3), { wrapper: makeWrapper(client) });

    result.current.create.mutate({ label: 'Front desk' } as never);
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    expect(createKioskDevice).toHaveBeenCalledWith(3, { label: 'Front desk' });
    expect(result.current.create.data).toEqual({ id: 1, rawToken: 'tok' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['kioskDevices', 3] });
  });

  it('remove invalidates the department key', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useKioskDeviceMutations(3), { wrapper: makeWrapper(client) });

    result.current.remove.mutate(1);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));

    expect(deleteKioskDevice).toHaveBeenCalledWith(3, 1);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['kioskDevices', 3] });
  });
});
