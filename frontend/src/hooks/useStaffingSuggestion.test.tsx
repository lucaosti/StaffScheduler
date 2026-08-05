import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useStaffingSuggestion } from './useStaffingSuggestion';
import { getStaffingSuggestion } from '../services/shiftService';

jest.mock('../services/shiftService', () => ({
  __esModule: true,
  getStaffingSuggestion: jest.fn(),
}));

const makeWrapper = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return wrapper;
};

describe('useStaffingSuggestion', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not fetch until department, date and both times are known', () => {
    renderHook(
      () => useStaffingSuggestion({ departmentId: 3, date: '2026-08-10' }),
      { wrapper: makeWrapper() }
    );

    expect(getStaffingSuggestion).not.toHaveBeenCalled();
  });

  it('fetches once all four fields are present and returns the suggestion', async () => {
    (getStaffingSuggestion as jest.Mock).mockResolvedValue({
      success: true,
      data: { suggestedMinStaff: 4, basedOnOccurrences: 8, lookbackWeeks: 12 },
    });

    const { result } = renderHook(
      () =>
        useStaffingSuggestion({
          departmentId: 3,
          date: '2026-08-10',
          startTime: '08:00',
          endTime: '16:00',
        }),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getStaffingSuggestion).toHaveBeenCalledWith({
      departmentId: 3,
      date: '2026-08-10',
      startTime: '08:00',
      endTime: '16:00',
    });
    expect(result.current.data).toEqual({
      suggestedMinStaff: 4,
      basedOnOccurrences: 8,
      lookbackWeeks: 12,
    });
  });

  it('respects an explicit enabled=false even when all fields are present', () => {
    renderHook(
      () =>
        useStaffingSuggestion(
          { departmentId: 3, date: '2026-08-10', startTime: '08:00', endTime: '16:00' },
          false
        ),
      { wrapper: makeWrapper() }
    );

    expect(getStaffingSuggestion).not.toHaveBeenCalled();
  });

  it('throws when the response is unsuccessful', async () => {
    (getStaffingSuggestion as jest.Mock).mockResolvedValue({ success: false });

    const { result } = renderHook(
      () =>
        useStaffingSuggestion({
          departmentId: 3,
          date: '2026-08-10',
          startTime: '08:00',
          endTime: '16:00',
        }),
      { wrapper: makeWrapper() }
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
