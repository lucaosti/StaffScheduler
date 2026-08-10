/**
 * useScheduleActions — the create/generate/publish/archive flows extracted
 * from Schedule.tsx. The case with the most weight is the generate flow's
 * two paths: a synchronous result (no Redis) versus an async job that must
 * be polled until it reaches a terminal state — and within that, telling an
 * optimal run from a degraded (greedy-fallback) one, since a degraded run
 * must never read as the optimum.
 *
 * @author Luca Ostinelli
 */

import { act, renderHook } from '@testing-library/react';
import { useScheduleActions } from './useScheduleActions';
import { ApiError } from '../../services/apiUtils';

const mockCreateSchedule = jest.fn();
const mockGenerateSchedule = jest.fn();
const mockGetOptimizationStatus = jest.fn();
const mockPublishSchedule = jest.fn();
const mockArchiveSchedule = jest.fn();

jest.mock('../../services/scheduleService', () => ({
  createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
  generateSchedule: (...args: unknown[]) => mockGenerateSchedule(...args),
  getOptimizationStatus: (...args: unknown[]) => mockGetOptimizationStatus(...args),
  publishSchedule: (...args: unknown[]) => mockPublishSchedule(...args),
  archiveSchedule: (...args: unknown[]) => mockArchiveSchedule(...args),
}));

const CREATE_VALUES = {
  name: 'Week 12',
  startDate: '2026-03-16',
  endDate: '2026-03-22',
  departmentId: 1,
  notes: undefined,
};

const formEvent = () => ({ preventDefault: jest.fn() }) as unknown as React.FormEvent<HTMLFormElement>;

