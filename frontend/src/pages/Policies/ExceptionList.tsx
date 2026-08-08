/**
 * ExceptionList — Policy exception requests with create/approve/reject/cancel.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Policy, PolicyExceptionRequest } from '../../services/policyService';
import EmptyState from '../../components/EmptyState';

interface ExceptionFormState {
  policyId: string;
  targetType: string;
  targetId: string;
  reason: string;
}

interface Props {
  exceptions: PolicyExceptionRequest[];
  policies: Policy[];
  busy: boolean;
  isManager: boolean;
  currentUserId: string | number | undefined;
  exceptionForm: ExceptionFormState;
  onFormChange: (v: ExceptionFormState) => void;
  onCreateException: (e: React.FormEvent) => void;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onCancel: (id: number) => void;
}

const ExceptionList: React.FC<Props> = ({
  exceptions,
  policies,
  busy,
  isManager,
  currentUserId,
  exceptionForm,
  onFormChange,
  onCreateException,
  onApprove,
  onReject,
  onCancel,
}) => {
  const { t } = useTranslation();
  const statusKeys: Record<string, string> = {
    approved: t('policies.exceptions.status.approved'),
    pending: t('policies.exceptions.status.pending'),
    rejected: t('policies.exceptions.status.rejected'),
    cancelled: t('policies.exceptions.status.cancelled'),
  };
  return (
  <div className="card">
    <div className="card-body">
      <form className="row g-2 mb-3" onSubmit={onCreateException}>
        <div className="col-md-3">
          <select
            className="form-select"
            value={exceptionForm.policyId}
            onChange={(e) => onFormChange({ ...exceptionForm, policyId: e.target.value })}
            required
          >
            <option value="">{t('policies.exceptions.form.pickPolicy')}</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                [{p.scopeType}] {p.policyKey} ({t('policies.exceptions.form.owner', { id: p.imposedByUserId })})
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-3">
          <input
            className="form-control"
            placeholder={t('policies.exceptions.form.targetTypePlaceholder')}
            value={exceptionForm.targetType}
            onChange={(e) => onFormChange({ ...exceptionForm, targetType: e.target.value })}
            required
          />
        </div>
        <div className="col-md-2">
          <input
            type="number"
            className="form-control"
            placeholder={t('policies.exceptions.form.targetIdPlaceholder')}
            value={exceptionForm.targetId}
            onChange={(e) => onFormChange({ ...exceptionForm, targetId: e.target.value })}
            required
          />
        </div>
        <div className="col-md-3">
          <input
            className="form-control"
            placeholder={t('policies.exceptions.form.reasonPlaceholder')}
            value={exceptionForm.reason}
            onChange={(e) => onFormChange({ ...exceptionForm, reason: e.target.value })}
          />
        </div>
        <div className="col-md-1">
          <button className="btn btn-primary w-100" disabled={busy}>
            {t('policies.exceptions.form.request')}
          </button>
        </div>
      </form>

      {exceptions.length === 0 ? (
        <EmptyState
          icon="bi-file-earmark-break"
          title={t('policies.exceptions.empty.title')}
          message={t('policies.exceptions.empty.message')}
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('policies.exceptions.columns.policy')}</th>
              <th scope="col">{t('policies.exceptions.columns.target')}</th>
              <th scope="col">{t('policies.exceptions.columns.requestedBy')}</th>
              <th scope="col">{t('policies.exceptions.columns.status')}</th>
              <th scope="col" className="text-end">{t('policies.exceptions.columns.actions')}</th>
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
                    {statusKeys[e.status] ?? e.status}
                  </span>
                </td>
                <td className="text-end">
                  {e.status === 'pending' && isManager && (
                    <>
                      <button
                        className="btn btn-sm btn-outline-success me-1"
                        onClick={() => onApprove(e.id)}
                        disabled={busy}
                      >
                        {t('policies.exceptions.approve')}
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger me-1"
                        onClick={() => onReject(e.id)}
                        disabled={busy}
                      >
                        {t('policies.exceptions.reject')}
                      </button>
                    </>
                  )}
                  {e.status === 'pending' && e.requestedByUserId === currentUserId && (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => onCancel(e.id)}
                      disabled={busy}
                    >
                      {t('policies.exceptions.cancel')}
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

export default ExceptionList;
