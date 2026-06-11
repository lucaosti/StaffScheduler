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

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import * as policyService from '../../services/policyService';
import type {
  Policy,
  PolicyExceptionRequest,
  ApprovalMatrixRow,
  PolicyScope,
} from '../../services/policyService';
import PolicyList from '../Policies/PolicyList';
import ExceptionList from '../Policies/ExceptionList';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';

type Tab = 'policies' | 'exceptions' | 'matrix';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const Policies: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('policy.admin');
  const isManager =
    user?.permissions?.includes('policy.admin') ||
    user?.permissions?.includes('policy.manage');

  const [activeTab, setActiveTab] = useState<Tab>('policies');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [exceptions, setExceptions] = useState<PolicyExceptionRequest[]>([]);
  const [matrix, setMatrix] = useState<ApprovalMatrixRow[]>([]);

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

  const refresh = async () => {
    try {
      const [p, e, m] = await Promise.all([
        policyService.listPolicies(),
        policyService.listExceptions(),
        isAdmin
          ? policyService.listMatrix()
          : Promise.resolve({ success: true as const, data: [] as ApprovalMatrixRow[] }),
      ]);
      setPolicies(p.data ?? []);
      setExceptions(e.data ?? []);
      setMatrix(m.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      title: 'Delete policy',
      message: 'Are you sure you want to delete this policy?',
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
        approverRole: patch.approverRole !== undefined ? patch.approverRole : row.approverRole,
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
        <LoadingSpinner message="Loading policies..." />
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <h1 className="h3 mb-3">Policies & exceptions</h1>

      {error && (
        <div className="alert alert-danger alert-dismissible" role="alert">
          {error}
          <button
            type="button"
            className="btn-close"
            aria-label="Close"
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
            Policies
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'exceptions' ? 'active' : ''}`}
            onClick={() => setActiveTab('exceptions')}
          >
            Exceptions
          </button>
        </li>
        {isAdmin && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              Approval matrix
            </button>
          </li>
        )}
      </ul>

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
              Each row defines who must approve a given change type. Auto-approve fires when the
              actor is the resolved approver and the flag is on.
            </p>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Change type</th>
                  <th scope="col">Approver scope</th>
                  <th scope="col">Role</th>
                  <th scope="col">User</th>
                  <th scope="col">Auto approve</th>
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
                        <option value="policy_owner">policy_owner</option>
                        <option value="unit_manager">unit_manager</option>
                        <option value="unit_manager_chain">unit_manager_chain</option>
                        <option value="company_role">company_role</option>
                        <option value="company_user">company_user</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.approverRole ?? ''}
                        onChange={(e) =>
                          handleMatrixChange(row, {
                            approverRole: e.target.value || null,
                          })
                        }
                        disabled={busy}
                      >
                        <option value="">-</option>
                        <option value="admin">admin</option>
                        <option value="manager">manager</option>
                        <option value="employee">employee</option>
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
