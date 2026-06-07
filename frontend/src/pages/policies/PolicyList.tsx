/**
 * PolicyList — List of policies with create/toggle/delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import type { Policy, PolicyScope } from '../../services/policyService';
import EmptyState from '../../components/EmptyState';

interface PolicyFormState {
  scopeType: PolicyScope;
  scopeId: string;
  policyKey: string;
  policyValue: string;
  description: string;
}

interface Props {
  policies: Policy[];
  busy: boolean;
  canManage: boolean;
  currentUserId: string | number | undefined;
  isAdmin: boolean;
  policyForm: PolicyFormState;
  onFormChange: (v: PolicyFormState) => void;
  onCreatePolicy: (e: React.FormEvent) => void;
  onToggleActive: (p: Policy) => void;
  onDeletePolicy: (id: number) => void;
}

const PolicyList: React.FC<Props> = ({
  policies,
  busy,
  canManage,
  currentUserId,
  isAdmin,
  policyForm,
  onFormChange,
  onCreatePolicy,
  onToggleActive,
  onDeletePolicy,
}) => (
  <div className="card">
    <div className="card-body">
      {canManage && (
        <form className="row g-2 mb-3" onSubmit={onCreatePolicy}>
          <div className="col-md-2">
            <select
              className="form-select"
              value={policyForm.scopeType}
              onChange={(e) =>
                onFormChange({ ...policyForm, scopeType: e.target.value as PolicyScope })
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
              onChange={(e) => onFormChange({ ...policyForm, scopeId: e.target.value })}
            />
          </div>
          <div className="col-md-3">
            <input
              className="form-control"
              placeholder="policy key (e.g. min_rest_hours)"
              value={policyForm.policyKey}
              onChange={(e) => onFormChange({ ...policyForm, policyKey: e.target.value })}
              required
            />
          </div>
          <div className="col-md-3">
            <input
              className="form-control font-monospace"
              placeholder='value JSON, e.g. {"hours":11}'
              value={policyForm.policyValue}
              onChange={(e) => onFormChange({ ...policyForm, policyValue: e.target.value })}
            />
          </div>
          <div className="col-md-2">
            <input
              className="form-control"
              placeholder="Description"
              value={policyForm.description}
              onChange={(e) => onFormChange({ ...policyForm, description: e.target.value })}
            />
          </div>
          <div className="col-md-1">
            <button className="btn btn-primary w-100" disabled={busy}>
              Add
            </button>
          </div>
        </form>
      )}

      {policies.length === 0 ? (
        <EmptyState icon="bi-shield" title="No policies" message="No policies configured yet." />
      ) : (
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
                  {(p.imposedByUserId === currentUserId || isAdmin) && (
                    <>
                      <button
                        className="btn btn-sm btn-outline-secondary me-1"
                        onClick={() => onToggleActive(p)}
                        disabled={busy}
                      >
                        {p.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => onDeletePolicy(p.id)}
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
      )}
    </div>
  </div>
);

export default PolicyList;
