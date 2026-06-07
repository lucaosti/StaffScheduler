/**
 * ExceptionList — Policy exception requests with create/approve/reject/cancel.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
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
}) => (
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
            onChange={(e) => onFormChange({ ...exceptionForm, targetType: e.target.value })}
            required
          />
        </div>
        <div className="col-md-2">
          <input
            type="number"
            className="form-control"
            placeholder="Target id"
            value={exceptionForm.targetId}
            onChange={(e) => onFormChange({ ...exceptionForm, targetId: e.target.value })}
            required
          />
        </div>
        <div className="col-md-3">
          <input
            className="form-control"
            placeholder="Reason"
            value={exceptionForm.reason}
            onChange={(e) => onFormChange({ ...exceptionForm, reason: e.target.value })}
          />
        </div>
        <div className="col-md-1">
          <button className="btn btn-primary w-100" disabled={busy}>
            Request
          </button>
        </div>
      </form>

      {exceptions.length === 0 ? (
        <EmptyState
          icon="bi-file-earmark-break"
          title="No exceptions"
          message="No exception requests yet."
        />
      ) : (
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
                        onClick={() => onApprove(e.id)}
                        disabled={busy}
                      >
                        Approve
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger me-1"
                        onClick={() => onReject(e.id)}
                        disabled={busy}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {e.status === 'pending' && e.requestedByUserId === currentUserId && (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => onCancel(e.id)}
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
);

export default ExceptionList;
