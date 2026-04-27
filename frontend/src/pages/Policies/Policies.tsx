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

type Tab = 'policies' | 'exceptions' | 'matrix';

const Policies: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'admin' || user?.role === 'manager';

  const [activeTab, setActiveTab] = useState<Tab>('policies');
  const [error, setError] = useState<string | null>(null);
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

  const refresh = async () => {
    try {
      const [p, e, m] = await Promise.all([
        policyService.listPolicies(),
        policyService.listExceptions(),
        isAdmin ? policyService.listMatrix() : Promise.resolve({ data: [] as ApprovalMatrixRow[] }),
      ]);
      setPolicies(p.data ?? []);
      setExceptions(e.data ?? []);
      setMatrix(m.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    refresh();
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

  const handleDeletePolicy = async (id: number) => {
    if (!window.confirm('Delete this policy?')) return;
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
        <div className="card">
          <div className="card-body">
            {isManager && (
              <form className="row g-2 mb-3" onSubmit={handleCreatePolicy}>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    value={policyForm.scopeType}
                    onChange={(e) =>
                      setPolicyForm({
                        ...policyForm,
                        scopeType: e.target.value as PolicyScope,
                      })
                    }
                  >
                    <option value="global">global</option>
                    <option value="org_unit">org_unit</option>
                    <option value="schedule">schedule</option>
                    <option value="shift_template">shift_template</option>
                  </select>
                </div>
                <div className="col-md-1">
                  <input
                    type="number"
                    className="form-control"
                    placeholder="Scope id"
                    value={policyForm.scopeId}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, scopeId: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-3">
                  <input
                    className="form-control"
                    placeholder="policy key (e.g. min_rest_hours)"
                    value={policyForm.policyKey}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, policyKey: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="col-md-3">
                  <input
                    className="form-control font-monospace"
                    placeholder='value JSON, e.g. {"hours":11}'
                    value={policyForm.policyValue}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, policyValue: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-2">
                  <input
                    className="form-control"
                    placeholder="Description"
                    value={policyForm.description}
                    onChange={(e) =>
                      setPolicyForm({ ...policyForm, description: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-1">
                  <button className="btn btn-primary w-100" disabled={busy}>
                    Add
                  </button>
                </div>
              </form>
            )}

            <table className="table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.scopeType}
                      {p.scopeId !== null && `(${p.scopeId})`}
                    </td>
                    <td>{p.policyKey}</td>
                    <td className="font-monospace small">{JSON.stringify(p.policyValue)}</td>
                    <td>{p.imposedByUserId}</td>
                    <td>
                      <span className={`badge ${p.isActive ? 'bg-success' : 'bg-secondary'}`}>
                        {p.isActive ? 'active' : 'inactive'}
                      </span>
                    </td>
                    <td className="text-end">
                      {(p.imposedByUserId === user?.id || isAdmin) && (
                        <>
                          <button
                            className="btn btn-sm btn-outline-secondary me-1"
                            onClick={() => handleTogglePolicyActive(p)}
                            disabled={busy}
                          >
                            {p.isActive ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDeletePolicy(p.id)}
                            disabled={busy}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'exceptions' && (
        <div className="card">
          <div className="card-body">
            <form className="row g-2 mb-3" onSubmit={handleCreateException}>
              <div className="col-md-3">
                <select
                  className="form-select"
                  value={exceptionForm.policyId}
                  onChange={(e) =>
                    setExceptionForm({ ...exceptionForm, policyId: e.target.value })
                  }
                  required
                >
                  <option value="">Pick a policy…</option>
                  {policies.map((p) => (
                    <option key={p.id} value={p.id}>
                      [{p.scopeType}] {p.policyKey} (owner {p.imposedByUserId})
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-3">
                <input
                  className="form-control"
                  placeholder="Target type (e.g. shift_assignment)"
                  value={exceptionForm.targetType}
                  onChange={(e) =>
                    setExceptionForm({ ...exceptionForm, targetType: e.target.value })
                  }
                  required
                />
              </div>
              <div className="col-md-2">
                <input
                  type="number"
                  className="form-control"
                  placeholder="Target id"
                  value={exceptionForm.targetId}
                  onChange={(e) =>
                    setExceptionForm({ ...exceptionForm, targetId: e.target.value })
                  }
                  required
                />
              </div>
              <div className="col-md-3">
                <input
                  className="form-control"
                  placeholder="Reason"
                  value={exceptionForm.reason}
                  onChange={(e) =>
                    setExceptionForm({ ...exceptionForm, reason: e.target.value })
                  }
                />
              </div>
              <div className="col-md-1">
                <button className="btn btn-primary w-100" disabled={busy}>
                  Request
                </button>
              </div>
            </form>

            <table className="table">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Target</th>
                  <th>Requested by</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.id}>
                    <td>{e.policyId}</td>
                    <td>
                      {e.targetType}#{e.targetId}
                    </td>
                    <td>{e.requestedByUserId}</td>
                    <td>
                      <span
                        className={`badge ${
                          e.status === 'approved'
                            ? 'bg-success'
                            : e.status === 'pending'
                              ? 'bg-warning'
                              : 'bg-secondary'
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="text-end">
                      {e.status === 'pending' && isManager && (
                        <>
                          <button
                            className="btn btn-sm btn-outline-success me-1"
                            onClick={() => handleApproveException(e.id)}
                            disabled={busy}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger me-1"
                            onClick={() => handleRejectException(e.id)}
                            disabled={busy}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {e.status === 'pending' && e.requestedByUserId === user?.id && (
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => handleCancelException(e.id)}
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
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
                  <th>Change type</th>
                  <th>Approver scope</th>
                  <th>Role</th>
                  <th>User</th>
                  <th>Auto approve</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.id}>
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
                            approverRole:
                              (e.target.value as 'admin' | 'manager' | 'employee' | '') || null,
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
    </div>
  );
};

export default Policies;
