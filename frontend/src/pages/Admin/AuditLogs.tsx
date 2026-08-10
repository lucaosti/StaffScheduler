/**
 * Audit log viewer — the read surface over `audit_logs`.
 *
 * WHY THE FILTER STATE IS ALL STRINGS. The form binds directly to `<input>`
 * values, and an empty text field is `''`, not `undefined`. Keeping the local
 * state as strings and converting only at query time means one place performs
 * the "empty means no filter" decision, rather than every field handler having
 * to decide whether a cleared box should send an empty value or omit the
 * parameter. `userId` in particular must be omitted rather than sent as `0`,
 * which would filter to a user that does not exist and show nothing.
 *
 * WHY EXPORT IS A LINK AND NOT A FETCH. `buildExportUrl` produces an href the
 * browser follows, so the download is handled natively — with the file name,
 * progress and cancellation the browser provides — instead of being buffered
 * into memory here. The export endpoint refuses rather than truncates when the
 * result would be too large, on the grounds that a partial audit export which
 * looks complete is worse than an error.
 *
 * THE ACTOR COLUMN IS THE POINT OF THIS SCREEN, AND IT WAS BROKEN. The type
 * used to declare `actorId`/`actorEmail` while the API has always returned
 * `userId`, so the "who did this" column rendered an em-dash on every row while
 * the data sat in the response. Tests could not catch it: the fixtures used the
 * correct field, but nothing asserted the column. There is now an assertion on
 * the rendered value, not merely on the shape of the data.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { buildExportUrl, AuditLogFilters } from '../../services/auditLogService';
import { useAuditLogsQuery } from '../../hooks/useAuditLogs';
import ErrorAlert from '../../components/ErrorAlert';
import type { Timestamp } from '../../types';

const PAGE_SIZE = 50;

interface Filters {
  action: string;
  entityType: string;
  userId: string;
  fromDate: string;
  toDate: string;
  requestId: string;
}

const EMPTY_FILTERS: Filters = {
  action: '',
  entityType: '',
  userId: '',
  fromDate: '',
  toDate: '',
  requestId: '',
};

const JsonBlock: React.FC<{ data: Record<string, unknown> | null | undefined; label: string }> = ({
  data,
  label,
}) => {
  if (!data) return null;
  return (
    <div className="mb-2">
      <span className="fw-semibold small text-muted text-uppercase me-2">{label}</span>
      <pre
        className="bg-light border rounded p-2 small mb-0"
        style={{ maxHeight: 200, overflow: 'auto', fontSize: '0.75rem' }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};

const AuditLogs: React.FC = () => {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toApiFilters = useCallback((f: Filters, p: number): AuditLogFilters => ({
    action: f.action.trim() || undefined,
    entityType: f.entityType.trim() || undefined,
    userId: f.userId.trim() ? Number(f.userId.trim()) : undefined,
    fromDate: f.fromDate || undefined,
    toDate: f.toDate || undefined,
    requestId: f.requestId.trim() || undefined,
    page: p,
    pageSize: PAGE_SIZE,
  }), []);

  // Server state via TanStack Query, keyed by the applied filters + page so
  // each combination is cached and changing either refetches.
  const logsQuery = useAuditLogsQuery(toApiFilters(applied, page));
  const entries = logsQuery.data?.entries ?? [];
  const total = logsQuery.data?.total ?? 0;
  const loading = logsQuery.isLoading || logsQuery.isFetching;
  const error = logsQuery.isError
    ? (logsQuery.error as Error).message ?? t('admin.auditLogs.loadFailed')
    : null;

  const applyFilters = () => {
    setPage(1);
    setApplied({ ...filters });
  };

  const resetFilters = () => {
    setFilters(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const exportUrl = (format: 'csv' | 'json') =>
    buildExportUrl(
      {
        action: applied.action || undefined,
        entityType: applied.entityType || undefined,
        userId: applied.userId ? Number(applied.userId) : undefined,
        fromDate: applied.fromDate || undefined,
        toDate: applied.toDate || undefined,
      },
      format
    );

  const handleFilterChange = (key: keyof Filters, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Timestamp is `string | Date`: JSON gives strings, but the shared contract
  // admits the Date the backend's driver produces, so narrow at the point of use.
  const formatDate = (value: Timestamp) => {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">{t('admin.auditLogs.title')}</h1>
            <p className="text-muted mb-0 small">{t('admin.auditLogs.subtitle')}</p>
          </div>
          <div className="d-flex gap-2">
            <a
              href={exportUrl('csv')}
              className="btn btn-sm btn-outline-secondary"
              download="audit_log.csv"
            >
              <i className="bi bi-filetype-csv me-1" aria-hidden="true"></i>{t('admin.auditLogs.export.csv')}
            </a>
            <a
              href={exportUrl('json')}
              className="btn btn-sm btn-outline-secondary"
              download="audit_log.json"
            >
              <i className="bi bi-filetype-json me-1" aria-hidden="true"></i>{t('admin.auditLogs.export.json')}
            </a>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-header">
          <h6 className="mb-0">
            <i className="bi bi-funnel me-2" aria-hidden="true"></i>{t('admin.auditLogs.filters.title')}
          </h6>
        </div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-3">
              <label htmlFor="filterAction" className="form-label small">{t('admin.auditLogs.filters.action')}</label>
              <input
                id="filterAction"
                type="text"
                className="form-control form-control-sm"
                placeholder={t('admin.auditLogs.filters.actionPlaceholder')}
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              />
            </div>
            <div className="col-md-3">
              <label htmlFor="filterEntityType" className="form-label small">{t('admin.auditLogs.filters.entityType')}</label>
              <input
                id="filterEntityType"
                type="text"
                className="form-control form-control-sm"
                placeholder={t('admin.auditLogs.filters.entityTypePlaceholder')}
                value={filters.entityType}
                onChange={(e) => handleFilterChange('entityType', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterUserId" className="form-label small">{t('admin.auditLogs.filters.userId')}</label>
              <input
                id="filterUserId"
                type="number"
                className="form-control form-control-sm"
                placeholder={t('admin.auditLogs.filters.userIdPlaceholder')}
                value={filters.userId}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
                min={1}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterFromDate" className="form-label small">{t('admin.auditLogs.filters.fromDate')}</label>
              <input
                id="filterFromDate"
                type="date"
                className="form-control form-control-sm"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterToDate" className="form-label small">{t('admin.auditLogs.filters.toDate')}</label>
              <input
                id="filterToDate"
                type="date"
                className="form-control form-control-sm"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
              />
            </div>
            <div className="col-12 d-flex gap-2 pt-1">
              <button className="btn btn-primary btn-sm" onClick={applyFilters} aria-label={t('admin.auditLogs.filters.applyAriaLabel')}>
                <i className="bi bi-search me-1" aria-hidden="true"></i>{t('admin.auditLogs.filters.apply')}
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={resetFilters}>
                {t('admin.auditLogs.filters.reset')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && <ErrorAlert message={error} onRetry={() => logsQuery.refetch()} />}

      {/* Table */}
      <div className="card">
        <div className="card-header d-flex align-items-center justify-content-between">
          <h6 className="mb-0">
            {loading ? (
              <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>{t('common.loading')}</>
            ) : (
              <>{t('admin.auditLogs.entriesCount', { count: total })}</>
            )}
          </h6>
          <small className="text-muted">{t('admin.auditLogs.pageIndicator', { page, totalPages })}</small>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col" style={{ width: 60 }}>#</th>
                  <th scope="col">{t('admin.auditLogs.columns.action')}</th>
                  <th scope="col">{t('admin.auditLogs.columns.entity')}</th>
                  <th scope="col">{t('admin.auditLogs.columns.userId')}</th>
                  <th scope="col">{t('admin.auditLogs.columns.description')}</th>
                  <th scope="col">{t('admin.auditLogs.columns.date')}</th>
                  <th scope="col" className="text-center" style={{ width: 50 }}>{t('admin.auditLogs.columns.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">{t('admin.auditLogs.noEntries')}</td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <React.Fragment key={entry.id}>
                    <tr className={expandedId === entry.id ? 'table-active' : ''}>
                      <td className="text-muted font-monospace small">{entry.id}</td>
                      <td>
                        <span className="badge bg-secondary font-monospace">{entry.action}</span>
                      </td>
                      <td>
                        {entry.entityType && (
                          <span className="text-muted small">
                            {entry.entityId != null
                              ? t('admin.auditLogs.entityWithId', { entityType: entry.entityType, entityId: entry.entityId })
                              : entry.entityType}
                          </span>
                        )}
                      </td>
                      <td className="text-muted small">{entry.userId ?? t('common.emptyValue')}</td>
                      <td className="small" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.description ?? t('common.emptyValue')}
                      </td>
                      <td className="text-muted small text-nowrap">{formatDate(entry.createdAt)}</td>
                      <td className="text-center">
                        <button
                          className="btn btn-sm btn-outline-secondary py-0 px-1"
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                          aria-label={expandedId === entry.id ? t('admin.auditLogs.collapseEntry', { id: entry.id }) : t('admin.auditLogs.expandEntry', { id: entry.id })}
                          aria-expanded={expandedId === entry.id}
                        >
                          <i
                            className={`bi ${expandedId === entry.id ? 'bi-chevron-up' : 'bi-chevron-down'}`}
                            aria-hidden="true"
                          ></i>
                        </button>
                      </td>
                    </tr>
                    {expandedId === entry.id && (
                      <tr>
                        <td colSpan={7} className="bg-light border-top-0">
                          <div className="p-3">
                            {entry.justification && (
                              <div className="mb-2">
                                <span className="fw-semibold small text-muted text-uppercase me-2">{t('admin.auditLogs.detail.justification')}</span>
                                <span className="small">{entry.justification}</span>
                              </div>
                            )}
                            {entry.onBehalfOfUserId != null && (
                              <div className="mb-2">
                                <span className="fw-semibold small text-muted text-uppercase me-2">{t('admin.auditLogs.detail.onBehalfOf')}</span>
                                <span className="small font-monospace">{entry.onBehalfOfUserId}</span>
                              </div>
                            )}
                            {entry.requestId && (
                              <div className="mb-2">
                                <span className="fw-semibold small text-muted text-uppercase me-2">{t('admin.auditLogs.detail.requestId')}</span>
                                <span className="small font-monospace">{entry.requestId}</span>
                              </div>
                            )}
                            <JsonBlock data={entry.beforeSnapshot} label={t('admin.auditLogs.detail.before')} />
                            <JsonBlock data={entry.afterSnapshot} label={t('admin.auditLogs.detail.after')} />
                            {entry.ipAddress && (
                              <div className="text-muted small">
                                {t('admin.auditLogs.detail.ip', { ip: entry.ipAddress })}
                                {entry.userAgent && <span className="ms-3">{entry.userAgent.slice(0, 80)}</span>}
                              </div>
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
        </div>
        {totalPages > 1 && (
          <div className="card-footer d-flex align-items-center justify-content-between">
            <button
              className="btn btn-sm btn-outline-secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label={t('admin.auditLogs.pagination.previousAriaLabel')}
            >
              <i className="bi bi-chevron-left" aria-hidden="true"></i> {t('admin.auditLogs.pagination.previous')}
            </button>
            <small className="text-muted">
              {t('admin.auditLogs.pagination.showing', {
                from: Math.min((page - 1) * PAGE_SIZE + 1, total),
                to: Math.min(page * PAGE_SIZE, total),
                total,
              })}
            </small>
            <button
              className="btn btn-sm btn-outline-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label={t('admin.auditLogs.pagination.nextAriaLabel')}
            >
              {t('admin.auditLogs.pagination.next')} <i className="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogs;
