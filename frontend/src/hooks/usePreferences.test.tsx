import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyPreferencesQuery } from './usePreferences';
import { getMyPreferences } from '../services/preferencesService';

jest.mock('../services/preferencesService', () => ({ __esModule: true, getMyPreferences: jest.fn() }));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useMyPreferencesQuery', () => {
  it('returns the saved preferences', async () => {
    const prefs = { userId: 1, maxHoursPerWeek: 40 };
    (getMyPreferences as jest.Mock).mockResolvedValue({ success: true, data: prefs });
    const { result } = renderHook(() => useMyPreferencesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(prefs);
  });

  it('yields null (not an error) when the response is unsuccessful', async () => {
    (getMyPreferences as jest.Mock).mockResolvedValue({ success: false });
    const { result } = renderHook(() => useMyPreferencesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('yields null when the service call itself rejects, not an isError state', async () => {
    (getMyPreferences as jest.Mock).mockResolvedValue(undefined);
    const { result } = renderHook(() => useMyPreferencesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
