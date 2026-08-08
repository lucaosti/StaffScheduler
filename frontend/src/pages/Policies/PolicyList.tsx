/**
 * PolicyList — List of policies with create/toggle/delete actions.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Policy, PolicyScope } from '../../services/policyService';
import EmptyState from '../../components/EmptyState';

interface PolicyFormState {
  scopeType: PolicyScope;
  scopeId: string;
  policyKey: string;
  policyValue: string;
  description: string;
}

// Kept as identifiers (not JSX literals) so the option `value`s stay the raw
// enum the backend expects while the visible label goes through `t()`.
const POLICY_SCOPES: PolicyScope[] = ['global', 'org_unit', 'schedule', 'shift_template'];

const POLICY_SCOPE_LABEL_KEYS: Record<PolicyScope, string> = {
  global: 'policies.list.scopes.global',
  org_unit: 'policies.list.scopes.orgUnit',
  schedule: 'policies.list.scopes.schedule',
  shift_template: 'policies.list.scopes.shiftTemplate',
};

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
}) => {
  const { t } = useTranslation();
  return (
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
              {POLICY_SCOPES.map((scope) => (
                <option key={scope} value={scope}>
                  {t(POLICY_SCOPE_LABEL_KEYS[scope])}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-1">
            <input
              type="number"
              className="form-control"
              placeholder={t('policies.list.form.scopeIdPlaceholder')}
              value={policyForm.scopeId}
              onChange={(e) => onFormChange({ ...policyForm, scopeId: e.target.value })}
            />
          </div>
          <div className="col-md-3">
            <input
              className="form-control"
              placeholder={t('policies.list.form.policyKeyPlaceholder')}
              value={policyForm.policyKey}
              onChange={(e) => onFormChange({ ...policyForm, policyKey: e.target.value })}
              required
            />
          </div>
          <div className="col-md-3">
            <input
              className="form-control font-monospace"
              placeholder={t('policies.list.form.valueJsonPlaceholder')}
              value={policyForm.policyValue}
              onChange={(e) => onFormChange({ ...policyForm, policyValue: e.target.value })}
            />
          </div>
          <div className="col-md-2">
            <input
              className="form-control"
              placeholder={t('policies.list.form.descriptionPlaceholder')}
              value={policyForm.description}
              onChange={(e) => onFormChange({ ...policyForm, description: e.target.value })}
            />
          </div>
          <div className="col-md-1">
            <button className="btn btn-primary w-100" disabled={busy}>
              {t('policies.list.form.add')}
            </button>
          </div>
        </form>
      )}

      {policies.length === 0 ? (
        <EmptyState
          icon="bi-shield"
          title={t('policies.list.empty.title')}
          message={t('policies.list.empty.message')}
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{t('policies.list.columns.scope')}</th>
              <th scope="col">{t('policies.list.columns.key')}</th>
              <th scope="col">{t('policies.list.columns.value')}</th>
              <th scope="col">{t('policies.list.columns.owner')}</th>
              <th scope="col">{t('policies.list.columns.status')}</th>
              <th scope="col" className="text-end">{t('policies.list.columns.actions')}</th>
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
                    {p.isActive ? t('policies.list.status.active') : t('policies.list.status.inactive')}
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
                        {p.isActive ? t('policies.list.deactivate') : t('policies.list.activate')}
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => onDeletePolicy(p.id)}
                        disabled={busy}
                      >
                        {t('common.delete')}
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
};

export default PolicyList;
