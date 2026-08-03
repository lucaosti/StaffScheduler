/**
 * #560: the Schedule page reads assignment rows through its own composite
 * ['schedule-page'] query (useSchedulePage.ts), independent of the
 * ['assignments'] cache this hook's mutations invalidate. Staffing a shift
 * from a surface that uses THIS hook (e.g. ShiftAssignmentPanel, opened from
 * the Shifts page) must also invalidate the Schedule page's cache, or its
 * grid keeps showing pre-mutation data.
 */

import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAssignmentMutations } from './useAssignments';
import { schedulePageKey } from './useSchedulePage';

jest.mock('../services/assignmentService', () => ({
  __esModule: true,
  createAssignment: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
  deleteAssignment: jest.fn().mockResolvedValue({ success: true, data: undefined }),
  confirmAssignment: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
  declineAssignment: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
  completeAssignment: jest.fn().mockResolvedValue({ success: true, data: { id: 1 } }),
  getAssignments: jest.fn(),
  getAvailableEmployees: jest.fn(),
  getMyAssignments: jest.fn(),
}));

describe('useAssignmentMutations', () => {
  it('invalidates both the assignments cache and the Schedule page cache on create', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAssignmentMutations(), { wrapper });

    result.current.create.mutate({ shiftId: 1, userId: 2 });

    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(['assignments']);
    expect(invalidatedKeys).toContainEqual(schedulePageKey);
  });

  it('invalidates both caches on remove/confirm/decline/complete too', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidateSpy = jest.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAssignmentMutations(), { wrapper });

    result.current.confirm.mutate(1);
    await waitFor(() => expect(result.current.confirm.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
    expect(invalidatedKeys).toContainEqual(schedulePageKey);
  });
});
