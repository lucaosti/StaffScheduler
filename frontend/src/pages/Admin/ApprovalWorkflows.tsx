/**
 * ApprovalWorkflows — Admin configuration page for multi-step approval workflows.
 *
 * Each workflow ties a change type (e.g. "TimeOff.Request") to an ordered list
 * of approver steps. Steps can delegate to a unit manager, the manager chain,
 * a specific company role, or a specific user.
 *
 * The list (with its inline step viewer) lives in WorkflowTable; the
 * create/edit form and step editor live in WorkflowModal. This file owns the
 * query wiring and the modal-open/delete-confirm state.
 *
 * Requires `approval.manage` permission; the route is protected via PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApprovalWorkflow, CreateWorkflowBody } from '../../services/approvalWorkflowService';
import { useApprovalWorkflowsQuery, useApprovalWorkflowMutations } from '../../hooks/useApprovalWorkflows';
import WorkflowTable from './WorkflowTable';
import WorkflowModal, { type WorkflowUpdatePayload } from './WorkflowModal';
import QueryState from '../../components/QueryState';
import ErrorAlert from '../../components/ErrorAlert';

const ApprovalWorkflows: React.FC = () => {
  const { t } = useTranslation();
  const [actionError, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApprovalWorkflow | null>(null);

  const workflowsQuery = useApprovalWorkflowsQuery();
  const workflows = workflowsQuery.data ?? [];
  const { create, update, remove } = useApprovalWorkflowMutations();
  const saving = create.isPending || update.isPending;
  const deleting = remove.isPending;

  const openCreate = () => {
    setModalMode('create');
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (w: ApprovalWorkflow) => {
    setModalMode('edit');
    setEditing(w);
    setShowModal(true);
  };

  const handleCreate = async (body: CreateWorkflowBody) => {
    await create.mutateAsync(body);
    setShowModal(false);
  };

  const handleUpdate = async (id: number, body: WorkflowUpdatePayload) => {
    await update.mutateAsync({ id, ...body });
    setShowModal(false);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
    } catch (e) {
      setError((e as Error).message ?? t('admin.approvalWorkflows.errors.deleteFailed'));
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('admin.approvalWorkflows.title')}</h1>
            <p className="text-muted mb-0 small">{t('admin.approvalWorkflows.subtitle')}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <i className="bi bi-plus-lg me-1" aria-hidden="true"></i>{t('admin.approvalWorkflows.newWorkflow')}
          </button>
        </div>
      </div>

      {actionError && <ErrorAlert message={actionError} />}

      <div className="card">
        <div className="card-body p-0">
          <QueryState
            isLoading={workflowsQuery.isLoading}
            isError={workflowsQuery.isError}
            error={workflowsQuery.error}
            onRetry={() => workflowsQuery.refetch()}
            isEmpty={workflows.length === 0}
            empty={<div className="text-center text-muted py-5">{t('admin.approvalWorkflows.empty')}</div>}
          >
            <WorkflowTable workflows={workflows} onEdit={openEdit} onDelete={setDeleteTarget} />
          </QueryState>
        </div>
      </div>

      <WorkflowModal
        show={showModal}
        mode={modalMode}
        editing={editing}
        saving={saving}
        onClose={() => setShowModal(false)}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
      />

      {/* Delete Confirm Modal */}
      {deleteTarget && (
        <div className="modal d-block" tabIndex={-1} role="dialog" aria-modal="true">
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{t('admin.approvalWorkflows.deleteModal.title')}</h5>
                <button type="button" className="btn-close" aria-label={t('common.close')} onClick={() => setDeleteTarget(null)}></button>
              </div>
              <div className="modal-body">
                {t('admin.approvalWorkflows.deleteModal.confirmPrefix')} <strong>{deleteTarget.changeType}</strong>?
                <p className="mt-2 text-muted small">
                  {t('admin.approvalWorkflows.deleteModal.warning')}
                </p>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  aria-label={t('admin.approvalWorkflows.deleteModal.confirmAriaLabel', { changeType: deleteTarget.changeType })}
                >
                  {deleting ? (
                    <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>{t('admin.approvalWorkflows.deleteModal.deleting')}</>
                  ) : t('common.delete')}
                </button>
              </div>
            </div>
          </div>
          <div className="modal-backdrop fade show"></div>
        </div>
      )}
    </div>
  );
};

export default ApprovalWorkflows;
