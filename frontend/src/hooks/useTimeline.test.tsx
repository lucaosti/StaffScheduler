import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTimelineQuery, useTimelineSourcesQuery } from './useTimeline';
import { getTimeline, getTimelineSources } from '../services/timelineService';

jest.mock('../services/timelineService', () => ({
  __esModule: true,
  getTimeline: jest.fn(),
  getTimelineSources: jest.fn(),
}));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

beforeEach(() => jest.clearAllMocks());

describe('useTimelineQuery', () => {
  it('does not fetch when either bound is missing', () => {
    renderHook(() => useTimelineQuery('', '2026-01-31'), { wrapper: makeWrapper() });
    expect(getTimeline).not.toHaveBeenCalled();
  });

  it('fetches the range once both bounds are present, omitting sources when unset', async () => {
    (getTimeline as jest.Mock).mockResolvedValue({
      data: { from: '2026-01-01', to: '2026-01-31', lanes: [], bars: [], sources: [] },
    });
    const { result } = renderHook(() => useTimelineQuery('2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getTimeline).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('includes sources when given', async () => {
    (getTimeline as jest.Mock).mockResolvedValue({ data: undefined });
    renderHook(() => useTimelineQuery('2026-01-01', '2026-01-31', 'schedule'), { wrapper: makeWrapper() });
    await waitFor(() =>
      expect(getTimeline).toHaveBeenCalledWith({ from: '2026-01-01', to: '2026-01-31', sources: 'schedule' })
    );
  });

  it('falls back to an empty timeline shape when the response carries no data', async () => {
    (getTimeline as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useTimelineQuery('2026-01-01', '2026-01-31'), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
      lanes: [],
      bars: [],
      sources: [],
    });
  });
});

describe('useTimelineSourcesQuery', () => {
  it('returns the source list, defaulting to empty', async () => {
    (getTimelineSources as jest.Mock).mockResolvedValue({ data: undefined });
    const { result } = renderHook(() => useTimelineSourcesQuery(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});
