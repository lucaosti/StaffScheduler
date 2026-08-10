/**
 * Governance page.
 *
 * Two tabs, each its own component:
 *   - ResponsibilityMatrixTab: configure who is responsible for what over
 *     which subject group.  Visible to users with `responsibility.read`;
 *     editable by users with `responsibility.manage`.
 *   - ChangeRequestsTab: list, review and act on subordinate change proposals.
 *     Visible to reviewers (`change_request.review`) and to all authenticated
 *     users who have submitted a request (they can see their own via the
 *     dedicated "My requests" filter).
 *
 * The pending-count badge on the Change Requests tab is the one piece of
 * state lifted here: the tab reports it back via a callback rather than the
 * nav reaching into the tab's own query.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import ResponsibilityMatrixTab from './ResponsibilityMatrixTab';
import ChangeRequestsTab from './ChangeRequestsTab';

type Tab = 'matrix' | 'changeRequests';

const Governance: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canManageMatrix = user?.permissions?.includes('responsibility.manage') ?? false;
  const canReadMatrix = user?.permissions?.includes('responsibility.read') ?? false;
  const canReview = user?.permissions?.includes('change_request.review') ?? false;
  const canCreate = user?.permissions?.includes('change_request.create') ?? false;

  const defaultTab: Tab = canReadMatrix ? 'matrix' : 'changeRequests';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const [pendingCrTotal, setPendingCrTotal] = useState<number | null>(null);

  return (
    <div className="governance-page">
      <div className="page-header">
        <h1>{t('governance.title')}</h1>
        <p className="text-muted">{t('governance.subtitle')}</p>
      </div>

      <ul className="nav nav-tabs mb-4">
        {canReadMatrix && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'matrix' ? 'active' : ''}`}
              onClick={() => setActiveTab('matrix')}
            >
              <i className="bi bi-table me-2" />
              {t('governance.tabs.matrix')}
            </button>
          </li>
        )}
        {(canReview || canCreate) && (
          <li className="nav-item">
            <button
              className={`nav-link ${activeTab === 'changeRequests' ? 'active' : ''}`}
              onClick={() => setActiveTab('changeRequests')}
            >
              <i className="bi bi-pencil-square me-2" />
              {t('governance.tabs.changeRequests')}
              {pendingCrTotal !== null && pendingCrTotal > 0 && (
                <span className="badge bg-warning text-dark ms-2">{pendingCrTotal}</span>
              )}
            </button>
          </li>
        )}
      </ul>

      {activeTab === 'matrix' && canReadMatrix && (
        <ResponsibilityMatrixTab canManage={canManageMatrix} />
      )}

      {activeTab === 'changeRequests' && (canReview || canCreate) && (
        <ChangeRequestsTab
          canReview={canReview}
          canCreate={canCreate}
          onPendingTotalChange={setPendingCrTotal}
        />
      )}
    </div>
  );
};

export default Governance;
