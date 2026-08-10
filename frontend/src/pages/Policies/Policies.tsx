/**
 * Policies management page.
 *
 * Three tabs:
 *   - Policies: create / list / deactivate policies (managers + admins).
 *     Renders PolicyList; its handlers and form state live in usePolicyActions.
 *   - Exceptions: filterable inbox of derogations; managers can approve/reject,
 *     requesters can cancel pending ones. Renders ExceptionList; its handlers
 *     live in useExceptionActions.
 *   - Approval matrix (admin-only): tweak which scope approves which change type
 *     and toggle the auto-approve-for-owner shortcut. Renders ApprovalMatrixTab.
 *
 * The error banner and confirm modal are shared across tabs and stay here.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { policiesKey, usePoliciesPageData } from '../../hooks/usePolicies';
import PolicyList from '../Policies/PolicyList';
import ExceptionList from '../Policies/ExceptionList';
import ApprovalMatrixTab from './ApprovalMatrixTab';
import { usePolicyActions } from './usePolicyActions';
import { useExceptionActions } from './useExceptionActions';
import ConfirmModal from '../../components/ConfirmModal';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';

type Tab = 'policies' | 'exceptions' | 'matrix';

interface ConfirmState {
  show: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

const EMPTY_CONFIRM: ConfirmState = { show: false, title: '', message: '', onConfirm: () => undefined };

const Policies: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.permissions?.includes('policy.manage');
  const isManager =
    user?.permissions?.includes('policy.manage') ||
    user?.permissions?.includes('policy.read');

  const [activeTab, setActiveTab] = useState<Tab>('policies');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(EMPTY_CONFIRM);
  const queryClient = useQueryClient();

  // Server state via one composite query; the action hooks below keep calling
  // refresh(), which invalidates the cached page data so all four lists
  // reload together as before.
  const pageQuery = usePoliciesPageData(!!isAdmin);
  const policies = pageQuery.data?.policies ?? [];
  const exceptions = pageQuery.data?.exceptions ?? [];
  const matrix = pageQuery.data?.matrix ?? [];
  const roles = pageQuery.data?.roles ?? [];
  const presets = pageQuery.data?.presets ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: policiesKey });

  const policyActions = usePolicyActions(!!isManager, !!isAdmin, presets, refresh, setError, setConfirm);
  const exceptionActions = useExceptionActions(refresh, setError);

  return (
    <div className="container-fluid py-3">
      <h1 className="h3 mb-3">{t('policies.title')}</h1>

      {error && <ErrorAlert message={error} />}

      <QueryState
        isLoading={pageQuery.isLoading}
        isError={pageQuery.isError}
        error={pageQuery.error}
        onRetry={() => pageQuery.refetch()}
        loadingMessage={t('policies.loading')}
      >
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
          >
            {t('policies.tabs.policies')}
          </button>
        </li>
        <li className="nav-item">
          <button
            className={`nav-link ${activeTab === 'exceptions' ? 'active' : ''}`}
            onClick={() => setActiveTab('exceptions')}
          >
            {t('policies.tabs.exceptions')}
          </button>
        </li>
        {isAdmin && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              {t('policies.tabs.matrix')}
            </button>
          </li>
        )}
      </ul>

      {activeTab === 'policies' && isAdmin && presets.length > 0 && (
        <div className="card mb-3">
          <div className="card-body d-flex align-items-center gap-2">
            <label className="form-label mb-0 me-2" htmlFor="compliance-preset-select">
              {t('policies.preset.title')}
            </label>
            <select
              id="compliance-preset-select"
              className="form-select form-select-sm w-auto"
              value={policyActions.selectedPreset}
              onChange={(e) => policyActions.setSelectedPreset(e.target.value)}
              disabled={policyActions.busy}
            >
              <option value="">{t('policies.preset.choose')}</option>
              {presets.map((p) => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-outline-primary"
              disabled={policyActions.busy || !policyActions.selectedPreset}
              onClick={policyActions.handleApplyPreset}
            >
              {t('policies.preset.load')}
            </button>
            {policyActions.selectedPreset && (
              <span className="text-muted small">
                {presets.find((p) => p.key === policyActions.selectedPreset)?.description}
              </span>
            )}
          </div>
        </div>
      )}

      {activeTab === 'policies' && (
        <PolicyList
          policies={policies}
          busy={policyActions.busy}
          canManage={!!isManager}
          currentUserId={user?.id}
          isAdmin={!!isAdmin}
          policyForm={policyActions.policyForm}
          onFormChange={policyActions.setPolicyForm}
          onCreatePolicy={policyActions.handleCreatePolicy}
          onToggleActive={policyActions.handleTogglePolicyActive}
          onDeletePolicy={policyActions.handleDeletePolicy}
        />
      )}

      {activeTab === 'exceptions' && (
        <ExceptionList
          exceptions={exceptions}
          policies={policies}
          busy={exceptionActions.busy}
          isManager={!!isManager}
          currentUserId={user?.id}
          exceptionForm={exceptionActions.exceptionForm}
          onFormChange={exceptionActions.setExceptionForm}
          onCreateException={exceptionActions.handleCreateException}
          onApprove={exceptionActions.handleApproveException}
          onReject={exceptionActions.handleRejectException}
          onCancel={exceptionActions.handleCancelException}
        />
      )}

      {activeTab === 'matrix' && isAdmin && (
        <ApprovalMatrixTab
          matrix={matrix}
          roles={roles}
          busy={policyActions.busy}
          onChange={policyActions.handleMatrixChange}
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

export default Policies;
