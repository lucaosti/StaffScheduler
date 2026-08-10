/**
 * RolesTab — list, create, edit (name + permission set), delete non-system
 * roles. Self-contained: owns its own query, mutations, and modal state.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission, Role } from '../../types';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';
import { useRolesAndPermissionsQuery, useRoleMutations } from '../../hooks/useRbac';

interface RoleFormState {
  name: string;
  description: string;
  permissionCodes: string[];
}

const EMPTY_FORM: RoleFormState = { name: '', description: '', permissionCodes: [] };

const RolesTab: React.FC = () => {
  const { t } = useTranslation();

  const rolesQuery = useRolesAndPermissionsQuery();
  const roles = rolesQuery.data?.roles ?? [];
  const permissions = rolesQuery.data?.permissions ?? [];
  const [actionError, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { create: createRole, update: updateRole, remove: deleteRole } = useRoleMutations();
  const saving = createRole.isPending || updateRole.isPending;
  const deleting = deleteRole.isPending;

  const [modal, setModal] = useState<{ open: boolean; editing: Role | null }>({
    open: false,
    editing: null,
  });
  const [form, setForm] = useState<RoleFormState>(EMPTY_FORM);
  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setModal({ open: true, editing: null });
  };

  const openEdit = (role: Role) => {
    setForm({
      name: role.name,
      description: role.description ?? '',
      permissionCodes: role.permissions ?? [],
    });
    setModal({ open: true, editing: role });
  };

  const togglePermission = (code: string) => {
    setForm((prev) => ({
      ...prev,
      permissionCodes: prev.permissionCodes.includes(code)
        ? prev.permissionCodes.filter((c) => c !== code)
        : [...prev.permissionCodes, code],
    }));
  };

  const saveRole = async () => {
    if (!form.name.trim()) return;
    setError(null);
    setSuccess(null);
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        permissionCodes: form.permissionCodes,
      };
      if (modal.editing) {
        await updateRole.mutateAsync({ id: modal.editing.id, ...body });
        setSuccess(t('admin.rbac.roles.updatedMessage', { name: form.name }));
      } else {
        await createRole.mutateAsync(body);
        setSuccess(t('admin.rbac.roles.createdMessage', { name: form.name }));
      }
      setModal({ open: false, editing: null });
    } catch (e) {
      setError((e as Error).message ?? t('admin.rbac.roles.saveFailed'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setError(null);
    setSuccess(null);
    try {
      await deleteRole.mutateAsync(deleteConfirm.id);
      setSuccess(t('admin.rbac.roles.deletedMessage', { name: deleteConfirm.name }));
      setDeleteConfirm(null);
    } catch (e) {
      setError((e as Error).message ?? t('admin.rbac.roles.deleteFailed'));
      setDeleteConfirm(null);
    }
  };

  // Group permissions by resource for the checkbox list
  const permsByResource = permissions.reduce<Record<string, Permission[]>>((acc, p) => {
    if (!acc[p.resource]) acc[p.resource] = [];
    acc[p.resource].push(p);
    return acc;
  }, {});

  return (
    <div>
      {success && (
        <div className="alert alert-success alert-dismissible" role="status">
          <i className="bi bi-check-circle me-2" aria-hidden="true"></i>{success}
          <button type="button" className="btn-close" onClick={() => setSuccess(null)} aria-label={t('common.close')}></button>
        </div>
      )}
      {actionError && <ErrorAlert message={actionError} />}

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0">{t('admin.rbac.roles.allRoles')}</h5>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          <i className="bi bi-plus me-1" aria-hidden="true"></i>{t('admin.rbac.roles.newRole')}
        </button>
      </div>

      <QueryState
        isLoading={rolesQuery.isLoading}
        isError={rolesQuery.isError}
        error={rolesQuery.error}
        onRetry={() => rolesQuery.refetch()}
        isEmpty={roles.length === 0}
        empty={<p className="text-muted text-center py-4 mb-0">{t('admin.rbac.roles.noRoles', 'No roles yet.')}</p>}
      >
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
      </QueryState>

      {/* ---- Role create/edit modal ---- */}
      {modal.open && (
        <div className="modal d-block" role="dialog" aria-modal="true" aria-labelledby="roleModalLabel">
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title" id="roleModalLabel">
                  {modal.editing ? t('admin.rbac.roleModal.editTitle', { name: modal.editing.name }) : t('admin.rbac.roleModal.createTitle')}
                </h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setModal({ open: false, editing: null })}
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
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    disabled={modal.editing?.isSystem}
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
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
                              checked={form.permissionCodes.includes(p.code)}
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
                  onClick={() => setModal({ open: false, editing: null })}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveRole()}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.rbac.roleModal.saving')}</>
                  ) : (
                    modal.editing ? t('admin.rbac.roleModal.saveChanges') : t('admin.rbac.roleModal.createRole')
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
    </div>
  );
};

export default RolesTab;
