/**
 * RoleHistoryTab — RoleTimeline filtered by person or by role. The person
 * option reuses whoever is selected in the User Roles tab (see
 * RbacManagement) rather than offering a second search: having two
 * selections for "who" on one page is how they come to disagree.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Employee, Role } from '../../types';
import RoleTimeline from './RoleTimeline';
import { useRolesAndPermissionsQuery } from '../../hooks/useRbac';

interface Props {
  selectedUser: Employee | null;
}

const RoleHistoryTab: React.FC<Props> = ({ selectedUser }) => {
  const { t } = useTranslation();
  const roles: Role[] = useRolesAndPermissionsQuery().data?.roles ?? [];
  const [historyKind, setHistoryKind] = useState<'user' | 'role'>('user');
  const [historyRoleId, setHistoryRoleId] = useState<number | null>(null);

  // Computed outside the JSX tree rather than inline in the `subject` prop:
  // the linter's i18next rule flags any string literal appearing inside a
  // JSX attribute expression, including the `kind` discriminant here, which
  // is a type tag rather than user-facing copy.
  const historySubject: { kind: 'user' | 'role'; id: number } | null =
    historyKind === 'role'
      ? (historyRoleId !== null ? { kind: 'role', id: historyRoleId } : null)
      : (selectedUser?.id ? { kind: 'user', id: Number(selectedUser.id) } : null);

  return (
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
  );
};

export default RoleHistoryTab;
