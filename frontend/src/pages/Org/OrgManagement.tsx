/**
 * Org management page.
 *
 * Provides three tabs:
 *   - Tree: admin views and edits the org tree (create / rename / set parent / set manager).
 *   - Members: list memberships of a selected unit and add / promote-to-primary / remove.
 *   - Loans: create a cross-department loan request, view the list, and act on pending ones.
 *
 * Auto-approval is enforced server-side via `approval_matrix`. The UI just
 * shows whatever `status` the backend returns.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import * as orgService from '../../services/orgService';
import type {
  OrgUnit,
  OrgUnitNode,
  UserOrgUnit,
  EmployeeLoan,
} from '../../services/orgService';

type Tab = 'tree' | 'members' | 'loans';

const OrgManagement: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'admin' || user?.role === 'manager';

  const [activeTab, setActiveTab] = useState<Tab>('tree');
  const [units, setUnits] = useState<OrgUnit[]>([]);
  const [tree, setTree] = useState<OrgUnitNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Tree form
  const [newUnit, setNewUnit] = useState<{ name: string; parentId: string; managerUserId: string }>(
    { name: '', parentId: '', managerUserId: '' }
  );

  // Members form
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [members, setMembers] = useState<UserOrgUnit[]>([]);
  const [memberForm, setMemberForm] = useState<{ userId: string; isPrimary: boolean }>({
    userId: '',
    isPrimary: false,
  });

  // Loans form + inbox
  const [loans, setLoans] = useState<EmployeeLoan[]>([]);
  const [loanForm, setLoanForm] = useState({
    userId: '',
    fromOrgUnitId: '',
    toOrgUnitId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });

  const refreshUnits = async () => {
    try {
      const [list, t] = await Promise.all([orgService.listUnits(), orgService.getTree()]);
      setUnits(list.data ?? []);
      setTree(t.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshMembers = async (unitId: number) => {
    try {
      const res = await orgService.listMembers(unitId);
      setMembers(res.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshLoans = async () => {
    try {
      const res = await orgService.listLoans();
      setLoans(res.data ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    refreshUnits();
    refreshLoans();
  }, []);

  useEffect(() => {
    if (selectedUnitId !== null) refreshMembers(selectedUnitId);
  }, [selectedUnitId]);

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

  const handleDeleteUnit = async (id: number) => {
    if (!isAdmin) return;
    if (!window.confirm('Delete this org unit?')) return;
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
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager || selectedUnitId === null) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.addMember(
        selectedUnitId,
        Number(memberForm.userId),
        memberForm.isPrimary
      );
      setMemberForm({ userId: '', isPrimary: false });
      await refreshMembers(selectedUnitId);
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
      await refreshMembers(selectedUnitId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!isManager || selectedUnitId === null) return;
    if (!window.confirm('Remove this member?')) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.removeMember(selectedUnitId, userId);
      await refreshMembers(selectedUnitId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCreateLoan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManager) return;
    setBusy(true);
    setError(null);
    try {
      await orgService.createLoan({
        userId: Number(loanForm.userId),
        fromOrgUnitId: Number(loanForm.fromOrgUnitId),
        toOrgUnitId: Number(loanForm.toOrgUnitId),
        startDate: loanForm.startDate,
        endDate: loanForm.endDate,
        reason: loanForm.reason || undefined,
      });
      setLoanForm({
        userId: '',
        fromOrgUnitId: '',
        toOrgUnitId: '',
        startDate: '',
        endDate: '',
        reason: '',
      });
      await refreshLoans();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleApproveLoan = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await orgService.approveLoan(id);
      await refreshLoans();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRejectLoan = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await orgService.rejectLoan(id);
      await refreshLoans();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCancelLoan = async (id: number) => {
    setBusy(true);
    setError(null);
    try {
      await orgService.cancelLoan(id);
      await refreshLoans();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderTree = (nodes: OrgUnitNode[], depth = 0): JSX.Element[] => {
    const out: JSX.Element[] = [];
    for (const n of nodes) {
      out.push(
        <tr key={n.id}>
          <td>
            <span style={{ paddingLeft: depth * 16 }}>
              <i className="bi bi-diagram-3 me-2" />
              {n.name}
            </span>
          </td>
          <td>{n.managerUserId ?? '-'}</td>
          <td>
            <span className={`badge ${n.isActive ? 'bg-success' : 'bg-secondary'}`}>
              {n.isActive ? 'active' : 'inactive'}
            </span>
          </td>
          <td className="text-end">
            <button
              className="btn btn-sm btn-outline-primary me-1"
              onClick={() => {
                setSelectedUnitId(n.id);
                setActiveTab('members');
              }}
            >
              Members
            </button>
            {isAdmin && (
              <button
                className="btn btn-sm btn-outline-danger"
                onClick={() => handleDeleteUnit(n.id)}
                disabled={busy}
              >
                Delete
              </button>
            )}
          </td>
        </tr>
      );
      if (n.children?.length) out.push(...renderTree(n.children, depth + 1));
    }
    return out;
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h3 mb-3">Organization</h1>

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
            className={`nav-link ${activeTab === 'tree' ? 'active' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            Tree
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            Members
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'loans' ? 'active' : ''}`}
            onClick={() => setActiveTab('loans')}
          >
            Loans
          </button>
        </li>
      </ul>

      {activeTab === 'tree' && (
        <div className="card">
          <div className="card-body">
            {isAdmin && (
              <form className="row g-2 mb-3" onSubmit={handleCreateUnit}>
                <div className="col-md-4">
                  <input
                    className="form-control"
                    placeholder="Unit name"
                    value={newUnit.name}
                    onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-3">
                  <select
                    className="form-select"
                    value={newUnit.parentId}
                    onChange={(e) => setNewUnit({ ...newUnit, parentId: e.target.value })}
                  >
                    <option value="">No parent (root)</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <input
                    type="number"
                    className="form-control"
                    placeholder="Manager user id"
                    value={newUnit.managerUserId}
                    onChange={(e) => setNewUnit({ ...newUnit, managerUserId: e.target.value })}
                  />
                </div>
                <div className="col-md-2">
                  <button className="btn btn-primary w-100" disabled={busy}>
                    Create
                  </button>
                </div>
              </form>
            )}
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Manager</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>{renderTree(tree)}</tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="card">
          <div className="card-body">
            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label">Org unit</label>
                <select
                  className="form-select"
                  value={selectedUnitId ?? ''}
                  onChange={(e) =>
                    setSelectedUnitId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Select…</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selectedUnitId !== null && (
              <>
                {isManager && (
                  <form className="row g-2 mb-3" onSubmit={handleAddMember}>
                    <div className="col-md-3">
                      <input
                        type="number"
                        className="form-control"
                        placeholder="User id"
                        value={memberForm.userId}
                        onChange={(e) =>
                          setMemberForm({ ...memberForm, userId: e.target.value })
                        }
                        required
                      />
                    </div>
                    <div className="col-md-3 d-flex align-items-center">
                      <div className="form-check">
                        <input
                          type="checkbox"
                          id="memberPrimary"
                          className="form-check-input"
                          checked={memberForm.isPrimary}
                          onChange={(e) =>
                            setMemberForm({ ...memberForm, isPrimary: e.target.checked })
                          }
                        />
                        <label className="form-check-label" htmlFor="memberPrimary">
                          Primary
                        </label>
                      </div>
                    </div>
                    <div className="col-md-2">
                      <button className="btn btn-primary w-100" disabled={busy}>
                        Add member
                      </button>
                    </div>
                  </form>
                )}
                <table className="table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Primary</th>
                      <th>Assigned</th>
                      <th className="text-end">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td>{m.userId}</td>
                        <td>
                          {m.isPrimary ? (
                            <span className="badge bg-primary">primary</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>{m.assignedAt}</td>
                        <td className="text-end">
                          {!m.isPrimary && isManager && (
                            <button
                              className="btn btn-sm btn-outline-primary me-1"
                              onClick={() => handleSetPrimary(m.userId)}
                              disabled={busy}
                            >
                              Make primary
                            </button>
                          )}
                          {isManager && (
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => handleRemoveMember(m.userId)}
                              disabled={busy}
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'loans' && (
        <div className="card">
          <div className="card-body">
            {isManager && (
              <form className="row g-2 mb-3" onSubmit={handleCreateLoan}>
                <div className="col-md-2">
                  <input
                    type="number"
                    className="form-control"
                    placeholder="User id"
                    value={loanForm.userId}
                    onChange={(e) => setLoanForm({ ...loanForm, userId: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    value={loanForm.fromOrgUnitId}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, fromOrgUnitId: e.target.value })
                    }
                    required
                  >
                    <option value="">From unit…</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <select
                    className="form-select"
                    value={loanForm.toOrgUnitId}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, toOrgUnitId: e.target.value })
                    }
                    required
                  >
                    <option value="">To unit…</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-2">
                  <input
                    type="date"
                    className="form-control"
                    value={loanForm.startDate}
                    onChange={(e) => setLoanForm({ ...loanForm, startDate: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-2">
                  <input
                    type="date"
                    className="form-control"
                    value={loanForm.endDate}
                    onChange={(e) => setLoanForm({ ...loanForm, endDate: e.target.value })}
                    required
                  />
                </div>
                <div className="col-md-2">
                  <button className="btn btn-primary w-100" disabled={busy}>
                    Request loan
                  </button>
                </div>
                <div className="col-12">
                  <input
                    className="form-control"
                    placeholder="Reason (optional)"
                    value={loanForm.reason}
                    onChange={(e) => setLoanForm({ ...loanForm, reason: e.target.value })}
                  />
                </div>
              </form>
            )}
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>From → To</th>
                  <th>Range</th>
                  <th>Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td>{l.userId}</td>
                    <td>
                      {l.fromOrgUnitId} → {l.toOrgUnitId}
                    </td>
                    <td>
                      {l.startDate} – {l.endDate}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          l.status === 'approved'
                            ? 'bg-success'
                            : l.status === 'pending'
                              ? 'bg-warning'
                              : 'bg-secondary'
                        }`}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="text-end">
                      {l.status === 'pending' && isManager && (
                        <>
                          <button
                            className="btn btn-sm btn-outline-success me-1"
                            onClick={() => handleApproveLoan(l.id)}
                            disabled={busy}
                          >
                            Approve
                          </button>
                          <button
                            className="btn btn-sm btn-outline-danger me-1"
                            onClick={() => handleRejectLoan(l.id)}
                            disabled={busy}
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {l.status === 'pending' && l.requestedBy === user?.id && (
                        <button
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => handleCancelLoan(l.id)}
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
    </div>
  );
};

export default OrgManagement;
