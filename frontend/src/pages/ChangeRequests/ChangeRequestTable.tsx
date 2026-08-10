/**
 * ChangeRequestTable — the change-request list, with an inline expandable
 * row showing justification, rejection reason, and proposed payload. See
 * ChangeRequests.tsx.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangeRequest, ChangeRequestStatus } from '../../services/changeRequestService';

const STATUS_BADGE: Record<ChangeRequestStatus, string> = {
  pending: 'bg-warning text-dark',
  approved: 'bg-success',
  rejected: 'bg-danger',
  applied: 'bg-primary',
  cancelled: 'bg-secondary',
};

const STATUS_LABEL_KEYS: Record<ChangeRequestStatus, string> = {
  pending: 'changeRequests.status.pending',
  approved: 'changeRequests.status.approved',
  rejected: 'changeRequests.status.rejected',
  applied: 'changeRequests.status.applied',
  cancelled: 'changeRequests.status.cancelled',
};

const formatDate = (iso: string | null, emptyValue: string) => {
  if (!iso) return emptyValue;
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

interface Props {
  items: ChangeRequest[];
  canReview: boolean;
  onReview: (item: ChangeRequest, mode: 'approve' | 'reject') => void;
  onCancel: (item: ChangeRequest) => void;
}

const ChangeRequestTable: React.FC<Props> = ({ items, canReview, onReview, onCancel }) => {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="table-responsive">
      <table className="table table-hover mb-0">
        <thead className="table-light">
          <tr>
            <th scope="col">#</th>
            <th scope="col">{t('changeRequests.columns.changeType')}</th>
            <th scope="col">{t('changeRequests.columns.entity')}</th>
            <th scope="col">{t('changeRequests.columns.status')}</th>
            <th scope="col">{t('changeRequests.columns.submitted')}</th>
            <th scope="col" className="text-end">{t('changeRequests.columns.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <React.Fragment key={item.id}>
              <tr>
                <td className="text-muted small">{item.id}</td>
                <td>
                  <button
                    className="btn btn-link btn-sm p-0 text-decoration-none fw-semibold text-start"
                    onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                    aria-label={expandedId === item.id
                      ? t('changeRequests.collapseAriaLabel', { id: item.id })
                      : t('changeRequests.expandAriaLabel', { id: item.id })}
                  >
                    {item.changeType}
                    <i className={`bi ms-1 ${expandedId === item.id ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true"></i>
                  </button>
                </td>
                <td className="small text-muted">
                  {item.targetEntityType}
                  {item.targetEntityId != null && ` #${item.targetEntityId}`}
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[item.status]}`}>{t(STATUS_LABEL_KEYS[item.status])}</span>
                </td>
                <td className="small text-muted text-nowrap">{formatDate(item.createdAt, t('common.emptyValue'))}</td>
                <td className="text-end">
                  {canReview && item.status === 'pending' && (
                    <>
                      <button
                        className="btn btn-sm btn-success me-1"
                        onClick={() => onReview(item, 'approve')}
                        aria-label={t('changeRequests.approveAriaLabel', { id: item.id })}
                      >
                        <i className="bi bi-check" aria-hidden="true"></i>
                      </button>
                      <button
                        className="btn btn-sm btn-danger me-1"
                        onClick={() => onReview(item, 'reject')}
                        aria-label={t('changeRequests.rejectAriaLabel', { id: item.id })}
                      >
                        <i className="bi bi-x" aria-hidden="true"></i>
                      </button>
                    </>
                  )}
                  {item.status === 'pending' && (
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => onCancel(item)}
                      aria-label={t('changeRequests.cancelAriaLabel', { id: item.id })}
                    >
                      <i className="bi bi-slash-circle" aria-hidden="true"></i>
                    </button>
                  )}
                </td>
              </tr>
              {expandedId === item.id && (
                <tr>
                  <td colSpan={6} className="bg-light border-top-0">
                    <div className="p-3">
                      {item.justification && (
                        <div className="mb-2">
                          <span className="fw-semibold small text-muted text-uppercase me-2">{t('changeRequests.justification')}</span>
                          <span className="small">{item.justification}</span>
                        </div>
                      )}
                      {item.rejectionReason && (
                        <div className="mb-2">
                          <span className="fw-semibold small text-danger text-uppercase me-2">{t('changeRequests.rejectionReason')}</span>
                          <span className="small">{item.rejectionReason}</span>
                        </div>
                      )}
                      <div>
                        <span className="fw-semibold small text-muted text-uppercase me-2">{t('changeRequests.proposedPayload')}</span>
                        <pre className="bg-white border rounded p-2 small mb-0" style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}>
                          {JSON.stringify(item.proposedPayload, null, 2)}
                        </pre>
                      </div>
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

export default ChangeRequestTable;
