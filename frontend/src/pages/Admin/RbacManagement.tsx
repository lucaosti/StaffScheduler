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

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, Role, UserRoleAssignment, Employee } from '../../types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import RoleTimeline from './RoleTimeline';
import {
  useRolesAndPermissionsQuery,
  useRbacOrgUnitsQuery,
  useEmployeeSearchQuery,
  useUserRolesQuery,
  useRoleMutations,
  useUserRoleMutations,
} from '../../hooks/useRbac';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'roles' | 'user-roles' | 'history';

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
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('roles');
  // The history tab reuses the user already picked in the grants tab rather
  // than offering a second search: having two selections for "who" on one page
  // is how they come to disagree.
  const [historyKind, setHistoryKind] = useState<'user' | 'role'>('user');
  const [historyRoleId, setHistoryRoleId] = useState<number | null>(null);

  // ---- Roles tab state (server state via TanStack Query) ----
  const rolesQuery = useRolesAndPermissionsQuery();
  const roles = rolesQuery.data?.roles ?? [];
  const permissions = rolesQuery.data?.permissions ?? [];
  const rolesLoading = rolesQuery.isLoading;
  const [rolesActionError, setRolesError] = useState<string | null>(null);
  const rolesError = rolesQuery.isError
    ? (rolesQuery.error as Error).message ?? t('admin.rbac.roles.loadFailed')
    : rolesActionError;
  const [rolesSuccess, setRolesSuccess] = useState<string | null>(null);
  const { create: createRole, update: updateRole, remove: deleteRole } = useRoleMutations();
  const roleSaving = createRole.isPending || updateRole.isPending;
  const deleting = deleteRole.isPending;

  const [roleModal, setRoleModal] = useState<{ open: boolean; editing: Role | null }>({
    open: false,
    editing: null,
  });
  const [roleForm, setRoleForm] = useState<RoleFormState>(EMPTY_FORM);

  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null);

  // ---- User-roles tab state ----
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<Employee | null>(null);
  const [userRolesActionError, setUserRolesError] = useState<string | null>(null);
  const [userRolesSuccess, setUserRolesSuccess] = useState<string | null>(null);

  // Server state via TanStack Query: org units, a debounced employee search, and
  // the selected user's roles (both gated on their input via enabled).
  const orgUnits = useRbacOrgUnitsQuery().data ?? [];
  const debouncedEmployeeSearch = useDebouncedValue(employeeSearch, 300);
  const employeeSearchQuery = useEmployeeSearchQuery(debouncedEmployeeSearch);
  const employees = employeeSearchQuery.data ?? [];
  const empLoading = employeeSearchQuery.isFetching;
  const userRolesQuery = useUserRolesQuery(selectedUser?.id ? Number(selectedUser.id) : null);
  const userRoles = userRolesQuery.data ?? [];
  const userRolesLoading = selectedUser !== null && userRolesQuery.isLoading;
  const userRolesError = userRolesQuery.isError
    ? (userRolesQuery.error as Error).message ?? t('admin.rbac.userRoles.loadFailed')
    : userRolesActionError;
  const { grant: grantRole, revoke: revokeRole } = useUserRoleMutations();

  const [grantForm, setGrantForm] = useState<{
    roleId: number | '';
    scopeOrgUnitId: number | '';
    expiresAt: string;
    justification: string;
  }>({ roleId: '', scopeOrgUnitId: '', expiresAt: '', justification: '' });
  const granting = grantRole.isPending;

  const [revokeTarget, setRevokeTarget] = useState<UserRoleAssignment | null>(null);
  const [revokeJustification, setRevokeJustification] = useState('');
  const revoking = revokeRole.isPending;

  // ---------------------------------------------------------------------------
  // Selection — the queries above react to selectedUser / employeeSearch.
  // ---------------------------------------------------------------------------

  const handleSelectUser = (emp: Employee) => {
    // Clearing the search disables the employee-search query (hiding results);
    // setting the user drives the user-roles query.
    setEmployeeSearch('');
    setUserRolesSuccess(null);
    setUserRolesError(null);
    setSelectedUser(emp);
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
    setRolesError(null);
    setRolesSuccess(null);
    try {
      const body = {
        name: roleForm.name.trim(),
        description: roleForm.description.trim() || undefined,
        permissionCodes: roleForm.permissionCodes,
      };
      if (roleModal.editing) {
        await updateRole.mutateAsync({ id: roleModal.editing.id, ...body });
        setRolesSuccess(t('admin.rbac.roles.updatedMessage', { name: roleForm.name }));
      } else {
        await createRole.mutateAsync(body);
        setRolesSuccess(t('admin.rbac.roles.createdMessage', { name: roleForm.name }));
      }
      setRoleModal({ open: false, editing: null });
    } catch (e) {
      setRolesError((e as Error).message ?? t('admin.rbac.roles.saveFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setRolesError(null);
    setRolesSuccess(null);
    try {
      await deleteRole.mutateAsync(deleteConfirm.id);
      setRolesSuccess(t('admin.rbac.roles.deletedMessage', { name: deleteConfirm.name }));
      setDeleteConfirm(null);
    } catch (e) {
      setRolesError((e as Error).message ?? t('admin.rbac.roles.deleteFailed'));
      setDeleteConfirm(null);
    }
  };

  // ---------------------------------------------------------------------------
  // User role grants
  // ---------------------------------------------------------------------------

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || grantForm.roleId === '') return;
    setUserRolesError(null);
    setUserRolesSuccess(null);
    try {
      await grantRole.mutateAsync({
        userId: Number(selectedUser.id),
        roleId: Number(grantForm.roleId),
        scopeOrgUnitId: grantForm.scopeOrgUnitId !== '' ? Number(grantForm.scopeOrgUnitId) : null,
        expiresAt: grantForm.expiresAt || null,
        justification: grantForm.justification || undefined,
      });
      setGrantForm({ roleId: '', scopeOrgUnitId: '', expiresAt: '', justification: '' });
      setUserRolesSuccess(t('admin.rbac.userRoles.grantedMessage'));
    } catch (e) {
      setUserRolesError((e as Error).message ?? t('admin.rbac.userRoles.grantFailed'));
    }
  };

  const confirmRevoke = async () => {
    if (!selectedUser || !revokeTarget) return;
    setUserRolesError(null);
    setUserRolesSuccess(null);
    try {
      await revokeRole.mutateAsync({
        userId: Number(selectedUser.id),
        roleId: revokeTarget.roleId,
        scopeOrgUnitId: revokeTarget.scopeOrgUnitId,
        justification: revokeJustification || undefined,
      });
      setUserRolesSuccess(t('admin.rbac.userRoles.revokedMessage', { name: revokeTarget.roleName }));
      setRevokeTarget(null);
      setRevokeJustification('');
    } catch (e) {
      setUserRolesError((e as Error).message ?? t('admin.rbac.userRoles.revokeFailed'));
    }
  };

  // Group permissions by resource for the checkbox list
  const permsByResource = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {});

  // Computed outside the JSX tree rather than inline in the `subject` prop:
  // the linter's i18next rule flags any string literal appearing inside a
  // JSX attribute expression, including the `kind` discriminant here, which
  // is a type tag rather than user-facing copy.
  const historySubject: { kind: 'user' | 'role'; id: number } | null =
    historyKind === 'role'
      ? (historyRoleId !== null ? { kind: 'role', id: historyRoleId } : null)
      : (selectedUser?.id ? { kind: 'user', id: Number(selectedUser.id) } : null);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container-fluid py-4">
      <div className="row mb-4">
        <div className="col">
          <h1 className="h3 mb-0">{t('admin.rbac.title')}</h1>
          <p className="text-muted mb-0">{t('admin.rbac.subtitle')}</p>
        </div>
      </div>

      <ul className="nav nav-tabs mb-4">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('roles')}
          >
            <i className="bi bi-shield-check me-2" aria-hidden="true"></i>{t('admin.rbac.tabs.roles')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'user-roles' ? 'active' : ''}`}
            onClick={() => setActiveTab('user-roles')}
          >
            <i className="bi bi-person-badge me-2" aria-hidden="true"></i>{t('admin.rbac.tabs.userRoles')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            <i className="bi bi-clock-history me-2" aria-hidden="true"></i>{t('admin.rbac.tabs.history')}
          </button>
        </li>
      </ul>

      {/* ---- History tab ---- */}
      {activeTab === 'history' && (
        <div className="card">
          <div className="card-header d-flex align-items-center gap-3 flex-wrap">
            <span className="fw-semibold">{t('admin.rbac.history.heading')}</span>
            <div className="btn-group btn-group-sm" role="group" aria-label={t('admin.rbac.history.subjectAriaLabel')}>
              <button
                type="button"
                className={`btn btn-outline-secondary ${historyKind === 'user' ? 'active' : ''}`}
                onClick={() => setHistoryKind('user')}
              >
                {t('admin.rbac.history.byPerson')}
              </button>
              <button
                type="button"
                className={`btn btn-outline-secondary ${historyKind === 'role' ? 'active' : ''}`}
                onClick={() => setHistoryKind('role')}
              >
                {t('admin.rbac.history.byRole')}
              </button>
            </div>
            {historyKind === 'role' ? (
              <select
                className="form-select form-select-sm w-auto"
                aria-label={t('admin.rbac.history.selectRoleAriaLabel')}
                value={historyRoleId ?? ''}
                onChange={(e) => setHistoryRoleId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">{t('admin.rbac.history.selectRolePlaceholder')}</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-muted small">
                {selectedUser
                  ? t('admin.rbac.history.showingPerson', { name: `${selectedUser.firstName} ${selectedUser.lastName}` })
                  : t('admin.rbac.history.pickSomeone')}
              </span>
            )}
          </div>
          <div className="card-body">
            <RoleTimeline subject={historySubject} />
          </div>
        </div>
      )}

      {/* ---- Roles tab ---- */}
      {activeTab === 'roles' && (
        <div>
          {rolesSuccess && (
            <div className="alert alert-success alert-dismissible" role="status">
              <i className="bi bi-check-circle me-2" aria-hidden="true"></i>{rolesSuccess}
              <button type="button" className="btn-close" onClick={() => setRolesSuccess(null)} aria-label={t('common.close')}></button>
            </div>
          )}
          {rolesError && (
            <div className="alert alert-danger" role="alert">
              <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{rolesError}
            </div>
          )}

          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">{t('admin.rbac.roles.allRoles')}</h5>
            <button className="btn btn-primary btn-sm" onClick={openCreate}>
              <i className="bi bi-plus me-1" aria-hidden="true"></i>{t('admin.rbac.roles.newRole')}
            </button>
          </div>

          {rolesLoading ? (
            <div className="text-center py-4">
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
              <span className="ms-2">{t('common.loading')}</span>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover">
                <thead className="table-light">
                  <tr>
                    <th scope="col">{t('admin.rbac.roles.columns.name')}</th>
                    <th scope="col">{t('admin.rbac.roles.columns.description')}</th>
                    <th scope="col">{t('admin.rbac.roles.columns.permissions')}</th>
                    <th scope="col" className="text-center">{t('admin.rbac.roles.columns.system')}</th>
                    <th scope="col" className="text-center">{t('admin.rbac.roles.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => (
                    <tr key={role.id}>
                      <td className="fw-semibold">{role.name}</td>
                      <td className="text-muted small">{role.description ?? t('common.emptyValue')}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {(role.permissions ?? []).length === 0 ? (
                            <span className="text-muted small">{t('admin.rbac.roles.noPermissions')}</span>
                          ) : (
                            (role.permissions ?? []).slice(0, 5).map((code) => (
                              <span key={code} className="badge bg-light text-dark border font-monospace small">
                                {code}
                              </span>
                            ))
                          )}
                          {(role.permissions ?? []).length > 5 && (
                            <span className="badge bg-secondary">{t('admin.rbac.roles.morePermissions', { count: (role.permissions ?? []).length - 5 })}</span>
                          )}
                        </div>
                      </td>
                      <td className="text-center">
                        {role.isSystem ? (
                          <span className="badge bg-warning text-dark">{t('admin.rbac.roles.systemBadge')}</span>
                        ) : (
                          <span className="text-muted">{t('common.emptyValue')}</span>
                        )}
                      </td>
                      <td className="text-center">
                        <div className="btn-group btn-group-sm">
                          <button
                            className="btn btn-outline-primary"
                            onClick={() => openEdit(role)}
                            aria-label={t('admin.rbac.roles.editAriaLabel', { name: role.name })}
                          >
                            <i className="bi bi-pencil" aria-hidden="true"></i>
                          </button>
                          <button
                            className="btn btn-outline-danger"
                            onClick={() => setDeleteConfirm(role)}
                            disabled={role.isSystem}
                            aria-label={t('admin.rbac.roles.deleteAriaLabel', { name: role.name })}
                            title={role.isSystem ? t('admin.rbac.roles.systemCannotDelete') : undefined}
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
                <button type="button" className="btn-close" onClick={() => setUserRolesSuccess(null)} aria-label={t('common.close')}></button>
              </div>
            )}
            {userRolesError && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{userRolesError}
              </div>
            )}

            {/* User search */}
            <div className="card mb-4">
              <div className="card-header"><h5 className="mb-0">{t('admin.rbac.userRoles.selectEmployee')}</h5></div>
              <div className="card-body">
                <div className="position-relative">
                  <label htmlFor="employeeSearchInput" className="form-label">{t('admin.rbac.userRoles.searchLabel')}</label>
                  <input
                    id="employeeSearchInput"
                    type="text"
                    className="form-control"
                    placeholder={t('admin.rbac.userRoles.searchPlaceholder')}
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
                      onClick={() => { setSelectedUser(null); }}
                    >
                      {t('admin.rbac.userRoles.change')}
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
                    <h5 className="mb-0">{t('admin.rbac.userRoles.currentGrants')}</h5>
                  </div>
                  <div className="card-body p-0">
                    {userRolesLoading ? (
                      <div className="text-center py-3">
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                        <span className="ms-2">{t('common.loading')}</span>
                      </div>
                    ) : userRoles.length === 0 ? (
                      <p className="text-muted text-center py-3 mb-0">{t('admin.rbac.userRoles.noneAssigned')}</p>
                    ) : (
                      <table className="table table-sm table-hover mb-0">
                        <thead className="table-light">
                          <tr>
                            <th scope="col">{t('admin.rbac.userRoles.columns.role')}</th>
                            <th scope="col">{t('admin.rbac.userRoles.columns.scope')}</th>
                            <th scope="col">{t('admin.rbac.userRoles.columns.expires')}</th>
                            <th scope="col" className="text-center">{t('admin.rbac.userRoles.columns.revoke')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {userRoles.map((ur, i) => (
                            <tr key={i}>
                              <td className="fw-semibold">{ur.roleName}</td>
                              <td>
                                {ur.scopeOrgUnitId
                                  ? (orgUnits.find((u) => u.id === ur.scopeOrgUnitId)?.name ?? t('admin.rbac.userRoles.unitFallback', { id: ur.scopeOrgUnitId }))
                                  : <span className="text-muted">{t('admin.rbac.userRoles.global')}</span>}
                              </td>
                              <td>
                                {ur.expiresAt
                                  ? new Date(ur.expiresAt).toLocaleDateString()
                                  : <span className="text-muted">{t('admin.rbac.userRoles.never')}</span>}
                              </td>
                              <td className="text-center">
                                <button
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => { setRevokeTarget(ur); setRevokeJustification(''); }}
                                  aria-label={t('admin.rbac.userRoles.revokeAriaLabel', { name: ur.roleName })}
                                >
                                  {t('admin.rbac.userRoles.revokeButton')}
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
                  <div className="card-header"><h5 className="mb-0">{t('admin.rbac.userRoles.grantRole')}</h5></div>
                  <div className="card-body">
                    <form onSubmit={(e) => void handleGrant(e)}>
                      <div className="row g-3">
                        <div className="col-md-4">
                          <label htmlFor="grantRoleSelect" className="form-label">{t('admin.rbac.userRoles.roleLabel')} <span className="text-danger">*</span></label>
                          <select
                            id="grantRoleSelect"
                            className="form-select"
                            value={grantForm.roleId}
                            onChange={(e) => setGrantForm((f) => ({ ...f, roleId: e.target.value ? Number(e.target.value) : '' }))}
                            required
                          >
                            <option value="">{t('admin.rbac.userRoles.selectRolePlaceholder')}</option>
                            {roles.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-4">
                          <label htmlFor="grantScopeSelect" className="form-label">{t('admin.rbac.userRoles.scopeLabel')}</label>
                          <select
                            id="grantScopeSelect"
                            className="form-select"
                            value={grantForm.scopeOrgUnitId}
                            onChange={(e) => setGrantForm((f) => ({ ...f, scopeOrgUnitId: e.target.value ? Number(e.target.value) : '' }))}
                          >
                            <option value="">{t('admin.rbac.userRoles.globalNoScope')}</option>
                            {orgUnits.map((u) => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-md-4">
                          <label htmlFor="grantExpiresAt" className="form-label">{t('admin.rbac.userRoles.expiresAtLabel')}</label>
                          <input
                            id="grantExpiresAt"
                            type="datetime-local"
                            className="form-control"
                            value={grantForm.expiresAt}
                            onChange={(e) => setGrantForm((f) => ({ ...f, expiresAt: e.target.value }))}
                          />
                        </div>
                        <div className="col-12">
                          <label htmlFor="grantJustification" className="form-label">{t('admin.rbac.userRoles.justificationLabel')} <span className="text-muted">{t('admin.rbac.userRoles.optional')}</span></label>
                          <input
                            id="grantJustification"
                            type="text"
                            className="form-control"
                            placeholder={t('admin.rbac.userRoles.justificationPlaceholder')}
                            value={grantForm.justification}
                            onChange={(e) => setGrantForm((f) => ({ ...f, justification: e.target.value }))}
                            maxLength={1000}
                          />
                        </div>
                        <div className="col-12">
                          <button type="submit" className="btn btn-primary" disabled={granting || grantForm.roleId === ''}>
                            {granting ? (
                              <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.rbac.userRoles.granting')}</>
                            ) : (
                              <><i className="bi bi-plus me-1" aria-hidden="true"></i>{t('admin.rbac.userRoles.grantButton')}</>
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
                  {roleModal.editing ? t('admin.rbac.roleModal.editTitle', { name: roleModal.editing.name }) : t('admin.rbac.roleModal.createTitle')}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRoleModal({ open: false, editing: null })}
                  aria-label={t('admin.rbac.closeDialogAriaLabel')}
                ></button>
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label htmlFor="roleNameInput" className="form-label">{t('admin.rbac.roleModal.nameLabel')} <span className="text-danger">*</span></label>
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
                  <label htmlFor="roleDescInput" className="form-label">{t('admin.rbac.roleModal.descriptionLabel')}</label>
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
                  <label className="form-label">{t('admin.rbac.roleModal.permissionsLabel')}</label>
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
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveRole()}
                  disabled={roleSaving || !roleForm.name.trim()}
                >
                  {roleSaving ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.rbac.roleModal.saving')}</>
                  ) : (
                    roleModal.editing ? t('admin.rbac.roleModal.saveChanges') : t('admin.rbac.roleModal.createRole')
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
                <h5 className="modal-title" id="deleteRoleModalLabel">{t('admin.rbac.deleteRoleModal.title')}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDeleteConfirm(null)}
                  aria-label={t('admin.rbac.closeDialogAriaLabel')}
                ></button>
              </div>
              <div className="modal-body">
                <p>{t('admin.rbac.deleteRoleModal.prefix')} <strong>{deleteConfirm.name}</strong>? {t('admin.rbac.deleteRoleModal.suffix')}</p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete()}
                  disabled={deleting}
                >
                  {deleting ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.rbac.deleteRoleModal.deleting')}</> : t('common.delete')}
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
                <h5 className="modal-title" id="revokeModalLabel">{t('admin.rbac.revokeModal.title')}</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setRevokeTarget(null)}
                  aria-label={t('admin.rbac.closeDialogAriaLabel')}
                ></button>
              </div>
              <div className="modal-body">
                <p>
                  {t('admin.rbac.revokeModal.prefix')} <strong>{revokeTarget.roleName}</strong> {t('admin.rbac.revokeModal.from')} <strong>{selectedUser?.firstName} {selectedUser?.lastName}</strong>?
                </p>
                <label htmlFor="revokeJustificationInput" className="form-label">{t('admin.rbac.userRoles.justificationLabel')} <span className="text-muted">{t('admin.rbac.userRoles.optional')}</span></label>
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
                <button type="button" className="btn btn-secondary" onClick={() => setRevokeTarget(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmRevoke()}
                  disabled={revoking}
                >
                  {revoking ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.rbac.revokeModal.revoking')}</> : t('admin.rbac.userRoles.revokeButton')}
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
