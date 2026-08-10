import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyProfileQuery, useProfileQuery, useDirectoryMutations } from './useDirectory';
import {
  getMyProfile,
  getProfile,
  importVcard,
  previewVcardImport,
  removeProfileField,
  saveProfileFields,
} from '../services/directoryService';

jest.mock('../services/directoryService', () => ({
  __esModule: true,
  getMyProfile: jest.fn(),
  getProfile: jest.fn(),
  importVcard: jest.fn(),
  previewVcardImport: jest.fn(),
  removeProfileField: jest.fn(),
  saveProfileFields: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useMyProfileQuery', () => {
  it('returns the caller profile, defaulting to null', async () => {
    (getMyProfile as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useMyProfileQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});

describe('useProfileQuery', () => {
  it('does not fetch when no id is given', () => {
    renderHook(() => useProfileQuery(null), { wrapper: makeWrapper(makeClient()) });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('does not fetch when explicitly disabled, even with an id', () => {
    renderHook(() => useProfileQuery(9, false), { wrapper: makeWrapper(makeClient()) });
    expect(getProfile).not.toHaveBeenCalled();
  });

  it('fetches the named profile when enabled', async () => {
    (getProfile as jest.Mock).mockResolvedValue({ data: { id: 9 } });
    const { result } = renderHook(() => useProfileQuery(9), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProfile).toHaveBeenCalledWith(9);
  });
});

describe('useDirectoryMutations', () => {
  beforeEach(() => {
    (saveProfileFields as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (removeProfileField as jest.Mock).mockResolvedValue({ success: true, data: undefined });
    (previewVcardImport as jest.Mock).mockResolvedValue({ success: true, data: { rows: [] } });
    (importVcard as jest.Mock).mockResolvedValue({ success: true, data: { inserted: 1, skipped: [] } });
  });

  it('saveFields and removeField invalidate the whole directory cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDirectoryMutations(), { wrapper: makeWrapper(client) });

    result.current.saveFields.mutate({ id: 1, fields: [{ key: 'phone', value: 'x' }] });
    await waitFor(() => expect(result.current.saveFields.isSuccess).toBe(true));

    result.current.removeField.mutate({ id: 1, key: 'phone' });
    await waitFor(() => expect(result.current.removeField.isSuccess).toBe(true));

    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toEqual([['directory'], ['directory']]);
  });

  it('previewImport does NOT invalidate the cache (it writes nothing)', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDirectoryMutations(), { wrapper: makeWrapper(client) });

    result.current.previewImport.mutate('BEGIN:VCARD...');
    await waitFor(() => expect(result.current.previewImport.isSuccess).toBe(true));

    expect(spy).not.toHaveBeenCalled();
  });

  it('runImport invalidates the directory cache', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDirectoryMutations(), { wrapper: makeWrapper(client) });

    result.current.runImport.mutate({ vcf: 'BEGIN:VCARD...', defaultPassword: 'Temp1234!' });
    await waitFor(() => expect(result.current.runImport.isSuccess).toBe(true));

    expect(spy.mock.calls.map((c) => c[0]?.queryKey)).toContainEqual(['directory']);
  });
});
