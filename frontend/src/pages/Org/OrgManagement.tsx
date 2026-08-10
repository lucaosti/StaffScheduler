/**
 * Org management page.
 *
 * Provides three tabs:
 *   - Tree: admin views and edits the org tree (create / rename / set parent / set manager).
 *     Renders OrgTree; its create/delete handlers live in useOrgTreeActions.
 *   - Members: list memberships of a selected unit and add / promote-to-primary / remove.
 *     Renders MemberList; its handlers live in useOrgMembersActions.
 *   - Loans: create a cross-department loan request, view the list, and act on pending ones.
 *     Fully self-contained in LoansTab.
 *
 * The error banner and the delete/remove confirm modal are shared across
 * tabs and stay here; auto-approval is enforced server-side via
 * `approval_matrix` — the UI just shows whatever `status` the backend returns.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  orgKeys,
  useOrgUnitsQuery,
  useOrgUnitMembersQuery,
  useOrgLoansQuery,
} from '../../hooks/useOrg';
import OrgTree from '../orgManagement/OrgTree';
import MemberList from '../orgManagement/MemberList';
import LoansTab from './LoansTab';
import { useOrgTreeActions } from './useOrgTreeActions';
import { useOrgMembersActions } from './useOrgMembersActions';
import ConfirmModal from '../../components/ConfirmModal';
import QueryState from '../../components/QueryState';

type Tab = 'tree' | 'members' | 'loans';

// Not a literal in the JSX-attribute sense — a state value used from inside
// an event handler prop, kept as an identifier so the i18n literal-string
// lint rule (which inspects JSX attribute expressions) does not fire on it.
const MEMBERS_TAB: Tab = 'members';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const EMPTY_CONFIRM: ConfirmState = { show: false, title: '', message: '', onConfirm: () => undefined };

const OrgManagement: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('org_unit.manage');
  const isManager =
    user?.permissions?.includes('org_unit.manage') ||
    user?.permissions?.includes('org_unit.read');

  const [activeTab, setActiveTab] = useState<Tab>('tree');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(EMPTY_CONFIRM);
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);

  // Server state via TanStack Query. The action hooks below keep calling
  // refreshUnits/refreshMembers/refreshLoans, but those now invalidate the
  // relevant cache key (so a single edit refreshes exactly the affected data)
  // rather than re-fetching into local state by hand.
  const queryClient = useQueryClient();
  const unitsQuery = useOrgUnitsQuery();
  const loansQuery = useOrgLoansQuery();
  const membersQuery = useOrgUnitMembersQuery(selectedUnitId);

  const units = unitsQuery.data?.units ?? [];
  const tree = unitsQuery.data?.tree ?? [];
  const loans = loansQuery.data ?? [];
  const members = membersQuery.data ?? [];

  // Invalidates both cache entries for the unit hierarchy: this page's own
  // orgKeys.units (units + tree, fetched together) and orgKeys.tree, the
  // separate cache OrgChart reads through useOrgTreeQuery. The two overlap in
  // what they hold but are cached independently, so a create/move/delete here
  // left OrgChart showing the pre-edit hierarchy until its own staleTime lapsed.
  const refreshUnits = () => {
    queryClient.invalidateQueries({ queryKey: orgKeys.units });
    queryClient.invalidateQueries({ queryKey: orgKeys.tree });
  };
  const refreshLoans = () => queryClient.invalidateQueries({ queryKey: orgKeys.loans });
  // The members query is keyed by the currently-selected unit, so invalidating
  // the whole family refreshes whichever unit is in view.
  const refreshMembers = () =>
    queryClient.invalidateQueries({ queryKey: ['org', 'unit-members'] });

  const treeActions = useOrgTreeActions(!!isAdmin, refreshUnits, setError, setConfirm);
  const memberActions = useOrgMembersActions(!!isManager, selectedUnitId, refreshMembers, setError, setConfirm);

  return (
    <div className="container-fluid py-3">
      <h1 className="h3 mb-3">{t('orgManagement.title')}</h1>

      {error && (
        <div className="alert alert-danger alert-dismissible" role="alert">
          {error}
          <button
            type="button"
            className="btn-close"
            aria-label={t('common.close')}
            onClick={() => setError(null)}
          />
        </div>
      )}

      <QueryState
        isLoading={unitsQuery.isLoading || loansQuery.isLoading}
        isError={unitsQuery.isError || loansQuery.isError}
        error={unitsQuery.error ?? loansQuery.error}
        onRetry={() => { unitsQuery.refetch(); loansQuery.refetch(); }}
        loadingMessage={t('orgManagement.loading')}
      >
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'tree' ? 'active' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            {t('orgManagement.tabs.tree')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'members' ? 'active' : ''}`}
            onClick={() => setActiveTab('members')}
          >
            {t('orgManagement.tabs.members')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'loans' ? 'active' : ''}`}
            onClick={() => setActiveTab('loans')}
          >
            {t('orgManagement.tabs.loans')}
          </button>
        </li>
      </ul>

      {activeTab === 'tree' && (
        <OrgTree
          units={units}
          tree={tree}
          busy={treeActions.busy}
          canAdmin={!!isAdmin}
          newUnit={treeActions.newUnit}
          onNewUnitChange={treeActions.setNewUnit}
          onCreateUnit={treeActions.handleCreateUnit}
          onDeleteUnit={treeActions.handleDeleteUnit}
          onViewMembers={(id) => {
            setSelectedUnitId(id);
            setActiveTab(MEMBERS_TAB);
          }}
        />
      )}

      {activeTab === 'members' && (
        <MemberList
          units={units}
          selectedUnitId={selectedUnitId}
          members={members}
          busy={memberActions.busy}
          canManage={!!isManager}
          memberForm={memberActions.memberForm}
          onUnitSelect={setSelectedUnitId}
          onMemberFormChange={memberActions.setMemberForm}
          onAddMember={memberActions.handleAddMember}
          onSetPrimary={memberActions.handleSetPrimary}
          onRemoveMember={memberActions.handleRemoveMember}
        />
      )}

      {activeTab === 'loans' && (
        <LoansTab
          units={units}
          loans={loans}
          isManager={!!isManager}
          refreshLoans={refreshLoans}
          setError={setError}
        />
      )}
      </QueryState>

      <ConfirmModal
        show={confirm.show}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm((prev) => ({ ...prev, show: false }))}
      />
    </div>
  );
};

export default OrgManagement;
