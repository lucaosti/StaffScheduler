/**
 * Delegations — manage temporary permission transfers to other users.
 *
 * Delegators can grant a subset of their own permissions to a delegate for
 * a bounded time window. All active delegations are visible here. Revoking
 * a delegation marks it inactive in the audit trail.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Delegation, CreateDelegationBody } from '../../services/delegationService';
import { useDelegationsQuery, useDelegationMutations } from '../../hooks/useDelegations';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import ButtonSpinner from '../../components/ButtonSpinner';

const EMPTY_FORM: CreateDelegationBody & { permissionInput: string } = {
  delegateeId: 0,
  permissionCodes: [],
  expiresAt: '',
  scopeOrgUnitId: null,
  justification: '',
  permissionInput: '',
};

const Delegations: React.FC = () => {
  const { t } = useTranslation();
  const delegationsQuery = useDelegationsQuery();
  const items = delegationsQuery.data ?? [];
  const loading = delegationsQuery.isLoading;
  const error = delegationsQuery.isError
    ? (delegationsQuery.error as Error).message ?? t('delegations.loadFailed')
    : null;
  const { create, revoke } = useDelegationMutations();

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [createError, setCreateError] = useState<string | null>(null);

  // Revoke modal
  const [revokeTarget, setRevokeTarget] = useState<Delegation | null>(null);
  const [revokeNote, setRevokeNote] = useState('');
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // ---------- Create ----------

  const addPermission = () => {
    const code = form.permissionInput.trim();
    if (!code || form.permissionCodes.includes(code)) return;
    setForm((f) => ({ ...f, permissionCodes: [...f.permissionCodes, code], permissionInput: '' }));
  };

  const removePermission = (code: string) => {
    setForm((f) => ({ ...f, permissionCodes: f.permissionCodes.filter((c) => c !== code) }));
  };

  const handleCreate = async () => {
    if (!form.delegateeId || form.delegateeId <= 0) { setCreateError(t('delegations.validation.delegateeRequired')); return; }
    if (form.permissionCodes.length === 0) { setCreateError(t('delegations.validation.permissionRequired')); return; }
    if (!form.expiresAt) { setCreateError(t('delegations.validation.expiryRequired')); return; }

    setCreateError(null);
    try {
      await create.mutateAsync({
        delegateeId: form.delegateeId,
        permissionCodes: form.permissionCodes,
        expiresAt: form.expiresAt,
        scopeOrgUnitId: form.scopeOrgUnitId ?? null,
        justification: form.justification?.trim() || null,
      });
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
    } catch (e) {
      setCreateError((e as Error).message ?? t('delegations.createFailed'));
    }
  };

  // ---------- Revoke ----------

  const openRevoke = (item: Delegation) => {
    setRevokeTarget(item);
    setRevokeNote('');
    setRevokeError(null);
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevokeError(null);
    try {
      await revoke.mutateAsync({ id: revokeTarget.id, justification: revokeNote.trim() || null });
      setRevokeTarget(null);
    } catch (e) {
      setRevokeError((e as Error).message ?? t('delegations.revokeFailed'));
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return t('common.emptyValue');
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('delegations.title')}</h1>
            <p className="text-muted mb-0 small">{t('delegations.subtitle')}</p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setForm({ ...EMPTY_FORM }); setCreateError(null); setShowCreate(true); }}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>{t('delegations.newDelegation')}
          </button>
        </div>
      </div>

      {error && <ErrorAlert message={error} onRetry={() => delegationsQuery.refetch()} />}

      <div className="card">
        <div className="card-body p-0">
          <QueryState
            isLoading={loading}
            isEmpty={items.length === 0}
            empty={
              <div className="text-center text-muted py-5">
                <i className="bi bi-people fs-3 d-block mb-2" aria-hidden="true"></i>
                {t('delegations.empty')}
              </div>
            }
          >
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">{t('delegations.columns.delegateeId')}</th>
                    <th scope="col">{t('delegations.columns.permissions')}</th>
                    <th scope="col">{t('delegations.columns.scopeOrgUnit')}</th>
                    <th scope="col">{t('delegations.columns.active')}</th>
                    <th scope="col">{t('delegations.columns.expires')}</th>
                    <th scope="col" className="text-end">{t('delegations.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="text-muted small">{item.id}</td>
                      <td className="small">{item.delegateeId}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {item.permissionCodes.map((code) => (
                            <span key={code} className="badge bg-primary-subtle text-primary small">{code}</span>
                          ))}
                        </div>
                      </td>
                      <td className="small text-muted">
                        {item.scopeOrgUnitId != null ? t('delegations.unitLabel', { id: item.scopeOrgUnitId }) : t('delegations.global')}
                      </td>
                      <td>
                        <span className={`badge ${item.isActive ? 'bg-success' : 'bg-secondary'}`}>
                          {item.isActive ? t('delegations.status.active') : t('delegations.status.inactive')}
                        </span>
                      </td>
                      <td className="small text-muted text-nowrap">{formatDate(item.expiresAt)}</td>
                      <td className="text-end">
                        {item.isActive && (
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => openRevoke(item)}
                            aria-label={t('delegations.revokeAriaLabel', { id: item.id })}
                          >
                            <i className="bi bi-x-circle me-1" aria-hidden="true"></i>{t('delegations.revoke')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('delegations.newDelegation')}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('delegations.newDelegation')}</h5>
                <button type="button" className="btn-close" aria-label={t('common.close')} onClick={() => setShowCreate(false)}></button>
              </div>
              <div className="modal-body">
                {createError && (
                  <div className="alert alert-danger py-2 small" role="alert">{createError}</div>
                )}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label htmlFor="delegDelegateeId" className="form-label">{t('delegations.form.delegateeId')} <span className="text-danger">*</span></label>
                    <input
                      id="delegDelegateeId"
                      type="number"
                      className="form-control"
                      min={1}
                      value={form.delegateeId || ''}
                      onChange={(e) => setForm((f) => ({ ...f, delegateeId: Number(e.target.value) }))}
                    />
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="delegExpiry" className="form-label">{t('delegations.form.expiresAt')} <span className="text-danger">*</span></label>
                    <input
                      id="delegExpiry"
                      type="datetime-local"
                      className="form-control"
                      value={form.expiresAt}
                      onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">{t('delegations.form.permissionCodes')} <span className="text-danger">*</span></label>
                    <div className="input-group">
                      <input
                        id="delegPermissionInput"
                        type="text"
                        className="form-control"
                        placeholder={t('delegations.form.permissionCodePlaceholder')}
                        value={form.permissionInput}
                        onChange={(e) => setForm((f) => ({ ...f, permissionInput: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPermission(); } }}
                        aria-label={t('delegations.form.permissionCodeInputAriaLabel')}
                      />
                      <button className="btn btn-outline-secondary" type="button" onClick={addPermission} aria-label={t('delegations.form.addPermissionAriaLabel')}>
                        {t('delegations.form.add')}
                      </button>
                    </div>
                    {form.permissionCodes.length > 0 && (
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {form.permissionCodes.map((code) => (
                          <span key={code} className="badge bg-primary d-flex align-items-center gap-1">
                            {code}
                            <button
                              type="button"
                              className="btn-close btn-close-white"
                              aria-label={t('delegations.form.removePermissionAriaLabel', { code })}
                              onClick={() => removePermission(code)}
                              style={{ fontSize: '0.55rem' }}
                            ></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="delegScopeOrgUnit" className="form-label">{t('delegations.form.scopeOrgUnitId')} <span className="text-muted small">{t('delegations.form.optional')}</span></label>
                    <input
                      id="delegScopeOrgUnit"
                      type="number"
                      className="form-control"
                      min={1}
                      placeholder={t('delegations.form.scopeOrgUnitPlaceholder')}
                      value={form.scopeOrgUnitId ?? ''}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        scopeOrgUnitId: e.target.value ? Number(e.target.value) : null,
                      }))}
                    />
                  </div>
                  <div className="col-12">
                    <label htmlFor="delegJustification" className="form-label">{t('delegations.form.justification')} <span className="text-muted small">{t('delegations.form.optional')}</span></label>
                    <textarea
                      id="delegJustification"
                      className="form-control"
                      rows={2}
                      value={form.justification ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                      placeholder={t('delegations.form.justificationPlaceholder')}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={create.isPending}
                  aria-label={t('delegations.form.submitAriaLabel')}
                >
                  {create.isPending ? (
                    <><ButtonSpinner />{t('delegations.saving')}</>
                  ) : t('delegations.create')}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}

      {/* Revoke Modal */}
      {revokeTarget && (
        <div
          className="modal d-block"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={t('delegations.revokeAriaLabel', { id: revokeTarget.id })}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('delegations.revokeTitle', { id: revokeTarget.id })}</h5>
                <button type="button" className="btn-close" aria-label={t('common.close')} onClick={() => setRevokeTarget(null)}></button>
              </div>
              <div className="modal-body">
                {revokeError && (
                  <div className="alert alert-danger py-2 small" role="alert">{revokeError}</div>
                )}
                <p className="small text-muted mb-3">
                  {t('delegations.revokeWarning')}
                </p>
                <div>
                  <label htmlFor="revokeNote" className="form-label">
                    {t('delegations.form.justification')} <span className="text-muted small">{t('delegations.form.optional')}</span>
                  </label>
                  <textarea
                    id="revokeNote"
                    className="form-control"
                    rows={3}
                    value={revokeNote}
                    onChange={(e) => setRevokeNote(e.target.value)}
                    placeholder={t('delegations.revokeReasonPlaceholder')}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRevokeTarget(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleRevoke}
                  disabled={revoke.isPending}
                  aria-label={t('delegations.confirmRevokeAriaLabel')}
                >
                  {revoke.isPending ? (
                    <><ButtonSpinner />{t('delegations.revoking')}</>
                  ) : t('delegations.revoke')}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}
    </div>
  );
};

export default Delegations;
