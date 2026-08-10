/**
 * useOrgMembersActions — add/promote/remove handlers and form state for the
 * org unit members tab. Extracted out of OrgManagement.tsx; the shared error
 * banner and remove-confirm modal stay owned by the page since they are
 * visible across all three tabs.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as orgService from '../../services/orgService';

interface MemberForm {
  userId: string;
  isPrimary: boolean;
}

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export function useOrgMembersActions(
  isManager: boolean,
  selectedUnitId: number | null,
  refreshMembers: () => void,
  setError: (message: string | null) => void,
  setConfirm: (state: ConfirmState) => void
) {
  const { t } = useTranslation();
  const [memberForm, setMemberForm] = useState<MemberForm>({ userId: '', isPrimary: false });
  const [busy, setBusy] = useState(false);

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager || selectedUnitId === null) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.addMember(selectedUnitId, Number(memberForm.userId), memberForm.isPrimary);
      setMemberForm({ userId: '', isPrimary: false });
      await refreshMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSetPrimary = async (userId: number) => {
    if (!isManager || selectedUnitId === null) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.setPrimaryMember(selectedUnitId, userId);
      await refreshMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = (userId: number) => {
    if (!isManager || selectedUnitId === null) return;
    setConfirm({
      show: true,
      title: t('orgManagement.removeMember.title'),
      message: t('orgManagement.removeMember.message'),
      onConfirm: async () => {
        setConfirm({ show: false, title: '', message: '', onConfirm: () => undefined });
        setBusy(true);
        setError(null);
        try {
          await orgService.removeMember(selectedUnitId!, userId);
          await refreshMembers();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return { memberForm, setMemberForm, busy, handleAddMember, handleSetPrimary, handleRemoveMember };
}
