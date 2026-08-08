/**
 * Policies management page.
 *
 * Three tabs:
 *   - Policies: create / list / deactivate policies (managers + admins).
 *   - Exceptions: filterable inbox of derogations; managers can approve/reject,
 *     requesters can cancel pending ones.
 *   - Approval matrix (admin-only): tweak which scope approves which change type
 *     and toggle the auto-approve-for-owner shortcut.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import * as policyService from '../../services/policyService';
import type { Policy, ApprovalMatrixRow, PolicyScope } from '../../services/policyService';
import { policiesKey, usePoliciesPageData } from '../../hooks/usePolicies';
import PolicyList from '../Policies/PolicyList';
import ExceptionList from '../Policies/ExceptionList';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';

type Tab = 'policies' | 'exceptions' | 'matrix';

// Kept as identifiers (not JSX literals) so the option `value`s stay the raw
// enum the backend expects while the visible label goes through `t()`.
const MATRIX_SCOPES: ApprovalMatrixRow['approverScope'][] = [
  'policy_owner',
  'unit_manager',
  'unit_manager_chain',
  'company_role',
  'company_user',
];

const MATRIX_SCOPE_LABEL_KEYS: Record<ApprovalMatrixRow['approverScope'], string> = {
  policy_owner: 'policies.matrix.scopes.policyOwner',
  unit_manager: 'policies.matrix.scopes.unitManager',
  unit_manager_chain: 'policies.matrix.scopes.unitManagerChain',
  company_role: 'policies.matrix.scopes.companyRole',
  company_user: 'policies.matrix.scopes.companyUser',
};

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const Policies: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('policy.manage');
  const isManager =
    user?.permissions?.includes('policy.manage') ||
    user?.permissions?.includes('policy.read');

  const [activeTab, setActiveTab] = useState<Tab>('policies');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  const [policyForm, setPolicyForm] = useState({
    scopeType: 'global' as PolicyScope,
    scopeId: '',
    policyKey: '',
    policyValue: '{}',
    description: '',
  });

  const [exceptionForm, setExceptionForm] = useState({
    policyId: '',
    targetType: 'shift_assignment',
    targetId: '',
    reason: '',
  });

  const [confirm, setConfirm] = useState<ConfirmState>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => undefined,
  });

  // Server state via one composite query; mutation handlers keep calling
  // refresh(), which now invalidates the cached page data so all four lists
  // reload together as before.
  const pageQuery = usePoliciesPageData(!!isAdmin);
  const policies = pageQuery.data?.policies ?? [];
  const exceptions = pageQuery.data?.exceptions ?? [];
  const matrix = pageQuery.data?.matrix ?? [];
  const roles = pageQuery.data?.roles ?? [];
  const presets = pageQuery.data?.presets ?? [];
  const loading = pageQuery.isLoading;
  const refresh = () => queryClient.invalidateQueries({ queryKey: policiesKey });

  const [selectedPreset, setSelectedPreset] = useState('');

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
        setConfirm((prev) => ({ ...prev, show: false }));
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
      setPolicyForm({
        scopeType: 'global',
        scopeId: '',
        policyKey: '',
        policyValue: '{}',
        description: '',
      });
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
        setConfirm((prev) => ({ ...prev, show: false }));
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
      setExceptionForm({ policyId: '', targetType: 'shift_assignment', targetId: '', reason: '' });
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

  const handleMatrixChange = async (
    row: ApprovalMatrixRow,
    patch: Partial<ApprovalMatrixRow>
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

  if (loading) {
    return (
      <div className="container-fluid py-3">
        <LoadingSpinner message={t('policies.loading')} />
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <h1 className="h3 mb-3">{t('policies.title')}</h1>

      {error && (
        <div className="alert alert-danger alert-dismissible" role="alert">
          {error}
          <button
            type="button"
            className="btn-close"
            aria-label={t('common.close')}
            onClick={() => setError(null)}
          />
        </div>
      )}

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
          >
            {t('policies.tabs.policies')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'exceptions' ? 'active' : ''}`}
            onClick={() => setActiveTab('exceptions')}
          >
            {t('policies.tabs.exceptions')}
          </button>
        </li>
        {isAdmin && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              {t('policies.tabs.matrix')}
            </button>
          </li>
        )}
      </ul>

      {activeTab === 'policies' && isAdmin && presets.length > 0 && (
        <div className="card mb-3">
          <div className="card-body d-flex align-items-center gap-2">
            <label className="form-label mb-0 me-2" htmlFor="compliance-preset-select">
              {t('policies.preset.title')}
            </label>
            <select
              id="compliance-preset-select"
              className="form-select form-select-sm w-auto"
              value={selectedPreset}
              onChange={(e) => setSelectedPreset(e.target.value)}
              disabled={busy}
            >
              <option value="">{t('policies.preset.choose')}</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              disabled={busy || !selectedPreset}
              onClick={handleApplyPreset}
            >
              {t('policies.preset.load')}
            </button>
            {selectedPreset && (
              <span className="text-muted small">
                {presets.find((p) => p.key === selectedPreset)?.description}
              </span>
            )}
          </div>
        </div>
      )}

      {activeTab === 'policies' && (
        <PolicyList
          policies={policies}
          busy={busy}
          canManage={!!isManager}
          currentUserId={user?.id}
          isAdmin={!!isAdmin}
          policyForm={policyForm}
          onFormChange={setPolicyForm}
          onCreatePolicy={handleCreatePolicy}
          onToggleActive={handleTogglePolicyActive}
          onDeletePolicy={handleDeletePolicy}
        />
      )}

      {activeTab === 'exceptions' && (
        <ExceptionList
          exceptions={exceptions}
          policies={policies}
          busy={busy}
          isManager={!!isManager}
          currentUserId={user?.id}
          exceptionForm={exceptionForm}
          onFormChange={setExceptionForm}
          onCreateException={handleCreateException}
          onApprove={handleApproveException}
          onReject={handleRejectException}
          onCancel={handleCancelException}
        />
      )}

      {activeTab === 'matrix' && isAdmin && (
        <div className="card">
          <div className="card-body">
            <p className="text-muted">
              {t('policies.matrix.description')}
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">{t('policies.matrix.columns.changeType')}</th>
                  <th scope="col">{t('policies.matrix.columns.approverScope')}</th>
                  <th scope="col">{t('policies.matrix.columns.role')}</th>
                  <th scope="col">{t('policies.matrix.columns.user')}</th>
                  <th scope="col">{t('policies.matrix.columns.autoApprove')}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.changeType}>
                    <td>{row.changeType}</td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.approverScope}
                        onChange={(e) =>
                          handleMatrixChange(row, {
                            approverScope: e.target.value as ApprovalMatrixRow['approverScope'],
                          })
                        }
                        disabled={busy}
                      >
                        {MATRIX_SCOPES.map((scope) => (
                          <option key={scope} value={scope}>
                            {t(MATRIX_SCOPE_LABEL_KEYS[scope])}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.approverRoleId ?? ''}
                        onChange={(e) =>
                          handleMatrixChange(row, {
                            approverRoleId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={busy}
                      >
                        <option value="">{t('common.emptyValue')}</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={row.approverUserId ?? ''}
                        onChange={(e) =>
                          handleMatrixChange(row, {
                            approverUserId: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        disabled={busy}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        className="form-check-input"
                        checked={row.autoApproveForOwner}
                        onChange={(e) =>
                          handleMatrixChange(row, { autoApproveForOwner: e.target.checked })
                        }
                        disabled={busy}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        show={confirm.show}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default Policies;
