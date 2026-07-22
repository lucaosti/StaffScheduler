/**
 * RaciMatrix — responsibility assignment matrix (RACI view).
 *
 * Fetches GET /api/responsibility-rules/matrix and renders a pivot table:
 *   rows    = unique permission codes
 *   columns = unique (subjectType, subjectId) combinations
 *   cells   = org unit responsible + optional delegated role
 *
 * An empty cell means no responsibility rule has been defined for that
 * (permission, subject) combination.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import type { MatrixEntry } from '../../services/responsibilityService';
import { ResponsibilitySubjectType } from '../../services/responsibilityService';
import { useResponsibilityMatrixQuery } from '../../hooks/useGovernance';

interface MatrixCol {
  key: string;
  subjectType: ResponsibilitySubjectType;
  subjectId: number | null;
  label: string;
}

const subjectLabel = (type: ResponsibilitySubjectType, id: number | null): string => {
  if (type === 'all') return 'All users';
  if (id == null) return `${type} (any)`;
  return `${type} #${id}`;
};

const RaciMatrix: React.FC = () => {
  const [search, setSearch] = useState('');

  const matrixQuery = useResponsibilityMatrixQuery();
  const entries = matrixQuery.data ?? [];
  const loading = matrixQuery.isLoading;
  const error = matrixQuery.isError
    ? (matrixQuery.error as Error).message ?? 'Failed to load responsibility matrix.'
    : null;

  // Derive unique permission codes (rows) and subject columns
  const filteredEntries = search.trim()
    ? entries.filter(
        (e) =>
          e.permissionCode.toLowerCase().includes(search.toLowerCase()) ||
          subjectLabel(e.subjectType, e.subjectId).toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  const permCodes = Array.from(new Set(filteredEntries.map((e) => e.permissionCode))).sort();

  const colMap = new Map<string, MatrixCol>();
  filteredEntries.forEach((e) => {
    const key = `${e.subjectType}:${e.subjectId ?? 'null'}`;
    if (!colMap.has(key)) {
      colMap.set(key, {
        key,
        subjectType: e.subjectType,
        subjectId: e.subjectId,
        label: subjectLabel(e.subjectType, e.subjectId),
      });
    }
  });
  const cols = Array.from(colMap.values()).sort((a, b) => a.label.localeCompare(b.label));

  // Build lookup: permCode → colKey → entry
  const lookup = new Map<string, Map<string, MatrixEntry>>();
  filteredEntries.forEach((e) => {
    const colKey = `${e.subjectType}:${e.subjectId ?? 'null'}`;
    if (!lookup.has(e.permissionCode)) lookup.set(e.permissionCode, new Map());
    lookup.get(e.permissionCode)!.set(colKey, e);
  });

  return (
    <div className="container-fluid py-4">
      <div className="row mb-3">
        <div className="col d-flex align-items-center justify-content-between">
          <div>
            <h1 className="h3 mb-0">Responsibility Matrix</h1>
            <p className="text-muted mb-0 small">Pivot view of responsibility rules by permission and subject</p>
          </div>
          <button className="btn btn-sm btn-outline-primary" onClick={() => matrixQuery.refetch()} aria-label="Refresh matrix">
            <i className="bi bi-arrow-clockwise" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div className="mb-3">
        <input
          type="search"
          className="form-control form-control-sm w-auto"
          placeholder="Filter permission or subject…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter matrix"
        />
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>{error}
        </div>
      )}

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="d-flex align-items-center justify-content-center py-5">
              <span className="spinner-border me-2" role="status" aria-label="Loading matrix"></span>
              <span>Loading…</span>
            </div>
          ) : permCodes.length === 0 ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-grid-3x3 fs-3 d-block mb-2" aria-hidden="true"></i>
              {entries.length === 0
                ? 'No responsibility rules defined.'
                : 'No rules match the current filter.'}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table table-bordered table-sm mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th scope="col" className="text-nowrap" style={{ minWidth: 200 }}>
                      Permission Code
                    </th>
                    {cols.map((col) => (
                      <th key={col.key} scope="col" className="text-nowrap text-center small" style={{ minWidth: 140 }}>
                        <span className="badge bg-secondary-subtle text-secondary-emphasis">
                          {col.subjectType}
                        </span>
                        {col.subjectId != null && (
                          <span className="d-block text-muted mt-1">#{col.subjectId}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {permCodes.map((code) => (
                    <tr key={code}>
                      <td className="fw-semibold small font-monospace">{code}</td>
                      {cols.map((col) => {
                        const entry = lookup.get(code)?.get(col.key);
                        return (
                          <td key={col.key} className="text-center small">
                            {entry ? (
                              <div>
                                {entry.rules.map((r) => (
                                  <div key={r.id} className="mb-1">
                                    <span
                                      className="badge bg-success-subtle text-success-emphasis"
                                      title={r.description ?? ''}
                                    >
                                      OU #{r.responsibleOrgUnitId}
                                    </span>
                                    {r.delegatedToRoleId != null && (
                                      <span className="badge bg-info-subtle text-info-emphasis ms-1">
                                        Role #{r.delegatedToRoleId}
                                      </span>
                                    )}
                                    {!r.isActive && (
                                      <span className="badge bg-secondary ms-1">inactive</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {permCodes.length > 0 && (
          <div className="card-footer text-muted small">
            {permCodes.length} permission{permCodes.length !== 1 ? 's' : ''} &times; {cols.length} subject{cols.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
};

export default RaciMatrix;
