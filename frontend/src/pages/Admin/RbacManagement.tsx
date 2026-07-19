/**
 * RbacManagement — Admin page for managing roles, permissions, and user role grants.
 *
 * Two tabs:
 *   Roles      — list, create, edit (name + permission set), delete non-system roles
 *   User Roles — search employees, view current role grants, add or revoke grants
 *
 * Requires the `role.manage` permission; the route is protected via PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Permission, Role, UserRoleAssignment, Employee } from '../../types';
import { OrgUnit, listUnits } from '../../services/orgService';
import {
  listPermissions,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getUserRoles,
  assignRole,
  removeRole,
} from '../../services/rbacService';
import { getEmployees } from '../../services/employeeService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'roles' | 'user-roles';

interface RoleFormState {
  name: string;
  description: string;
  permissionCodes: string[];
}

const EMPTY_FORM: RoleFormState = { name: '', description: '', permissionCodes: [] };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const RbacManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('roles');

  // ---- Roles tab state ----
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [rolesSuccess, setRolesSuccess] = useState<string | null>(null);

  const [roleModal, setRoleModal] = useState<{ open: boolean; editing: Role | null }>({
    open: false,
    editing: null,
  });
  const [roleForm, setRoleForm] = useState<RoleFormState>(EMPTY_FORM);
  const [roleSaving, setRoleSaving] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---- User-roles tab state ----
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<Employee | null>(null);
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>([]);
  const [userRolesLoading, setUserRolesLoading] = useState(false);
  const [userRolesError, setUserRolesError] = useState<string | null>(null);
  const [userRolesSuccess, setUserRolesSuccess] = useState<string | null>(null);

  const [grantForm, setGrantForm] = useState<{
    roleId: number | '';
    scopeOrgUnitId: number | '';
    expiresAt: string;
    justification: string;
  }>({ roleId: '', scopeOrgUnitId: '', expiresAt: '', justification: '' });
  const [granting, setGranting] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<UserRoleAssignment | null>(null);
  const [revokeJustification, setRevokeJustification] = useState('');
  const [revoking, setRevoking] = useState(false);

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadRoles = useCallback(async () => {
    setRolesLoading(true);
    setRolesError(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([listRoles(), listPermissions()]);
      if (rolesRes.success && rolesRes.data) setRoles(rolesRes.data);
      if (permsRes.success && permsRes.data) setPermissions(permsRes.data);
    } catch (e) {
      setRolesError((e as Error).message ?? 'Failed to load roles.');
    } finally {
      setRolesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoles();
    listUnits().then((res) => {
      if (res.success && res.data) setOrgUnits(res.data);
    }).catch(() => {});
  }, [loadRoles]);

  const searchEmployees = useCallback(async (q: string) => {
    if (!q.trim()) { setEmployees([]); return; }
    setEmpLoading(true);
    try {
      const res = await getEmployees({ search: q.trim() });
      if (res.success && res.data) setEmployees(res.data);
    } catch {
      setEmployees([]);
    } finally {
      setEmpLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void searchEmployees(employeeSearch), 300);
    return () => clearTimeout(t);
  }, [employeeSearch, searchEmployees]);

  const loadUserRoles = async (userId: number) => {
    setUserRolesLoading(true);
    setUserRolesError(null);
    try {
      const res = await getUserRoles(userId);
      if (res.success && res.data) setUserRoles(res.data);
      else setUserRolesError('Failed to load user roles.');
    } catch (e) {
      setUserRolesError((e as Error).message ?? 'Failed to load user roles.');
    } finally {
      setUserRolesLoading(false);
    }
  };

  const handleSelectUser = (emp: Employee) => {
    setSelectedUser(emp);
    setEmployees([]);
    setEmployeeSearch('');
    setUserRolesSuccess(null);
    setUserRolesError(null);
    void loadUserRoles(Number(emp.id));
  };

  // ---------------------------------------------------------------------------
  // Role CRUD
  // ---------------------------------------------------------------------------

  const openCreate = () => {
    setRoleForm(EMPTY_FORM);
    setRoleModal({ open: true, editing: null });
  };

  const openEdit = (role: Role) => {
    setRoleForm({
      name: role.name,
      description: role.description ?? '',
      permissionCodes: role.permissions ?? [],
    });
    setRoleModal({ open: true, editing: role });
  };

  const togglePermission = (code: string) => {
    setRoleForm((prev) => ({
      ...prev,
      permissionCodes: prev.permissionCodes.includes(code)
        ? prev.permissionCodes.filter((c) => c !== code)
        : [...prev.permissionCodes, code],
    }));
  };

  const saveRole = async () => {
    if (!roleForm.name.trim()) return;
    setRoleSaving(true);
    setRolesError(null);
    setRolesSuccess(null);
    try {
      const body = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        permissionCodes: roleForm.permissionCodes,
      };
      if (roleModal.editing) {
        await updateRole(roleModal.editing.id, body);
        setRolesSuccess(`Role "${roleForm.name}" updated.`);
      } else {
        await createRole(body);
        setRolesSuccess(`Role "${roleForm.name}" created.`);
      }
      setRoleModal({ open: false, editing: null });
      await loadRoles();
    } catch (e) {
      setRolesError((e as Error).message ?? 'Failed to save role.');
    } finally {
      setRoleSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setRolesError(null);
    setRolesSuccess(null);
    try {
      await deleteRole(deleteConfirm.id);
      setRolesSuccess(`Role "${deleteConfirm.name}" deleted.`);
      setDeleteConfirm(null);
      await loadRoles();
    } catch (e) {
      setRolesError((e as Error).message ?? 'Failed to delete role.');
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // User role grants
  // ---------------------------------------------------------------------------

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || grantForm.roleId === '') return;
    setGranting(true);
    setUserRolesError(null);
    setUserRolesSuccess(null);
    try {
      await assignRole(Number(selectedUser.id), {
        roleId: Number(grantForm.roleId),
        scopeOrgUnitId: grantForm.scopeOrgUnitId !== '' ? Number(grantForm.scopeOrgUnitId) : null,
        expiresAt: grantForm.expiresAt || null,
        justification: grantForm.justification || undefined,
      });
      setGrantForm({ roleId: '', scopeOrgUnitId: '', expiresAt: '', justification: '' });
      setUserRolesSuccess('Role granted successfully.');
      await loadUserRoles(Number(selectedUser.id));
    } catch (e) {
      setUserRolesError((e as Error).message ?? 'Failed to grant role.');
    } finally {
      setGranting(false);
    }
  };

  const confirmRevoke = async () => {
    if (!selectedUser || !revokeTarget) return;
    setRevoking(true);
    setUserRolesError(null);
    setUserRolesSuccess(null);
    try {
      await removeRole(
        Number(selectedUser.id),
        revokeTarget.roleId,
        revokeTarget.scopeOrgUnitId,
        revokeJustification || undefined
      );
      setUserRolesSuccess(`Role "${revokeTarget.roleName}" revoked.`);
      setRevokeTarget(null);
      setRevokeJustification('');
      await loadUserRoles(Number(selectedUser.id));
    } catch (e) {
      setUserRolesError((e as Error).message ?? 'Failed to revoke role.');
    } finally {
      setRevoking(false);
    }
  };

  // Group permissions by resource for the checkbox list
  const permsByResource = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {});

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col">
          <h1 className="h3 mb-0">Roles &amp; Permissions</h1>
          <p className="text-muted mb-0">Manage roles, permission sets, and user role grants</p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('roles')}
          >
            <i className="bi bi-shield-check me-2" aria-hidden="true"></i>Roles
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'user-roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('user-roles')}
          >
            <i className="bi bi-person-badge me-2" aria-hidden="true"></i>User Role Grants
          </button>
        </li>
      </ul>

      {/* ---- Roles tab ---- */}
      {activeTab === 'roles' && (
        <div>
          {rolesSuccess && (
            <div className="alert alert-success alert-dismissible" role="status">
              <i className="bi bi-check-circle me-2" aria-hidden="true"></i>{rolesSuccess}
              <button type="button" className="btn-close" onClick={() => setRolesSuccess(null)} aria-label="Close"></button>
            </div>
          )}
          {rolesError && (
            <div className="alert alert-danger" role="alert">
              <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{rolesError}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">All Roles</h5>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>
              <i className="bi bi-plus me-1" aria-hidden="true"></i>New Role
            </button>
          </div>

          {rolesLoading ? (
            <div className="text-center py-4">
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              <span className="ms-2">Loading…</span>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead className="table-light">
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Description</th>
                    <th scope="col">Permissions</th>
                    <th scope="col" className="text-center">System</th>
                    <th scope="col" className="text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td className="fw-semibold">{role.name}</td>
                      <td className="text-muted small">{role.description ?? '—'}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {(role.permissions ?? []).length === 0 ? (
                            <span className="text-muted small">None</span>
                          ) : (
                            (role.permissions ?? []).slice(0, 5).map((code) => (
                              <span key={code} className="badge bg-light text-dark border font-monospace small">
                                {code}
                              </span>
                            ))
                          )}
                          {(role.permissions ?? []).length > 5 && (
                            <span className="badge bg-secondary">+{(role.permissions ?? []).length - 5} more</span>
                          )}
                        </div>
                      </td>
                      <td className="text-center">
                        {role.isSystem ? (
                          <span className="badge bg-warning text-dark">System</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="btn-group btn-group-sm">
                          <button
                            className="btn btn-outline-primary"
                            onClick={() => openEdit(role)}
                            aria-label={`Edit role ${role.name}`}
                          >
                            <i className="bi bi-pencil" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-outline-danger"
                            onClick={() => setDeleteConfirm(role)}
                            disabled={role.isSystem}
                            aria-label={`Delete role ${role.name}`}
                            title={role.isSystem ? 'System roles cannot be deleted' : undefined}
                          >
                            <i className="bi bi-trash" aria-hidden="true"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ---- User Role Grants tab ---- */}
      {activeTab === 'user-roles' && (
        <div className="row">
          <div className="col-lg-10">
            {userRolesSuccess && (
              <div className="alert alert-success alert-dismissible" role="status">
                <i className="bi bi-check-circle me-2" aria-hidden="true"></i>{userRolesSuccess}
                <button type="button" className="btn-close" onClick={() => setUserRolesSuccess(null)} aria-label="Close"></button>
              </div>
            )}
            {userRolesError && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{userRolesError}
              </div>
            )}

            {/* User search */}
            <div className="card mb-4">
              <div className="card-header"><h5 className="mb-0">Select Employee</h5></div>
              <div className="card-body">
                <div className="position-relative">
                  <label htmlFor="employeeSearchInput" className="form-label">Search by name or email</label>
                  <input
                    id="employeeSearchInput"
                    type="text"
                    className="form-control"
                    placeholder="Type to search…"
                    value={employeeSearch}
                    onChange={(e) => setEmployeeSearch(e.target.value)}
                    autoComplete="off"
                  />
                  {empLoading && (
                    <span
                      className="spinner-border spinner-border-sm position-absolute"
                      style={{ right: 12, top: 38 }}
                      role="status"
                      aria-hidden="true"
                    ></span>
                  )}
                  {employees.length > 0 && (
                    <ul className="list-group position-absolute w-100 z-3" style={{ top: '100%' }} role="listbox">
                      {employees.map((emp) => (
                        <li
                          key={emp.id}
                          className="list-group-item list-group-item-action"
                          role="option"
                          aria-selected={false}
                          onClick={() => handleSelectUser(emp)}
                          style={{ cursor: 'pointer' }}
                        >
                          {emp.firstName} {emp.lastName}
                          <small className="text-muted ms-2">{emp.email}</small>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {selectedUser && (
                  <div className="mt-3 d-flex align-items-center gap-2">
                    <i className="bi bi-person-circle fs-4 text-primary" aria-hidden="true"></i>
                    <div>
                      <strong>{selectedUser.firstName} {selectedUser.lastName}</strong>
                      <small className="text-muted ms-2">{selectedUser.email}</small>
                    </div>
                    <button
                      className="btn btn-sm btn-outline-secondary ms-auto"
                      onClick={() => { setSelectedUser(null); setUserRoles([]); }}
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            </div>

            {selectedUser && (
              <>
                {/* Current grants */}
                <div className="card mb-4">
                  <div className="card-header">
                    <h5 className="mb-0">Current Role Grants</h5>
                  </div>
                  <div className="card-body p-0">
                    {userRolesLoading ? (
                      <div className="text-center py-3">
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                        <span className="ms-2">Loading…</span>
                      </div>
                    ) : userRoles.length === 0 ? (
                      <p className="text-muted text-center py-3 mb-0">No roles assigned.</p>
                    ) : (
                      <table className="table table-sm table-hover mb-0">
                        <thead className="table-light">
                          <tr>
                            <th scope="col">Role</th>
                            <th scope="col">Scope (Org Unit)</th>
                            <th scope="col">Expires</th>
                            <th scope="col" className="text-center">Revoke</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userRoles.map((ur, i) => (
                            <tr key={i}>
                              <td className="fw-semibold">{ur.roleName}</td>
                              <td>
                                {ur.scopeOrgUnitId
                                  ? (orgUnits.find((u) => u.id === ur.scopeOrgUnitId)?.name ?? `Unit #${ur.scopeOrgUnitId}`)
                                  : <span className="text-muted">Global</span>}
                              </td>
                              <td>
                                {ur.expiresAt
                                  ? new Date(ur.expiresAt).toLocaleDateString()
                                  : <span className="text-muted">Never</span>}
                              </td>
                              <td className="text-center">
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => { setRevokeTarget(ur); setRevokeJustification(''); }}
                                  aria-label={`Revoke role ${ur.roleName}`}
                                >
                                  Revoke
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* Grant new role */}
                <div className="card">
                  <div className="card-header"><h5 className="mb-0">Grant Role</h5></div>
                  <div className="card-body">
                    <form onSubmit={(e) => void handleGrant(e)}>
                      <div className="row g-3">
                        <div className="col-md-4">
                          <label htmlFor="grantRoleSelect" className="form-label">Role <span className="text-danger">*</span></label>
                          <select
                            id="grantRoleSelect"
                            className="form-select"
                            value={grantForm.roleId}
                            onChange={(e) => setGrantForm((f) => ({ ...f, roleId: e.target.value ? Number(e.target.value) : '' }))}
                            required
                          >
                            <option value="">Select role…</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-4">
                          <label htmlFor="grantScopeSelect" className="form-label">Scope (Org Unit)</label>
                          <select
                            id="grantScopeSelect"
                            className="form-select"
                            value={grantForm.scopeOrgUnitId}
                            onChange={(e) => setGrantForm((f) => ({ ...f, scopeOrgUnitId: e.target.value ? Number(e.target.value) : '' }))}
                          >
                            <option value="">Global (no scope)</option>
                            {orgUnits.map((u) => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-4">
                          <label htmlFor="grantExpiresAt" className="form-label">Expires at</label>
                          <input
                            id="grantExpiresAt"
                            type="datetime-local"
                            className="form-control"
                            value={grantForm.expiresAt}
                            onChange={(e) => setGrantForm((f) => ({ ...f, expiresAt: e.target.value }))}
                          />
                        </div>
                        <div className="col-12">
                          <label htmlFor="grantJustification" className="form-label">Justification <span className="text-muted">(optional)</span></label>
                          <input
                            id="grantJustification"
                            type="text"
                            className="form-control"
                            placeholder="Reason for this grant…"
                            value={grantForm.justification}
                            onChange={(e) => setGrantForm((f) => ({ ...f, justification: e.target.value }))}
                            maxLength={1000}
                          />
                        </div>
                        <div className="col-12">
                          <button type="submit" className="btn btn-primary" disabled={granting || grantForm.roleId === ''}>
                            {granting ? (
                              <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Granting…</>
                            ) : (
                              <><i className="bi bi-plus me-1" aria-hidden="true"></i>Grant Role</>
                            )}
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- Role create/edit modal ---- */}
      {roleModal.open && (
        <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="roleModalLabel">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="roleModalLabel">
                  {roleModal.editing ? `Edit role "${roleModal.editing.name}"` : 'Create Role'}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRoleModal({ open: false, editing: null })}
                  aria-label="Close dialog"
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label htmlFor="roleNameInput" className="form-label">Name <span className="text-danger">*</span></label>
                  <input
                    id="roleNameInput"
                    type="text"
                    className="form-control"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={roleModal.editing?.isSystem}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label htmlFor="roleDescInput" className="form-label">Description</label>
                  <input
                    id="roleDescInput"
                    type="text"
                    className="form-control"
                    value={roleForm.description}
                    onChange={(e) => setRoleForm((f) => ({ ...f, description: e.target.value }))}
                    maxLength={255}
                  />
                </div>
                <div>
                  <label className="form-label">Permissions</label>
                  {Object.entries(permsByResource).map(([resource, perms]) => (
                    <div key={resource} className="mb-3">
                      <h6 className="text-uppercase text-muted small mb-2">{resource}</h6>
                      <div className="d-flex flex-wrap gap-2">
                        {perms.map((p) => (
                          <div key={p.code} className="form-check form-check-inline">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              id={`perm-${p.code}`}
                              checked={roleForm.permissionCodes.includes(p.code)}
                              onChange={() => togglePermission(p.code)}
                            />
                            <label className="form-check-label font-monospace small" htmlFor={`perm-${p.code}`}>
                              {p.code}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRoleModal({ open: false, editing: null })}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveRole()}
                  disabled={roleSaving || !roleForm.name.trim()}
                >
                  {roleSaving ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Saving…</>
                  ) : (
                    roleModal.editing ? 'Save Changes' : 'Create Role'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Delete confirm modal ---- */}
      {deleteConfirm && (
        <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="deleteRoleModalLabel">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="deleteRoleModalLabel">Delete Role</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDeleteConfirm(null)}
                  aria-label="Close dialog"
                ></button>
              </div>
              <div className="modal-body">
                <p>Delete role <strong>{deleteConfirm.name}</strong>? This will remove all user grants for this role. This action cannot be undone.</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                >
                  {deleting ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Deleting…</> : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Revoke confirm modal ---- */}
      {revokeTarget && (
        <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="revokeModalLabel">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="revokeModalLabel">Revoke Role Grant</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRevokeTarget(null)}
                  aria-label="Close dialog"
                ></button>
              </div>
              <div className="modal-body">
                <p>Revoke role <strong>{revokeTarget.roleName}</strong> from <strong>{selectedUser?.firstName} {selectedUser?.lastName}</strong>?</p>
                <label htmlFor="revokeJustificationInput" className="form-label">Justification <span className="text-muted">(optional)</span></label>
                <textarea
                  id="revokeJustificationInput"
                  className="form-control"
                  rows={2}
                  value={revokeJustification}
                  onChange={(e) => setRevokeJustification(e.target.value)}
                  maxLength={1000}
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setRevokeTarget(null)}>Cancel</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmRevoke()}
                  disabled={revoking}
                >
                  {revoking ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>Revoking…</> : 'Revoke'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RbacManagement;
