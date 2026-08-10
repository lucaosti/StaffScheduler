/**
 * UserRolesTab — search employees, view current role grants, add or revoke
 * grants. Self-contained except for `selectedUser`, which is lifted to
 * RbacManagement because the History tab reuses whoever is picked here.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Employee, UserRoleAssignment } from '../../types';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import ButtonSpinner from '../../components/ButtonSpinner';
import {
  useRolesAndPermissionsQuery,
  useRbacOrgUnitsQuery,
  useEmployeeSearchQuery,
  useUserRolesQuery,
  useUserRoleMutations,
} from '../../hooks/useRbac';

interface Props {
  selectedUser: Employee | null;
  onSelectUser: (emp: Employee) => void;
  onClearUser: () => void;
}

const UserRolesTab: React.FC<Props> = ({ selectedUser, onSelectUser, onClearUser }) => {
  const { t } = useTranslation();

  const roles = useRolesAndPermissionsQuery().data?.roles ?? [];

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [actionError, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Server state via TanStack Query: org units, a debounced employee search, and
  // the selected user's roles (both gated on their input via enabled).
  const orgUnits = useRbacOrgUnitsQuery().data ?? [];
  const debouncedEmployeeSearch = useDebouncedValue(employeeSearch, 300);
  const employeeSearchQuery = useEmployeeSearchQuery(debouncedEmployeeSearch);
  const employees = employeeSearchQuery.data ?? [];
  const empLoading = employeeSearchQuery.isFetching;
  const userRolesQuery = useUserRolesQuery(selectedUser?.id ? Number(selectedUser.id) : null);
  const userRoles = userRolesQuery.data ?? [];
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

  const handleSelectUser = (emp: Employee) => {
    // Clearing the search disables the employee-search query (hiding results);
    // setting the user drives the user-roles query.
    setEmployeeSearch('');
    setSuccess(null);
    setError(null);
    onSelectUser(emp);
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser || grantForm.roleId === '') return;
    setError(null);
    setSuccess(null);
    try {
      await grantRole.mutateAsync({
        userId: Number(selectedUser.id),
        roleId: Number(grantForm.roleId),
        scopeOrgUnitId: grantForm.scopeOrgUnitId !== '' ? Number(grantForm.scopeOrgUnitId) : null,
        expiresAt: grantForm.expiresAt || null,
        justification: grantForm.justification || undefined,
      });
      setGrantForm({ roleId: '', scopeOrgUnitId: '', expiresAt: '', justification: '' });
      setSuccess(t('admin.rbac.userRoles.grantedMessage'));
    } catch (e) {
      setError((e as Error).message ?? t('admin.rbac.userRoles.grantFailed'));
    }
  };

  const confirmRevoke = async () => {
    if (!selectedUser || !revokeTarget) return;
    setError(null);
    setSuccess(null);
    try {
      await revokeRole.mutateAsync({
        userId: Number(selectedUser.id),
        roleId: revokeTarget.roleId,
        scopeOrgUnitId: revokeTarget.scopeOrgUnitId,
        justification: revokeJustification || undefined,
      });
      setSuccess(t('admin.rbac.userRoles.revokedMessage', { name: revokeTarget.roleName }));
      setRevokeTarget(null);
      setRevokeJustification('');
    } catch (e) {
      setError((e as Error).message ?? t('admin.rbac.userRoles.revokeFailed'));
    }
  };

  return (
    <div className="row">
      <div className="col-lg-10">
        {success && (
          <div className="alert alert-success alert-dismissible" role="status">
            <i className="bi bi-check-circle me-2" aria-hidden="true"></i>{success}
            <button type="button" className="btn-close" onClick={() => setSuccess(null)} aria-label={t('common.close')}></button>
          </div>
        )}
        {actionError && <ErrorAlert message={actionError} />}

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
                <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={onClearUser}>
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
                <QueryState
                  isLoading={userRolesQuery.isLoading}
                  isError={userRolesQuery.isError}
                  error={userRolesQuery.error}
                  onRetry={() => userRolesQuery.refetch()}
                  isEmpty={userRoles.length === 0}
                  empty={<p className="text-muted text-center py-3 mb-0">{t('admin.rbac.userRoles.noneAssigned')}</p>}
                >
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
                </QueryState>
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
                          <><ButtonSpinner />{t('admin.rbac.userRoles.granting')}</>
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
                  {revoking ? <><ButtonSpinner />{t('admin.rbac.revokeModal.revoking')}</> : t('admin.rbac.userRoles.revokeButton')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserRolesTab;
