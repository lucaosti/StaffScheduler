/**
 * ModulesSection — Settings tab for managing runtime feature modules.
 *
 * Shows the global enabled/disabled state of every module and lets admins
 * toggle them (with optional justification). A secondary panel allows
 * per-organisation overrides: type an org name, load its effective module
 * states, and set or remove overrides individually.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  listModules,
  listModulesForOrg,
  setModuleEnabled,
  setModuleOrgOverride,
  removeModuleOrgOverride,
} from '../../services/moduleService';
import { Module, ModuleWithOrgOverride } from '../../types';

interface PendingToggle {
  code: string;
  targetEnabled: boolean;
  scope: 'global' | 'org';
  org?: string;
}

const ModulesSection: React.FC = () => {
  const { user } = useAuth();

  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Org-override panel state
  const [orgName, setOrgName] = useState<string>(user?.organizationName ?? '');
  const [orgModules, setOrgModules] = useState<ModuleWithOrgOverride[]>([]);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

  // Justification modal state
  const [pendingToggle, setPendingToggle] = useState<PendingToggle | null>(null);
  const [justification, setJustification] = useState('');
  const [saving, setSaving] = useState(false);

  const loadGlobal = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listModules();
      if (res.success && res.data) setModules(res.data);
      else setError('Failed to load modules.');
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load modules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGlobal();
  }, [loadGlobal]);

  const loadOrgModules = async () => {
    if (!orgName.trim()) return;
    setOrgLoading(true);
    setOrgError(null);
    try {
      const res = await listModulesForOrg(orgName.trim());
      if (res.success && res.data) setOrgModules(res.data);
      else setOrgError('Failed to load org modules.');
    } catch (e) {
      setOrgError((e as Error).message ?? 'Failed to load org modules.');
    } finally {
      setOrgLoading(false);
    }
  };

  const requestToggle = (code: string, targetEnabled: boolean, scope: 'global' | 'org', org?: string) => {
    setPendingToggle({ code, targetEnabled, scope, org });
    setJustification('');
  };

  const confirmToggle = async () => {
    if (!pendingToggle) return;
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      const { code, targetEnabled, scope, org } = pendingToggle;
      if (scope === 'global') {
        await setModuleEnabled(code, targetEnabled, justification || undefined);
        await loadGlobal();
        if (orgModules.length > 0 && orgName) await loadOrgModules();
        setSuccess(`Module '${code}' ${targetEnabled ? 'enabled' : 'disabled'} globally.`);
      } else if (scope === 'org' && org) {
        await setModuleOrgOverride(code, org, targetEnabled, justification || undefined);
        await loadOrgModules();
        setSuccess(`Module '${code}' override set for org '${org}'.`);
      }
      setPendingToggle(null);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to update module.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveOverride = async (code: string) => {
    if (!orgName.trim()) return;
    setSaving(true);
    setSuccess(null);
    setError(null);
    try {
      await removeModuleOrgOverride(code, orgName.trim());
      await loadOrgModules();
      setSuccess(`Override for module '${code}' removed; global default now applies.`);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to remove override.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="row">
      <div className="col-lg-10">
        {success && (
          <div className="alert alert-success alert-dismissible" role="status">
            <i className="bi bi-check-circle me-2" aria-hidden="true"></i>
            {success}
            <button type="button" className="btn-close" onClick={() => setSuccess(null)} aria-label="Close"></button>
          </div>
        )}
        {error && (
          <div className="alert alert-danger" role="alert">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
            {error}
          </div>
        )}

        {/* Global modules */}
        <div className="card mb-4">
          <div className="card-header d-flex align-items-center justify-content-between">
            <h5 className="mb-0">
              <i className="bi bi-toggles me-2" aria-hidden="true"></i>Global Modules
            </h5>
          </div>
          <div className="card-body p-0">
            {loading ? (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                <span className="ms-2">Loading modules…</span>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Module</th>
                      <th scope="col">Description</th>
                      <th scope="col" className="text-center">Status</th>
                      <th scope="col" className="text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((m) => (
                      <tr key={m.code}>
                        <td>
                          <span className="fw-semibold">{m.name}</span>
                          <br />
                          <small className="text-muted font-monospace">{m.code}</small>
                        </td>
                        <td className="text-muted small">{m.description ?? '—'}</td>
                        <td className="text-center">
                          <span className={`badge ${m.isEnabled ? 'bg-success' : 'bg-secondary'}`}>
                            {m.isEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="text-center">
                          <button
                            className={`btn btn-sm ${m.isEnabled ? 'btn-outline-danger' : 'btn-outline-success'}`}
                            onClick={() => requestToggle(m.code, !m.isEnabled, 'global')}
                            aria-label={`${m.isEnabled ? 'Disable' : 'Enable'} module ${m.name}`}
                          >
                            {m.isEnabled ? (
                              <><i className="bi bi-toggle-off me-1" aria-hidden="true"></i>Disable</>
                            ) : (
                              <><i className="bi bi-toggle-on me-1" aria-hidden="true"></i>Enable</>
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Per-org overrides */}
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">
              <i className="bi bi-building me-2" aria-hidden="true"></i>Per-Organisation Overrides
            </h5>
          </div>
          <div className="card-body">
            <p className="text-muted small mb-3">
              An override takes priority over the global state. Remove the override to revert to the global default.
            </p>
            <div className="row g-2 align-items-end mb-3">
              <div className="col-md-6">
                <label htmlFor="orgNameInput" className="form-label">Organisation name</label>
                <input
                  id="orgNameInput"
                  type="text"
                  className="form-control"
                  placeholder="e.g. General Hospital"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void loadOrgModules(); }}
                />
              </div>
              <div className="col-auto">
                <button
                  className="btn btn-outline-primary"
                  onClick={() => void loadOrgModules()}
                  disabled={!orgName.trim() || orgLoading}
                >
                  {orgLoading ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Loading…</>
                  ) : (
                    <><i className="bi bi-search me-1" aria-hidden="true"></i>Load</>
                  )}
                </button>
              </div>
            </div>

            {orgError && (
              <div className="alert alert-warning" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{orgError}
              </div>
            )}

            {orgModules.length > 0 && (
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th scope="col">Module</th>
                      <th scope="col" className="text-center">Global</th>
                      <th scope="col" className="text-center">Org Override</th>
                      <th scope="col" className="text-center">Effective</th>
                      <th scope="col" className="text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgModules.map((m) => (
                      <tr key={m.code}>
                        <td>
                          <span className="fw-semibold">{m.name}</span>
                          <small className="text-muted font-monospace ms-2">{m.code}</small>
                        </td>
                        <td className="text-center">
                          <span className={`badge ${m.isEnabled ? 'bg-success' : 'bg-secondary'} bg-opacity-50`}>
                            {m.isEnabled ? 'On' : 'Off'}
                          </span>
                        </td>
                        <td className="text-center">
                          {m.orgOverride !== null ? (
                            <span className={`badge ${m.orgOverride ? 'bg-success' : 'bg-danger'}`}>
                              {m.orgOverride ? 'On' : 'Off'}
                            </span>
                          ) : (
                            <span className="text-muted small">—</span>
                          )}
                        </td>
                        <td className="text-center">
                          <span className={`badge ${m.effectiveEnabled ? 'bg-success' : 'bg-secondary'}`}>
                            {m.effectiveEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                        <td className="text-center">
                          <div className="btn-group btn-group-sm" role="group">
                            <button
                              className="btn btn-outline-success"
                              onClick={() => requestToggle(m.code, true, 'org', orgName.trim())}
                              disabled={m.orgOverride === true}
                              aria-label={`Set org override enabled for ${m.name}`}
                            >
                              Enable
                            </button>
                            <button
                              className="btn btn-outline-danger"
                              onClick={() => requestToggle(m.code, false, 'org', orgName.trim())}
                              disabled={m.orgOverride === false}
                              aria-label={`Set org override disabled for ${m.name}`}
                            >
                              Disable
                            </button>
                            {m.orgOverride !== null && (
                              <button
                                className="btn btn-outline-secondary"
                                onClick={() => void handleRemoveOverride(m.code)}
                                aria-label={`Reset override for ${m.name}`}
                              >
                                Reset
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Justification modal (inline) */}
        {pendingToggle && (
          <div
            className="modal d-block"
            role="dialog"
            aria-modal="true"
            aria-labelledby="justificationModalLabel"
          >
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title" id="justificationModalLabel">
                    {pendingToggle.targetEnabled ? 'Enable' : 'Disable'} module &quot;{pendingToggle.code}&quot;
                    {pendingToggle.scope === 'org' && ` for org '${pendingToggle.org}'`}
                  </h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setPendingToggle(null)}
                    aria-label="Close dialog"
                  ></button>
                </div>
                <div className="modal-body">
                  <label htmlFor="justificationInput" className="form-label">
                    Justification <span className="text-muted">(optional)</span>
                  </label>
                  <textarea
                    id="justificationInput"
                    className="form-control"
                    rows={3}
                    placeholder="Reason for this change…"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    maxLength={1000}
                  />
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPendingToggle(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={`btn ${pendingToggle.targetEnabled ? 'btn-success' : 'btn-danger'}`}
                    onClick={() => void confirmToggle()}
                    disabled={saving}
                  >
                    {saving ? (
                      <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                    ) : (
                      pendingToggle.targetEnabled ? 'Enable' : 'Disable'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ModulesSection;