describe('useScheduleActions', () => {
  let loadData: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    loadData = jest.fn().mockResolvedValue(undefined);
  });

  describe('modal open/close helpers', () => {
    it('openCreateModal clears any previous create error and opens the modal', () => {
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openCreateModal());
      expect(result.current.showCreateModal).toBe(true);
      expect(result.current.createError).toBeNull();
    });

    it('openGenerateModal sets the target schedule and opens the modal', () => {
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(7));
      expect(result.current.showGenerateModal).toBe(true);
      expect(result.current.selectedScheduleId).toBe(7);
    });

    it('closeCreateModal / closeGenerateModal close without touching other state', () => {
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => { result.current.openCreateModal(); result.current.openGenerateModal(3); });
      act(() => result.current.closeCreateModal());
      expect(result.current.showCreateModal).toBe(false);
      act(() => result.current.closeGenerateModal());
      expect(result.current.showGenerateModal).toBe(false);
    });
  });

  describe('handleCreateSchedule', () => {
    it('closes the modal, sets the info banner, and reloads on success', async () => {
      mockCreateSchedule.mockResolvedValue({ success: true, data: { id: 1 } });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleCreateSchedule(CREATE_VALUES));

      expect(mockCreateSchedule).toHaveBeenCalledWith(CREATE_VALUES);
      expect(result.current.showCreateModal).toBe(false);
      expect(result.current.info).toContain('Week 12');
      expect(loadData).toHaveBeenCalled();
      expect(result.current.isCreating).toBe(false);
    });

    it('surfaces an API-level failure without closing the modal', async () => {
      mockCreateSchedule.mockResolvedValue({ success: false, error: { message: 'Name already taken' } });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleCreateSchedule(CREATE_VALUES));

      expect(result.current.createError).toBe('Name already taken');
      expect(result.current.showCreateModal).toBe(false); // never opened in this test — stays as initialized
      expect(loadData).not.toHaveBeenCalled();
    });

    it('surfaces a thrown ApiError message', async () => {
      mockCreateSchedule.mockRejectedValue(new ApiError('Conflict', 409, 'CONFLICT'));
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleCreateSchedule(CREATE_VALUES));

      expect(result.current.createError).toBe('Conflict');
    });

    it('falls back to a generic message for a non-ApiError throw', async () => {
      mockCreateSchedule.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleCreateSchedule(CREATE_VALUES));

      expect(result.current.createError).toBe('Failed to create schedule.');
    });
  });

  describe('handleGenerateSchedule', () => {
    it('refuses to submit with no schedule selected', async () => {
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.generateError).toBe('Select a schedule to generate.');
      expect(mockGenerateSchedule).not.toHaveBeenCalled();
    });

    it('sync path (no jobId): closes the modal and shows the optimal-outcome info banner', async () => {
      mockGenerateSchedule.mockResolvedValue({ success: true, data: { engine: 'or-tools', degraded: false } });
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(5));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.showGenerateModal).toBe(false);
      expect(result.current.info).toBe('Schedule generation completed with the optimal engine.');
      expect(result.current.error).toBeNull();
      expect(loadData).toHaveBeenCalled();
    });

    it('sync path, greedy engine: shows the greedy-outcome info banner (still not an error)', async () => {
      mockGenerateSchedule.mockResolvedValue({ success: true, data: { engine: 'greedy', degraded: false } });
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(5));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.info).toBe('Schedule generated with the greedy draft engine.');
      expect(result.current.error).toBeNull();
    });

    it('sync path, degraded: shows the draft warning in the page-level error banner, not info', async () => {
      mockGenerateSchedule.mockResolvedValue({
        success: true,
        data: { engine: 'greedy', degraded: true, degradedReason: 'OR-Tools unavailable' },
      });
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(5));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.error).toContain('DRAFT');
      expect(result.current.info).toBeNull();
    });

    it('API-level failure keeps the modal open and reports the message', async () => {
      mockGenerateSchedule.mockResolvedValue({ success: false, error: { message: 'No shifts to schedule' } });
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(5));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.generateError).toBe('No shifts to schedule');
      expect(result.current.showGenerateModal).toBe(true);
      expect(loadData).not.toHaveBeenCalled();
    });

    it('a thrown error surfaces as the generate error', async () => {
      mockGenerateSchedule.mockRejectedValue(new ApiError('Locked', 423, 'LOCKED'));
      const { result } = renderHook(() => useScheduleActions(loadData));
      act(() => result.current.openGenerateModal(5));

      await act(() => result.current.handleGenerateSchedule(formEvent()));

      expect(result.current.generateError).toBe('Locked');
    });

    describe('async path (job queued behind Redis)', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('polls until completed, then reports the outcome', async () => {
        mockGenerateSchedule.mockResolvedValue({ success: true, data: { jobId: 'job-1' } });
        mockGetOptimizationStatus
          .mockResolvedValueOnce({ data: { state: 'waiting' } })
          .mockResolvedValueOnce({ data: { state: 'active' } })
          .mockResolvedValueOnce({ data: { state: 'completed', result: { engine: 'or-tools', degraded: false } } });

        const { result } = renderHook(() => useScheduleActions(loadData));
        act(() => result.current.openGenerateModal(5));

        const submit = act(() => result.current.handleGenerateSchedule(formEvent()));
        // Three poll iterations, 2s apart.
        for (let i = 0; i < 3; i++) {
          await jest.advanceTimersByTimeAsync(2000);
        }
        await submit;

        expect(mockGetOptimizationStatus).toHaveBeenCalledTimes(3);
        expect(result.current.info).toBe('Schedule generation completed with the optimal engine.');
        expect(result.current.showGenerateModal).toBe(false);
      });

      it('a failed job reports the server-supplied reason as the generate error', async () => {
        mockGenerateSchedule.mockResolvedValue({ success: true, data: { jobId: 'job-2' } });
        mockGetOptimizationStatus.mockResolvedValueOnce({
          data: { state: 'failed', failedReason: 'Solver crashed' },
        });

        const { result } = renderHook(() => useScheduleActions(loadData));
        act(() => result.current.openGenerateModal(5));

        const submit = act(() => result.current.handleGenerateSchedule(formEvent()));
        await jest.advanceTimersByTimeAsync(2000);
        await submit;

        expect(result.current.generateError).toBe('Solver crashed');
        expect(result.current.showGenerateModal).toBe(true);
      });

      it('a job that never leaves the queue times out with a translated message', async () => {
        mockGenerateSchedule.mockResolvedValue({ success: true, data: { jobId: 'job-3' } });
        mockGetOptimizationStatus.mockResolvedValue({ data: { state: 'waiting' } });

        const { result } = renderHook(() => useScheduleActions(loadData));
        act(() => result.current.openGenerateModal(5));

        const submit = act(() => result.current.handleGenerateSchedule(formEvent()));
        // 150 attempts * 2s — advance past every poll so the loop exhausts.
        await jest.advanceTimersByTimeAsync(150 * 2000);
        await submit;

        expect(result.current.generateError).toBe('Optimization timed out.');
        expect(mockGetOptimizationStatus).toHaveBeenCalledTimes(150);
      });
    });
  });

  describe('handlePublish', () => {
    it('shows the success banner and reloads', async () => {
      mockPublishSchedule.mockResolvedValue({ success: true });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handlePublish(3));

      expect(result.current.info).toBe('Schedule published.');
      expect(loadData).toHaveBeenCalled();
    });

    it('surfaces an API-level failure', async () => {
      mockPublishSchedule.mockResolvedValue({ success: false, error: { message: 'Coverage gap on Monday' } });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handlePublish(3));

      expect(result.current.error).toBe('Coverage gap on Monday');
      expect(loadData).not.toHaveBeenCalled();
    });

    it('surfaces a thrown error', async () => {
      mockPublishSchedule.mockRejectedValue(new Error('network down'));
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handlePublish(3));

      expect(result.current.error).toBe('Failed to publish schedule.');
    });
  });

  describe('handleArchive', () => {
    it('shows the success banner and reloads', async () => {
      mockArchiveSchedule.mockResolvedValue({ success: true });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleArchive(3));

      expect(result.current.info).toBe('Schedule archived.');
      expect(loadData).toHaveBeenCalled();
    });

    it('surfaces an API-level failure', async () => {
      mockArchiveSchedule.mockResolvedValue({ success: false, error: { message: 'Already archived' } });
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleArchive(3));

      expect(result.current.error).toBe('Already archived');
    });

    it('surfaces a thrown ApiError message', async () => {
      mockArchiveSchedule.mockRejectedValue(new ApiError('Forbidden', 403, 'FORBIDDEN'));
      const { result } = renderHook(() => useScheduleActions(loadData));

      await act(() => result.current.handleArchive(3));

      expect(result.current.error).toBe('Forbidden');
    });
  });
});
