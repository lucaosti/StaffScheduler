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

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import * as orgService from '../../services/orgService';
import {
  orgKeys,
  useOrgUnitsQuery,
  useOrgUnitMembersQuery,
  useOrgLoansQuery,
} from '../../hooks/useOrg';
import OrgTree from '../orgManagement/OrgTree';
import MemberList from '../orgManagement/MemberList';
import ConfirmModal from '../../components/ConfirmModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';

type Tab = 'tree' | 'members' | 'loans';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const OrgManagement: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('org_unit.manage');
  const isManager =
    user?.permissions?.includes('org_unit.manage') ||
    user?.permissions?.includes('org_unit.read');

  const [activeTab, setActiveTab] = useState<Tab>('tree');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [confirm, setConfirm] = useState<ConfirmState>({
    show: false,
    title: '',
    message: '',
    onConfirm: () => undefined,
  });

  // Tree form
  const [newUnit, setNewUnit] = useState<{ name: string; parentId: string; managerUserId: string }>(
    { name: '', parentId: '', managerUserId: '' }
  );

  // Members form
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [memberForm, setMemberForm] = useState<{ userId: string; isPrimary: boolean }>({
    userId: '',
    isPrimary: false,
  });

  // Loans form
  const [loanForm, setLoanForm] = useState({
    userId: '',
    fromOrgUnitId: '',
    toOrgUnitId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });

  // Server state via TanStack Query. The mutation handlers below keep calling
  // refreshUnits/refreshMembers/refreshLoans, but those now invalidate the
  // relevant cache key (so a single edit refreshes exactly the affected data)
  // rather than re-fetching into local state by hand.
  const queryClient = useQueryClient();
  const unitsQuery = useOrgUnitsQuery();
  const loansQuery = useOrgLoansQuery();
  const membersQuery = useOrgUnitMembersQuery(selectedUnitId);

  const units = unitsQuery.data?.units ?? [];
  const tree = unitsQuery.data?.tree ?? [];
  const loans = loansQuery.data ?? [];
  const members = membersQuery.data ?? [];
  const loading = unitsQuery.isLoading || loansQuery.isLoading;

  const refreshUnits = () => queryClient.invalidateQueries({ queryKey: orgKeys.units });
  const refreshLoans = () => queryClient.invalidateQueries({ queryKey: orgKeys.loans });
  // The members query is keyed by the currently-selected unit, so invalidating
  // the whole family refreshes whichever unit is in view.
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['org', 'unit-members'] });

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
      title: 'Delete org unit',
      message: 'Are you sure you want to delete this org unit?',
      onConfirm: async () => {
        setConfirm((prev) => ({ ...prev, show: false }));
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
      title: 'Remove member',
      message: 'Are you sure you want to remove this member?',
      onConfirm: async () => {
        setConfirm((prev) => ({ ...prev, show: false }));
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

  if (loading) {
    return (
      <div className="container-fluid py-3">
        <LoadingSpinner message="Loading organization data..." />
      </div>
    );
  }

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
        <OrgTree
          units={units}
          tree={tree}
          busy={busy}
          canAdmin={!!isAdmin}
          newUnit={newUnit}
          onNewUnitChange={setNewUnit}
          onCreateUnit={handleCreateUnit}
          onDeleteUnit={handleDeleteUnit}
          onViewMembers={(id) => {
            setSelectedUnitId(id);
            setActiveTab('members');
          }}
        />
      )}

      {activeTab === 'members' && (
        <MemberList
          units={units}
          selectedUnitId={selectedUnitId}
          members={members}
          busy={busy}
          canManage={!!isManager}
          memberForm={memberForm}
          onUnitSelect={setSelectedUnitId}
          onMemberFormChange={setMemberForm}
          onAddMember={handleAddMember}
          onSetPrimary={handleSetPrimary}
          onRemoveMember={handleRemoveMember}
        />
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

            {loans.length === 0 ? (
              <EmptyState
                icon="bi-arrow-left-right"
                title="No loans"
                message="No employee loan requests yet."
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">User</th>
                    <th scope="col">From → To</th>
                    <th scope="col">Range</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-end">Actions</th>
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
                        {l.status === 'pending' && user !== null && l.requestedBy === Number(user.id) && (
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
            )}
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

export default OrgManagement;
