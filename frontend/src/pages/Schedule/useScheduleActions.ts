/**
 * useScheduleActions — the create/generate/publish/archive flows for the
 * Schedule page: local modal and banner state around the mutations in
 * `hooks/useSchedulePage`. Extracted out of Schedule.tsx so the page
 * component is left with data wiring and layout.
 *
 * Only UI state lives here. The calls, their pending flags, the optimization
 * polling and the cache invalidation are the mutations' (#844): this hook
 * used to keep its own `isCreating`/`isGenerating` flags and re-run a manual
 * reload that refreshed this page alone.
 *
 * @author Luca Ostinelli
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../services/apiUtils';
import {
  useFinishedOptimizationRefresh,
  useScheduleMutations,
  type OptimizationOutcome,
} from '../../hooks/useSchedulePage';
import type { CreateScheduleValues } from '../Schedule/CreateScheduleModal';

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/**
 * The message to show for a failed action. Only an ApiError's own text is
 * trusted for display (a raw Error's message may be an unhelpful runtime
 * string), and an empty one means the server gave none.
 */
const failureMessage = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.message ? err.message : fallback;

export function useScheduleActions() {
  const { t } = useTranslation();
  const mutations = useScheduleMutations();
  // Refreshes the views a job abandoned on a previous visit has since changed.
  useFinishedOptimizationRefresh();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | number | null>(null);

  // Optimization polling outlives a render but not the page: leaving it
  // aborts the poll instead of letting it run for up to five minutes against
  // an unmounted screen. The job itself keeps running server-side.
  const pollController = useRef<AbortController | null>(null);
  useEffect(() => () => pollController.current?.abort(), []);

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
  // (the modal uses it via zodResolver), so this handler only performs the call.
  const handleCreateSchedule = async (values: CreateScheduleValues) => {
    setCreateError(null);
    try {
      await mutations.create.mutateAsync({
        name: values.name,
        startDate: values.startDate,
        endDate: values.endDate,
        departmentId: values.departmentId,
        notes: values.notes,
      });
      setShowCreateModal(false);
      setInfo(t('schedule.createdMessage', { name: values.name }));
    } catch (err) {
      setCreateError(failureMessage(err, t('schedule.createFailed')));
    }
  };

  // A completion message that makes the engine unmistakable: the optimal run is
  // reported plainly, a degraded run is flagged prominently as a draft so it is
  // never mistaken for the optimum (the whole point of the degraded signal).
  const describeOutcome = (outcome?: OptimizationOutcome): { message: string; degraded: boolean } => {
    if (outcome?.degraded) {
      const reason = outcome.degradedReason ? ` (${outcome.degradedReason})` : '';
      return { degraded: true, message: t('schedule.draftOutcome', { reason }) };
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

    pollController.current?.abort();
    const controller = new AbortController();
    pollController.current = controller;
    try {
      const outcome = await mutations.generate.mutateAsync({
        scheduleId: selectedScheduleId,
        signal: controller.signal,
        messages: {
          failed: t('schedule.optimizationFailedDefault'),
          timedOut: t('schedule.optimizationTimedOut'),
        },
      });
      setShowGenerateModal(false);
      const { message, degraded } = describeOutcome(outcome);
      // Surface a degraded (draft) run in the prominent page-level alert so it
      // stays visible after the modal closes and is impossible to miss; an
      // optimal run uses the normal info banner.
      if (degraded) setError(message);
      else setInfo(message);
    } catch (err) {
      if (isAbort(err)) return; // the page went away; nobody to tell
      setGenerateError(failureMessage(err, t('schedule.generateFailed')));
    }
  };

  const runStatusChange = async (
    mutate: (id: string | number) => Promise<unknown>,
    id: string | number,
    successMessage: string,
    failedMessage: string
  ) => {
    setError(null);
    setInfo(null);
    try {
      await mutate(id);
      setInfo(successMessage);
    } catch (err) {
      setError(failureMessage(err, failedMessage));
    }
  };

  const handlePublish = (id: string | number) =>
    runStatusChange(mutations.publish.mutateAsync, id, t('schedule.publishSuccess'), t('schedule.publishFailed'));

  const handleArchive = (id: string | number) =>
    runStatusChange(mutations.archive.mutateAsync, id, t('schedule.archiveSuccess'), t('schedule.archiveFailed'));

  return {
    error,
    info,
    showCreateModal,
    showGenerateModal,
    createError,
    generateError,
    isCreating: mutations.create.isPending,
    isGenerating: mutations.generate.isPending,
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
