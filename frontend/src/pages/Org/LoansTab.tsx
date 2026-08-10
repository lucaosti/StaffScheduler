/**
 * LoansTab — create a cross-department loan request, view the list, and act
 * on pending ones. Auto-approval is enforced server-side via
 * `approval_matrix`; this just shows whatever `status` the backend returns.
 * See OrgManagement.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OrgUnit } from '../../types';
import * as orgService from '../../services/orgService';
import type { EmployeeLoan } from '../../services/orgService';
import { useAuth } from '../../contexts/AuthContext';
import EmptyState from '../../components/EmptyState';

interface Props {
  units: OrgUnit[];
  loans: EmployeeLoan[];
  isManager: boolean;
  refreshLoans: () => void;
  setError: (message: string | null) => void;
}

const LoansTab: React.FC<Props> = ({ units, loans, isManager, refreshLoans, setError }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [loanForm, setLoanForm] = useState({
    userId: '',
    fromOrgUnitId: '',
    toOrgUnitId: '',
    startDate: '',
    endDate: '',
    reason: '',
  });

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
      setLoanForm({ userId: '', fromOrgUnitId: '', toOrgUnitId: '', startDate: '', endDate: '', reason: '' });
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

  return (
    <div className="card">
      <div className="card-body">
        {isManager && (
          <form className="row g-2 mb-3" onSubmit={handleCreateLoan}>
            <div className="col-md-2">
              <input
                type="number"
                className="form-control"
                placeholder={t('orgManagement.loans.userIdPlaceholder')}
                value={loanForm.userId}
                onChange={(e) => setLoanForm({ ...loanForm, userId: e.target.value })}
                required
              />
            </div>
            <div className="col-md-2">
              <select
                className="form-select"
                value={loanForm.fromOrgUnitId}
                onChange={(e) => setLoanForm({ ...loanForm, fromOrgUnitId: e.target.value })}
                required
              >
                <option value="">{t('orgManagement.loans.fromUnitPlaceholder')}</option>
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
                onChange={(e) => setLoanForm({ ...loanForm, toOrgUnitId: e.target.value })}
                required
              >
                <option value="">{t('orgManagement.loans.toUnitPlaceholder')}</option>
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
                {t('orgManagement.loans.requestLoan')}
              </button>
            </div>
            <div className="col-12">
              <input
                className="form-control"
                placeholder={t('orgManagement.loans.reasonPlaceholder')}
                value={loanForm.reason}
                onChange={(e) => setLoanForm({ ...loanForm, reason: e.target.value })}
              />
            </div>
          </form>
        )}

        {loans.length === 0 ? (
          <EmptyState
            icon="bi-arrow-left-right"
            title={t('orgManagement.loans.emptyTitle')}
            message={t('orgManagement.loans.emptyMessage')}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t('orgManagement.loans.columns.user')}</th>
                <th scope="col">{t('orgManagement.loans.columns.fromTo')}</th>
                <th scope="col">{t('orgManagement.loans.columns.range')}</th>
                <th scope="col">{t('orgManagement.loans.columns.status')}</th>
                <th scope="col" className="text-end">{t('orgManagement.loans.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id}>
                  <td>{l.userId}</td>
                  <td>
                    {t('orgManagement.loans.fromToValue', { from: l.fromOrgUnitId, to: l.toOrgUnitId })}
                  </td>
                  <td>
                    {t('common.timeRange', { start: l.startDate, end: l.endDate })}
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
                          {t('orgManagement.loans.approve')}
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger me-1"
                          onClick={() => handleRejectLoan(l.id)}
                          disabled={busy}
                        >
                          {t('orgManagement.loans.reject')}
                        </button>
                      </>
                    )}
                    {l.status === 'pending' && user !== null && l.requestedBy === Number(user.id) && (
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => handleCancelLoan(l.id)}
                        disabled={busy}
                      >
                        {t('orgManagement.loans.cancel')}
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
  );
};

export default LoansTab;
