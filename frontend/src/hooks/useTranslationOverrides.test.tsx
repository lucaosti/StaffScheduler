import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useTranslationOverridesQuery,
  useCreateTranslationOverride,
  useUpdateTranslationOverride,
  useDeleteTranslationOverride,
} from './useTranslationOverrides';
import {
  createTranslationOverride,
  deleteTranslationOverride,
  listTranslationOverrides,
  updateTranslationOverride,
} from '../services/translationOverrideService';

jest.mock('../services/translationOverrideService', () => ({
  __esModule: true,
  createTranslationOverride: jest.fn(),
  deleteTranslationOverride: jest.fn(),
  listTranslationOverrides: jest.fn(),
  updateTranslationOverride: jest.fn(),
}));

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const makeWrapper = (client: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useTranslationOverridesQuery', () => {
  it('returns the override list, defaulting to empty', async () => {
    (listTranslationOverrides as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useTranslationOverridesQuery(), { wrapper: makeWrapper(makeClient()) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe('useCreateTranslationOverride / useUpdateTranslationOverride / useDeleteTranslationOverride', () => {
  beforeEach(() => {
    (createTranslationOverride as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (updateTranslationOverride as jest.Mock).mockResolvedValue({ success: true, data: { id: 1 } });
    (deleteTranslationOverride as jest.Mock).mockResolvedValue({ success: true, data: undefined });
  });

  it('each invalidates the override list', async () => {
    const client = makeClient();
    const spy = jest.spyOn(client, 'invalidateQueries');

    const created = renderHook(() => useCreateTranslationOverride(), { wrapper: makeWrapper(client) });
    created.result.current.mutate({ locale: 'it', key: 'x', overrides: {} } as never);
    await waitFor(() => expect(created.result.current.isSuccess).toBe(true));

    const updated = renderHook(() => useUpdateTranslationOverride(), { wrapper: makeWrapper(client) });
    updated.result.current.mutate({ id: 1, overrides: { greeting: 'Ciao' } });
    await waitFor(() => expect(updated.result.current.isSuccess).toBe(true));
    expect(updateTranslationOverride).toHaveBeenCalledWith(1, { overrides: { greeting: 'Ciao' } });

    const deleted = renderHook(() => useDeleteTranslationOverride(), { wrapper: makeWrapper(client) });
    deleted.result.current.mutate(1);
    await waitFor(() => expect(deleted.result.current.isSuccess).toBe(true));

    expect(spy.mock.calls.every((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(['translation-overrides']))).toBe(true);
    expect(spy.mock.calls.length).toBe(3);
  });
});
