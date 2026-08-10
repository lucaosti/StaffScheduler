/**
 * useOrgTreeActions — create/delete handlers and form state for the org tree
 * tab. Extracted out of OrgManagement.tsx; the shared error banner, busy flag,
 * and delete-confirm modal stay owned by the page since they are visible
 * across all three tabs.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as orgService from '../../services/orgService';

interface NewUnitForm {
  name: string;
  parentId: string;
  managerUserId: string;
}

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export function useOrgTreeActions(
  isAdmin: boolean,
  refreshUnits: () => void,
  setError: (message: string | null) => void,
  setConfirm: (state: ConfirmState) => void
) {
  const { t } = useTranslation();
  const [newUnit, setNewUnit] = useState<NewUnitForm>({ name: '', parentId: '', managerUserId: '' });
  const [busy, setBusy] = useState(false);

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.createUnit({
        name: newUnit.name,
        parentId: newUnit.parentId ? Number(newUnit.parentId) : null,
        managerUserId: newUnit.managerUserId ? Number(newUnit.managerUserId) : null,
      });
      setNewUnit({ name: '', parentId: '', managerUserId: '' });
      await refreshUnits();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUnit = (id: number) => {
    if (!isAdmin) return;
    setConfirm({
      show: true,
      title: t('orgManagement.deleteUnit.title'),
      message: t('orgManagement.deleteUnit.message'),
      onConfirm: async () => {
        setConfirm({ show: false, title: '', message: '', onConfirm: () => undefined });
        setBusy(true);
        setError(null);
        try {
          await orgService.deleteUnit(id);
          await refreshUnits();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return { newUnit, setNewUnit, busy, handleCreateUnit, handleDeleteUnit };
}
