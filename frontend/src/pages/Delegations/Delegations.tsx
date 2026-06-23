/**
 * Delegations — manage temporary permission transfers to other users.
 *
 * Delegators can grant a subset of their own permissions to a delegate for
 * a bounded time window. All active delegations are visible here. Revoking
 * a delegation marks it inactive in the audit trail.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  listDelegations,
  createDelegation,
  revokeDelegation,
  Delegation,
  CreateDelegationBody,
} from '../../services/delegationService';

const EMPTY_FORM: CreateDelegationBody & { permissionInput: string } = {
  delegateeId: 0,
  permissionCodes: [],
  expiresAt: '',
  scopeOrgUnitId: null,
  justification: '',
  permissionInput: '',
};

const Delegations: React.FC = () => {
  const [items, setItems] = useState<Delegation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Revoke modal
  const [revokeTarget, setRevokeTarget] = useState<Delegation | null>(null);
  const [revokeNote, setRevokeNote] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDelegations();
      setItems(res.data ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load delegations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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
    if (!form.delegateeId || form.delegateeId <= 0) { setCreateError('Delegatee user ID is required.'); return; }
    if (form.permissionCodes.length === 0) { setCreateError('At least one permission code is required.'); return; }
    if (!form.expiresAt) { setCreateError('Expiry date/time is required.'); return; }

    setCreating(true);
    setCreateError(null);
    try {
      await createDelegation({
        delegateeId: form.delegateeId,
        permissionCodes: form.permissionCodes,
        expiresAt: form.expiresAt,
        scopeOrgUnitId: form.scopeOrgUnitId ?? null,
        justification: form.justification?.trim() || null,
      });
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
      await load();
    } catch (e) {
      setCreateError((e as Error).message ?? 'Failed to create delegation.');
    } finally {
      setCreating(false);
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
    setRevoking(true);
    setRevokeError(null);
    try {
      await revokeDelegation(revokeTarget.id, revokeNote.trim() || null);
      setRevokeTarget(null);
      await load();
    } catch (e) {
      setRevokeError((e as Error).message ?? 'Failed to revoke delegation.');
    } finally {
      setRevoking(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Delegations</h1>
            <p className="text-muted mb-0 small">Temporarily grant your permissions to another user</p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setForm({ ...EMPTY_FORM }); setCreateError(null); setShowCreate(true); }}
          >
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>New Delegation
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <span className="spinner-border me-2" role="status" aria-label="Loading"></span>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-people fs-3 d-block mb-2" aria-hidden="true"></i>
              No delegations found.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0">
                <thead className="table-light">
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Delegatee ID</th>
                    <th scope="col">Permissions</th>
                    <th scope="col">Scope Org Unit</th>
                    <th scope="col">Active</th>
                    <th scope="col">Expires</th>
                    <th scope="col" className="text-end">Actions</th>
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
                        {item.scopeOrgUnitId != null ? `Unit #${item.scopeOrgUnitId}` : 'Global'}
                      </td>
                      <td>
                        <span className={`badge ${item.isActive ? 'bg-success' : 'bg-secondary'}`}>
                          {item.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="small text-muted text-nowrap">{formatDate(item.expiresAt)}</td>
                      <td className="text-end">
                        {item.isActive && (
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => openRevoke(item)}
                            aria-label={`Revoke delegation ${item.id}`}
                          >
                            <i className="bi bi-x-circle me-1" aria-hidden="true"></i>Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true" aria-label="New delegation">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">New Delegation</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setShowCreate(false)}></button>
              </div>
              <div className="modal-body">
                {createError && (
                  <div className="alert alert-danger py-2 small" role="alert">{createError}</div>
                )}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label htmlFor="delegDelegateeId" className="form-label">Delegatee User ID <span className="text-danger">*</span></label>
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
                    <label htmlFor="delegExpiry" className="form-label">Expires At <span className="text-danger">*</span></label>
                    <input
                      id="delegExpiry"
                      type="datetime-local"
                      className="form-control"
                      value={form.expiresAt}
                      onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                    />
                  </div>
                  <div className="col-12">
                    <label className="form-label">Permission Codes <span className="text-danger">*</span></label>
                    <div className="input-group">
                      <input
                        id="delegPermissionInput"
                        type="text"
                        className="form-control"
                        placeholder="e.g. schedule.manage"
                        value={form.permissionInput}
                        onChange={(e) => setForm((f) => ({ ...f, permissionInput: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPermission(); } }}
                        aria-label="Permission code input"
                      />
                      <button className="btn btn-outline-secondary" type="button" onClick={addPermission} aria-label="Add permission code">
                        Add
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
                              aria-label={`Remove permission ${code}`}
                              onClick={() => removePermission(code)}
                              style={{ fontSize: '0.55rem' }}
                            ></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-md-6">
                    <label htmlFor="delegScopeOrgUnit" className="form-label">Scope Org Unit ID <span className="text-muted small">(optional)</span></label>
                    <input
                      id="delegScopeOrgUnit"
                      type="number"
                      className="form-control"
                      min={1}
                      placeholder="Optional — leave blank for global"
                      value={form.scopeOrgUnitId ?? ''}
                      onChange={(e) => setForm((f) => ({
                        ...f,
                        scopeOrgUnitId: e.target.value ? Number(e.target.value) : null,
                      }))}
                    />
                  </div>
                  <div className="col-12">
                    <label htmlFor="delegJustification" className="form-label">Justification <span className="text-muted small">(optional)</span></label>
                    <textarea
                      id="delegJustification"
                      className="form-control"
                      rows={2}
                      value={form.justification ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))}
                      placeholder="Reason for this delegation"
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={creating}
                  aria-label="Submit delegation"
                >
                  {creating ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                  ) : 'Create'}
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
          aria-label={`Revoke delegation ${revokeTarget.id}`}
        >
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Revoke Delegation #{revokeTarget.id}</h5>
                <button type="button" className="btn-close" aria-label="Close" onClick={() => setRevokeTarget(null)}></button>
              </div>
              <div className="modal-body">
                {revokeError && (
                  <div className="alert alert-danger py-2 small" role="alert">{revokeError}</div>
                )}
                <p className="small text-muted mb-3">
                  This will immediately deactivate the delegation. The action is recorded in the audit log.
                </p>
                <div>
                  <label htmlFor="revokeNote" className="form-label">
                    Justification <span className="text-muted small">(optional)</span>
                  </label>
                  <textarea
                    id="revokeNote"
                    className="form-control"
                    rows={3}
                    value={revokeNote}
                    onChange={(e) => setRevokeNote(e.target.value)}
                    placeholder="Reason for revocation"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRevokeTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleRevoke}
                  disabled={revoking}
                  aria-label="Confirm revoke"
                >
                  {revoking ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Revoking…</>
                  ) : 'Revoke'}
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
