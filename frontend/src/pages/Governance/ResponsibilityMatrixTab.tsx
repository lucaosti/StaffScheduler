/**
 * ResponsibilityMatrixTab — configure who is responsible for what over which
 * subject group. Visible to users with `responsibility.read`; editable by
 * users with `responsibility.manage`. See Governance.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ResponsibilityRule,
  CreateResponsibilityRuleInput,
  ResponsibilitySubjectType,
} from '../../services/responsibilityService';
import {
  useResponsibilityRulesQuery,
  useResponsibilityRuleMutations,
} from '../../hooks/useGovernance';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import QueryState from '../../components/QueryState';

const SUBJECT_TYPE_LABEL_KEYS: Record<ResponsibilitySubjectType, string> = {
  org_unit: 'governance.subjectTypes.orgUnit',
  department: 'governance.subjectTypes.department',
  role: 'governance.subjectTypes.role',
  all: 'governance.subjectTypes.all',
};

interface Props {
  canManage: boolean;
}

const ResponsibilityMatrixTab: React.FC<Props> = ({ canManage }) => {
  const { t } = useTranslation();
  const { message, setMessage, run: act } = useActionFeedback();

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<CreateResponsibilityRuleInput>({
    subjectType: 'department',
    permissionCode: '',
    responsibleOrgUnitId: 0,
  });

  // Rules load as soon as this tab mounts (Governance.tsx only mounts it while
  // the matrix tab is open and the user can read it); the mutations below
  // invalidate the cached query on success, so the list refreshes itself.
  const rulesQuery = useResponsibilityRulesQuery(true);
  const rules = rulesQuery.data ?? [];
  const { create: createRule, update: updateRule, remove: removeRule } = useResponsibilityRuleMutations();
  const busy = createRule.isPending || updateRule.isPending || removeRule.isPending;

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleForm.permissionCode || !ruleForm.responsibleOrgUnitId) return;
    await act(
      createRule.mutateAsync(ruleForm).then(() => {
        setShowRuleForm(false);
        setRuleForm({ subjectType: 'department', permissionCode: '', responsibleOrgUnitId: 0 });
      })
    );
  };

  const handleToggleRule = (rule: ResponsibilityRule) =>
    act(updateRule.mutateAsync({ id: rule.id, isActive: !rule.isActive }));

  const handleDeleteRule = (id: number) => {
    if (!window.confirm(t('governance.matrix.confirmDelete'))) return;
    return act(removeRule.mutateAsync(id));
  };

  return (
    <div>
      {message && (
        <div className="alert alert-danger alert-dismissible">
          {message}
          <button className="btn-close" onClick={() => setMessage(null)} />
        </div>
      )}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">{t('governance.matrix.activeRules')}</h5>
        {canManage && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowRuleForm(!showRuleForm)}>
            <i className="bi bi-plus-lg me-1" />
            {t('governance.matrix.addRule')}
          </button>
        )}
      </div>

      {showRuleForm && canManage && (
        <div className="card mb-4">
          <div className="card-body">
            <h6 className="card-title">{t('governance.matrix.newRuleTitle')}</h6>
            <form onSubmit={handleCreateRule}>
              <div className="row g-3">
                <div className="col-md-3">
                  <label className="form-label">{t('governance.matrix.form.subjectType')}</label>
                  <select
                    className="form-select"
                    value={ruleForm.subjectType}
                    onChange={e => setRuleForm(f => ({ ...f, subjectType: e.target.value as ResponsibilitySubjectType, subjectId: undefined }))}
                  >
                    {(Object.keys(SUBJECT_TYPE_LABEL_KEYS) as ResponsibilitySubjectType[]).map((v) => (
                      <option key={v} value={v}>{t(SUBJECT_TYPE_LABEL_KEYS[v])}</option>
                    ))}
                  </select>
                </div>
                {ruleForm.subjectType !== 'all' && (
                  <div className="col-md-2">
                    <label className="form-label">{t('governance.matrix.form.subjectId')}</label>
                    <input
                      type="number"
                      className="form-control"
                      placeholder={t('governance.matrix.form.subjectIdPlaceholder')}
                      value={ruleForm.subjectId ?? ''}
                      onChange={e => setRuleForm(f => ({ ...f, subjectId: e.target.value ? Number(e.target.value) : undefined }))}
                    />
                  </div>
                )}
                <div className="col-md-3">
                  <label className="form-label">{t('governance.matrix.form.permissionCode')}</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={t('governance.matrix.form.permissionCodePlaceholder')}
                    value={ruleForm.permissionCode}
                    onChange={e => setRuleForm(f => ({ ...f, permissionCode: e.target.value }))}
                    required
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label">{t('governance.matrix.form.responsibleOrgUnitId')}</label>
                  <input
                    type="number"
                    className="form-control"
                    placeholder={t('governance.matrix.form.responsibleOrgUnitIdPlaceholder')}
                    value={ruleForm.responsibleOrgUnitId || ''}
                    onChange={e => setRuleForm(f => ({ ...f, responsibleOrgUnitId: Number(e.target.value) }))}
                    required
                  />
                </div>
                <div className="col-md-2">
                  <label className="form-label">{t('governance.matrix.form.description')}</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder={t('governance.matrix.form.descriptionPlaceholder')}
                    value={ruleForm.description ?? ''}
                    onChange={e => setRuleForm(f => ({ ...f, description: e.target.value || null }))}
                  />
                </div>
              </div>
              <div className="mt-3 d-flex gap-2">
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  {busy ? t('governance.matrix.saving') : t('governance.matrix.saveRule')}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowRuleForm(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <QueryState
        isLoading={rulesQuery.isLoading}
        isError={rulesQuery.isError}
        error={rulesQuery.error}
        onRetry={() => rulesQuery.refetch()}
        isEmpty={rules.length === 0}
        empty={<p className="text-muted text-center py-4 mb-0">{t('governance.matrix.noRules')}</p>}
      >
        <div className="table-responsive">
          <table className="table table-hover">
            <thead>
              <tr>
                <th>{t('governance.matrix.columns.subjectType')}</th>
                <th>{t('governance.matrix.columns.subjectId')}</th>
                <th>{t('governance.matrix.columns.permission')}</th>
                <th>{t('governance.matrix.columns.responsibleOrgUnit')}</th>
                <th>{t('governance.matrix.columns.description')}</th>
                <th>{t('governance.matrix.columns.status')}</th>
                {canManage && <th>{t('governance.matrix.columns.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.id}>
                  <td><span className="badge bg-secondary">{t(SUBJECT_TYPE_LABEL_KEYS[rule.subjectType])}</span></td>
                  <td>{rule.subjectId ?? <em className="text-muted">{t('common.emptyValue')}</em>}</td>
                  <td><code>{rule.permissionCode}</code></td>
                  <td>{rule.responsibleOrgUnitId}</td>
                  <td>{rule.description ?? <em className="text-muted">{t('common.emptyValue')}</em>}</td>
                  <td>
                    <span className={`badge ${rule.isActive ? 'bg-success' : 'bg-secondary'}`}>
                      {rule.isActive ? t('governance.matrix.status.active') : t('governance.matrix.status.inactive')}
                    </span>
                  </td>
                  {canManage && (
                    <td>
                      <button
                        className="btn btn-sm btn-outline-secondary me-1"
                        onClick={() => handleToggleRule(rule)}
                        disabled={busy}
                        title={rule.isActive ? t('governance.matrix.deactivate') : t('governance.matrix.activate')}
                      >
                        <i className={`bi ${rule.isActive ? 'bi-toggle-on' : 'bi-toggle-off'}`} />
                      </button>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={busy}
                        title={t('common.delete')}
                      >
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
};

export default ResponsibilityMatrixTab;
