/**
 * useExceptionActions — create/approve/reject/cancel handlers and the
 * create-exception form state. Extracted out of Policies.tsx; the shared
 * error banner stays owned by the page since it is visible across all tabs.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import * as policyService from '../../services/policyService';

const EMPTY_EXCEPTION_FORM = {
  policyId: '',
  targetType: 'shift_assignment',
  targetId: '',
  reason: '',
};

export function useExceptionActions(refresh: () => void, setError: (message: string | null) => void) {
  const [exceptionForm, setExceptionForm] = useState(EMPTY_EXCEPTION_FORM);
  const [busy, setBusy] = useState(false);

  const handleCreateException = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await policyService.createException({
        policyId: Number(exceptionForm.policyId),
        targetType: exceptionForm.targetType,
        targetId: Number(exceptionForm.targetId),
        reason: exceptionForm.reason || null,
      });
      setExceptionForm(EMPTY_EXCEPTION_FORM);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveException = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await policyService.approveException(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRejectException = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await policyService.rejectException(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelException = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await policyService.cancelException(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    exceptionForm,
    setExceptionForm,
    busy,
    handleCreateException,
    handleApproveException,
    handleRejectException,
    handleCancelException,
  };
}
