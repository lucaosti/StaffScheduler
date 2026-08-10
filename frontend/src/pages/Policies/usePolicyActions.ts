/**
 * usePolicyActions — create/toggle/delete handlers, the create-policy form
 * state, and the compliance-preset apply flow. Extracted out of Policies.tsx;
 * the shared error banner and confirm modal stay owned by the page since
 * they are visible across all three tabs.
 *
 * @author Luca Ostinelli
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as policyService from '../../services/policyService';
import type { Policy, PolicyScope, CompliancePreset } from '../../services/policyService';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const EMPTY_POLICY_FORM = {
  scopeType: 'global' as PolicyScope,
  scopeId: '',
  policyKey: '',
  policyValue: '{}',
  description: '',
};

export function usePolicyActions(
  isManager: boolean,
  isAdmin: boolean,
  presets: CompliancePreset[],
  refresh: () => void,
  setError: (message: string | null) => void,
  setConfirm: (state: ConfirmState) => void
) {
  const { t } = useTranslation();
  const [policyForm, setPolicyForm] = useState(EMPTY_POLICY_FORM);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [busy, setBusy] = useState(false);

  const handleApplyPreset = () => {
    if (!selectedPreset) return;
    const preset = presets.find((p) => p.key === selectedPreset);
    const ruleCount = preset?.rules.length;
    setConfirm({
      show: true,
      title: t('policies.preset.title'),
      message: t('policies.preset.confirmMessage', {
        name: preset?.name ?? selectedPreset,
        count: ruleCount !== undefined ? String(ruleCount) : t('policies.preset.countFallback'),
        policyWord:
          ruleCount === 1 ? t('policies.preset.policySingular') : t('policies.preset.policyPlural'),
      }),
      onConfirm: async () => {
        setConfirm({ show: false, title: '', message: '', onConfirm: () => undefined });
        setBusy(true);
        setError(null);
        try {
          await policyService.applyPreset(selectedPreset);
          setSelectedPreset('');
          await refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleCreatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    setBusy(true);
    setError(null);
    try {
      let value: unknown = policyForm.policyValue;
      try {
        value = JSON.parse(policyForm.policyValue);
      } catch {
        // Keep as string if not valid JSON.
      }
      await policyService.createPolicy({
        scopeType: policyForm.scopeType,
        scopeId: policyForm.scopeId ? Number(policyForm.scopeId) : null,
        policyKey: policyForm.policyKey,
        policyValue: value,
        description: policyForm.description || null,
      });
      setPolicyForm(EMPTY_POLICY_FORM);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePolicyActive = async (p: Policy) => {
    setBusy(true);
    setError(null);
    try {
      await policyService.updatePolicy(p.id, { isActive: !p.isActive });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePolicy = (id: number) => {
    setConfirm({
      show: true,
      title: t('policies.deletePolicy.title'),
      message: t('policies.deletePolicy.message'),
      onConfirm: async () => {
        setConfirm({ show: false, title: '', message: '', onConfirm: () => undefined });
        setBusy(true);
        setError(null);
        try {
          await policyService.deletePolicy(id);
          await refresh();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const handleMatrixChange = async (
    row: policyService.ApprovalMatrixRow,
    patch: Partial<policyService.ApprovalMatrixRow>
  ) => {
    if (!isAdmin) return;
    setBusy(true);
    setError(null);
    try {
      await policyService.updateMatrix(row.changeType, {
        approverScope: patch.approverScope ?? row.approverScope,
        approverRoleId:
          patch.approverRoleId !== undefined ? patch.approverRoleId : row.approverRoleId,
        approverUserId:
          patch.approverUserId !== undefined ? patch.approverUserId : row.approverUserId,
        autoApproveForOwner:
          patch.autoApproveForOwner !== undefined
            ? patch.autoApproveForOwner
            : row.autoApproveForOwner,
        description: patch.description !== undefined ? patch.description : row.description,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    policyForm,
    setPolicyForm,
    selectedPreset,
    setSelectedPreset,
    busy,
    handleApplyPreset,
    handleCreatePolicy,
    handleTogglePolicyActive,
    handleDeletePolicy,
    handleMatrixChange,
  };
}
