/**
 * RbacManagement — Admin page for managing roles, permissions, and user role grants.
 *
 * Three tabs, each its own component:
 *   RolesTab       — list, create, edit (name + permission set), delete non-system roles
 *   UserRolesTab   — search employees, view current role grants, add or revoke grants
 *   RoleHistoryTab — RoleTimeline filtered by person or by role
 *
 * `selectedUser` is the one piece of state lifted here rather than owned by
 * UserRolesTab: the History tab reuses whoever is picked in the grants tab.
 *
 * Requires the `role.manage` permission; the route is protected via PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Employee } from '../../types';
import RolesTab from './RolesTab';
import UserRolesTab from './UserRolesTab';
import RoleHistoryTab from './RoleHistoryTab';

type Tab = 'roles' | 'user-roles' | 'history';

const RbacManagement: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('roles');
  const [selectedUser, setSelectedUser] = useState<Employee | null>(null);

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

      {activeTab === 'history' && <RoleHistoryTab selectedUser={selectedUser} />}
      {activeTab === 'roles' && <RolesTab />}
      {activeTab === 'user-roles' && (
        <UserRolesTab
          selectedUser={selectedUser}
          onSelectUser={setSelectedUser}
          onClearUser={() => setSelectedUser(null)}
        />
      )}
    </div>
  );
};

export default RbacManagement;
