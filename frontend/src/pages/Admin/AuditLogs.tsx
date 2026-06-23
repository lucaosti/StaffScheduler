/**
 * AuditLogs — Immutable audit trail viewer.
 *
 * Features:
 *   - Filter by action, entity type, user ID, date range, request ID
 *   - Paginated table (50 rows per page)
 *   - Expandable row: justification + before/after JSON diff
 *   - Export CSV / JSON via the backend's native export endpoint
 *
 * Requires `audit.read` permission; the route is protected via PermissionRoute.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AuditLogEntry } from '../../types';
import { listAuditLogs, buildExportUrl, AuditLogFilters } from '../../services/auditLogService';

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
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const load = useCallback(async (f: Filters, p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAuditLogs(toApiFilters(f, p));
      setEntries(res.data ?? []);
      setTotal(res.meta?.total ?? 0);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load audit logs.');
    } finally {
      setLoading(false);
    }
  }, [toApiFilters]);

  useEffect(() => {
    void load(applied, page);
  }, [applied, page, load]);

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

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Audit Log</h1>
            <p className="text-muted mb-0 small">Immutable record of all system actions</p>
          </div>
          <div className="d-flex gap-2">
            <a
              href={exportUrl('csv')}
              className="btn btn-sm btn-outline-secondary"
              download="audit_log.csv"
            >
              <i className="bi bi-filetype-csv me-1" aria-hidden="true"></i>Export CSV
            </a>
            <a
              href={exportUrl('json')}
              className="btn btn-sm btn-outline-secondary"
              download="audit_log.json"
            >
              <i className="bi bi-filetype-json me-1" aria-hidden="true"></i>Export JSON
            </a>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-header">
          <h6 className="mb-0">
            <i className="bi bi-funnel me-2" aria-hidden="true"></i>Filters
          </h6>
        </div>
        <div className="card-body">
          <div className="row g-2">
            <div className="col-md-3">
              <label htmlFor="filterAction" className="form-label small">Action</label>
              <input
                id="filterAction"
                type="text"
                className="form-control form-control-sm"
                placeholder="e.g. module.toggle"
                value={filters.action}
                onChange={(e) => handleFilterChange('action', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              />
            </div>
            <div className="col-md-3">
              <label htmlFor="filterEntityType" className="form-label small">Entity Type</label>
              <input
                id="filterEntityType"
                type="text"
                className="form-control form-control-sm"
                placeholder="e.g. user, module"
                value={filters.entityType}
                onChange={(e) => handleFilterChange('entityType', e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterUserId" className="form-label small">User ID</label>
              <input
                id="filterUserId"
                type="number"
                className="form-control form-control-sm"
                placeholder="e.g. 42"
                value={filters.userId}
                onChange={(e) => handleFilterChange('userId', e.target.value)}
                min={1}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterFromDate" className="form-label small">From date</label>
              <input
                id="filterFromDate"
                type="date"
                className="form-control form-control-sm"
                value={filters.fromDate}
                onChange={(e) => handleFilterChange('fromDate', e.target.value)}
              />
            </div>
            <div className="col-md-2">
              <label htmlFor="filterToDate" className="form-label small">To date</label>
              <input
                id="filterToDate"
                type="date"
                className="form-control form-control-sm"
                value={filters.toDate}
                onChange={(e) => handleFilterChange('toDate', e.target.value)}
              />
            </div>
            <div className="col-12 d-flex gap-2 pt-1">
              <button className="btn btn-primary btn-sm" onClick={applyFilters} aria-label="Apply filters">
                <i className="bi bi-search me-1" aria-hidden="true"></i>Apply
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={resetFilters}>
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      {/* Table */}
      <div className="card">
        <div className="card-header d-flex align-items-center justify-content-between">
          <h6 className="mb-0">
            {loading ? (
              <><span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Loading…</>
            ) : (
              <>{total.toLocaleString()} entries</>
            )}
          </h6>
          <small className="text-muted">Page {page} / {totalPages}</small>
        </div>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-hover table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th scope="col" style={{ width: 60 }}>#</th>
                  <th scope="col">Action</th>
                  <th scope="col">Entity</th>
                  <th scope="col">User ID</th>
                  <th scope="col">Description</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="text-center" style={{ width: 50 }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {!loading && entries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-4">No audit entries match the current filters.</td>
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
                            {entry.entityType}{entry.entityId != null ? ` #${entry.entityId}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="text-muted small">{entry.actorId ?? '—'}</td>
                      <td className="small" style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {entry.description ?? '—'}
                      </td>
                      <td className="text-muted small text-nowrap">{formatDate(entry.createdAt)}</td>
                      <td className="text-center">
                        <button
                          className="btn btn-sm btn-outline-secondary py-0 px-1"
                          onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                          aria-label={expandedId === entry.id ? `Collapse entry ${entry.id}` : `Expand entry ${entry.id}`}
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
                                <span className="fw-semibold small text-muted text-uppercase me-2">Justification</span>
                                <span className="small">{entry.justification}</span>
                              </div>
                            )}
                            {entry.onBehalfOfUserId != null && (
                              <div className="mb-2">
                                <span className="fw-semibold small text-muted text-uppercase me-2">On behalf of User</span>
                                <span className="small font-monospace">{entry.onBehalfOfUserId}</span>
                              </div>
                            )}
                            {entry.requestId && (
                              <div className="mb-2">
                                <span className="fw-semibold small text-muted text-uppercase me-2">Request ID</span>
                                <span className="small font-monospace">{entry.requestId}</span>
                              </div>
                            )}
                            <JsonBlock data={entry.beforeSnapshot} label="Before" />
                            <JsonBlock data={entry.afterSnapshot} label="After" />
                            {entry.ipAddress && (
                              <div className="text-muted small">
                                IP: {entry.ipAddress}
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
              aria-label="Previous page"
            >
              <i className="bi bi-chevron-left" aria-hidden="true"></i> Previous
            </button>
            <small className="text-muted">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, total)}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </small>
            <button
              className="btn btn-sm btn-outline-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              Next <i className="bi bi-chevron-right" aria-hidden="true"></i>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogs;
