/**
 * useScheduleActions — the create/generate/publish/archive flows for the
 * Schedule page: local modal + error state, the optimization-job polling
 * loop, and the mutating calls themselves. Extracted out of Schedule.tsx so
 * the page component is left with data wiring and layout.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as scheduleService from '../../services/scheduleService';
import { ApiError } from '../../services/apiUtils';
import type { CreateScheduleValues } from '../Schedule/CreateScheduleModal';

/**
 * The engine-provenance subset of an optimization result the UI cares about.
 * Enough to tell the user whether they got the optimum or a signalled draft.
 */
interface OptimizationOutcome {
  engine?: 'or-tools' | 'greedy';
  degraded?: boolean;
  degradedReason?: string;
}

export function useScheduleActions(loadData: () => Promise<unknown>) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | number | null>(null);

  const openCreateModal = () => {
    setCreateError(null);
    setShowCreateModal(true);
  };

  const openGenerateModal = (scheduleId: string | number | null) => {
    setGenerateError(null);
    setSelectedScheduleId(scheduleId);
    setShowGenerateModal(true);
  };

  // Values arrive already validated against the shared createScheduleBody schema
  // (the modal uses it via zodResolver), so this handler only performs the API
  // call and its async bookkeeping — no re-validation needed.
  const handleCreateSchedule = async (values: CreateScheduleValues) => {
    setCreateError(null);
    setIsCreating(true);
    try {
      const response = await scheduleService.createSchedule({
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        departmentId: values.departmentId,
        notes: values.notes,
      });
      if (response.success) {
        setShowCreateModal(false);
        setInfo(t('schedule.createdMessage', { name: values.name }));
        await loadData();
      } else {
        setCreateError(response.error?.message || t('schedule.createFailed'));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('schedule.createFailed');
      setCreateError(message);
    } finally {
      setIsCreating(false);
    }
  };

  // Polls the optimization job until it finishes. Bounded so a stuck job never
  // hangs the UI forever; the 2s interval keeps status requests light while
  // still feeling responsive. Throws on failure/timeout so the caller surfaces
  // an error; on the terminal 'completed' state it returns the job result so
  // the caller can tell the user which engine ran (optimal vs degraded draft).
  const waitForOptimization = async (
    scheduleId: number
  ): Promise<OptimizationOutcome | undefined> => {
    const POLL_MS = 2000;
    const MAX_ATTEMPTS = 150; // ~5 minutes, matching the solver time limit
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const status = await scheduleService.getOptimizationStatus(scheduleId);
      const state = status.data?.state;
      if (state === 'completed') return status.data?.result;
      if (state === 'failed') {
        // ApiError, not a plain Error: handleGenerateSchedule's catch only
        // trusts ApiError messages for display (a raw Error's message might
        // be an unhelpful JS runtime string), and the reason the job itself
        // reports is exactly the kind of safe, human-readable message that
        // trust is for.
        throw new ApiError(status.data?.failedReason || t('schedule.optimizationFailedDefault'));
      }
      // 'waiting' / 'active' / 'unknown' → keep polling.
    }
    throw new ApiError(t('schedule.optimizationTimedOut'));
  };

  // A completion message that makes the engine unmistakable: the optimal run is
  // reported plainly, a degraded run is flagged prominently as a draft so it is
  // never mistaken for the optimum (the whole point of the degraded signal).
  const describeOutcome = (outcome?: OptimizationOutcome): { message: string; degraded: boolean } => {
    if (outcome?.degraded) {
      const reason = outcome.degradedReason ? ` (${outcome.degradedReason})` : '';
      return {
        degraded: true,
        message: t('schedule.draftOutcome', { reason }),
      };
    }
    if (outcome?.engine === 'greedy') {
      return { degraded: false, message: t('schedule.greedyOutcome') };
    }
    return { degraded: false, message: t('schedule.optimalOutcome') };
  };

  const handleGenerateSchedule = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setGenerateError(null);

    if (!selectedScheduleId) {
      setGenerateError(t('schedule.selectScheduleRequired'));
      return;
    }

    setIsGenerating(true);
    try {
      const response = await scheduleService.generateSchedule(selectedScheduleId);
      if (!response.success) {
        setGenerateError(response.error?.message || t('schedule.generateFailed'));
        return;
      }

      // Async path: the backend queued the solve (202 { jobId }). Poll the job
      // status until it finishes, so the UI reflects the real result rather
      // than the "queued" acknowledgement. Sync path (no Redis): the result is
      // already present, so we skip polling.
      const data = response.data as ({ jobId?: string } & OptimizationOutcome) | undefined;
      const outcome = data?.jobId
        ? await waitForOptimization(Number(selectedScheduleId))
        : data;

      setShowGenerateModal(false);
      const { message, degraded } = describeOutcome(outcome);
      // Surface a degraded (draft) run in the prominent page-level alert so it
      // stays visible after the modal closes and is impossible to miss; an
      // optimal run uses the normal info banner.
      if (degraded) {
        setError(message);
      } else {
        setInfo(message);
      }
      await loadData();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('schedule.generateFailed');
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePublish = async (id: string | number) => {
    setError(null);
    setInfo(null);
    try {
      const response = await scheduleService.publishSchedule(id);
      if (response.success) {
        setInfo(t('schedule.publishSuccess'));
        await loadData();
      } else {
        setError(response.error?.message || t('schedule.publishFailed'));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('schedule.publishFailed');
      setError(message);
    }
  };

  const handleArchive = async (id: string | number) => {
    setError(null);
    setInfo(null);
    try {
      const response = await scheduleService.archiveSchedule(id);
      if (response.success) {
        setInfo(t('schedule.archiveSuccess'));
        await loadData();
      } else {
        setError(response.error?.message || t('schedule.archiveFailed'));
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('schedule.archiveFailed');
      setError(message);
    }
  };

  return {
    error,
    info,
    showCreateModal,
    showGenerateModal,
    createError,
    generateError,
    isCreating,
    isGenerating,
    selectedScheduleId,
    setSelectedScheduleId,
    openCreateModal,
    openGenerateModal,
    closeCreateModal: () => setShowCreateModal(false),
    closeGenerateModal: () => setShowGenerateModal(false),
    handleCreateSchedule,
    handleGenerateSchedule,
    handlePublish,
    handleArchive,
  };
}
