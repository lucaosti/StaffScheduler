/**
 * WorkflowTable — the approval-workflow list, with an inline expandable row
 * showing each workflow's ordered steps. See ApprovalWorkflows.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalWorkflow, ApproverScope } from '../../services/approvalWorkflowService';

export const SCOPE_LABEL_KEYS: Record<ApproverScope, string> = {
  policy_owner: 'admin.approvalWorkflows.scopes.policyOwner',
  unit_manager: 'admin.approvalWorkflows.scopes.unitManager',
  unit_manager_chain: 'admin.approvalWorkflows.scopes.managerChain',
  company_role: 'admin.approvalWorkflows.scopes.companyRole',
  company_user: 'admin.approvalWorkflows.scopes.specificUser',
};

interface Props {
  workflows: ApprovalWorkflow[];
  onEdit: (w: ApprovalWorkflow) => void;
  onDelete: (w: ApprovalWorkflow) => void;
}

const WorkflowTable: React.FC<Props> = ({ workflows, onEdit, onDelete }) => {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="table-responsive">
      <table className="table table-hover mb-0">
        <thead className="table-light">
          <tr>
            <th scope="col">{t('admin.approvalWorkflows.columns.changeType')}</th>
            <th scope="col">{t('admin.approvalWorkflows.columns.steps')}</th>
            <th scope="col">{t('admin.approvalWorkflows.columns.requireAll')}</th>
            <th scope="col">{t('admin.approvalWorkflows.columns.description')}</th>
            <th scope="col" className="text-end">{t('admin.approvalWorkflows.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {workflows.map((w) => (
            <React.Fragment key={w.id}>
              <tr>
                <td className="font-monospace small fw-semibold">{w.changeType}</td>
                <td>
                  <button
                    className="btn btn-link btn-sm p-0 text-decoration-none"
                    onClick={() => setExpandedId(expandedId === w.id ? null : w.id)}
                    aria-label={expandedId === w.id
                      ? t('admin.approvalWorkflows.collapseStepsAriaLabel', { changeType: w.changeType })
                      : t('admin.approvalWorkflows.showStepsAriaLabel', { changeType: w.changeType })}
                  >
                    {t(w.steps.length === 1 ? 'admin.approvalWorkflows.stepsCount_one' : 'admin.approvalWorkflows.stepsCount_other', { count: w.steps.length })}
                    <i
                      className={`bi ms-1 ${expandedId === w.id ? 'bi-chevron-up' : 'bi-chevron-down'}`}
                      aria-hidden="true"
                    ></i>
                  </button>
                </td>
                <td>
                  {w.requireAll ? (
                    <span className="badge bg-primary">{t('admin.approvalWorkflows.requireAll.all')}</span>
                  ) : (
                    <span className="badge bg-secondary">{t('admin.approvalWorkflows.requireAll.any')}</span>
                  )}
                </td>
                <td className="text-muted small">{w.description ?? t('common.emptyValue')}</td>
                <td className="text-end">
                  <button
                    className="btn btn-sm btn-outline-secondary me-1"
                    onClick={() => onEdit(w)}
                    aria-label={t('admin.approvalWorkflows.editAriaLabel', { changeType: w.changeType })}
                  >
                    <i className="bi bi-pencil" aria-hidden="true"></i>
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => onDelete(w)}
                    aria-label={t('admin.approvalWorkflows.deleteAriaLabel', { changeType: w.changeType })}
                  >
                    <i className="bi bi-trash" aria-hidden="true"></i>
                  </button>
                </td>
              </tr>
              {expandedId === w.id && (
                <tr>
                  <td colSpan={5} className="bg-light border-top-0">
                    <div className="p-3">
                      <h6 className="small fw-semibold text-uppercase text-muted mb-2">{t('admin.approvalWorkflows.stepsHeading')}</h6>
                      {w.steps.length === 0 ? (
                        <span className="text-muted small">{t('admin.approvalWorkflows.noStepsDefined')}</span>
                      ) : (
                        <ol className="mb-0 small">
                          {w.steps.map((s) => (
                            <li key={s.id}>
                              <span className="badge bg-secondary me-2">{t(SCOPE_LABEL_KEYS[s.approverScope])}</span>
                              {s.approverRoleId != null && <span className="me-2 text-muted">{t('admin.approvalWorkflows.rolePrefix', { id: s.approverRoleId })}</span>}
                              {s.approverUserId != null && <span className="me-2 text-muted">{t('admin.approvalWorkflows.userPrefix', { id: s.approverUserId })}</span>}
                              {s.autoApproveForOwner && <span className="badge bg-success me-2">{t('admin.approvalWorkflows.autoApproveBadge')}</span>}
                              {s.escalateAfterHours != null && (
                                <span className="text-muted">{t('admin.approvalWorkflows.escalateAfter', { hours: s.escalateAfterHours })}</span>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default WorkflowTable;
