/**
 * Grant and revocation history for one person or one role.
 *
 * WHY IT SHOWS TWO LISTS AND NOT ONE. Current grants and the events that
 * produced them are different things, and neither can be derived from the
 * other: a grant made before auditing existed has no event, and a grant that
 * reached its `expires_at` produced no event when it lapsed — nobody revoked it,
 * it simply stopped applying. A single merged list would have to invent one of
 * the two, and the invention would be wrong in exactly the cases someone opens
 * this screen to investigate.
 *
 * So a current grant the history cannot account for says so on its own row, and
 * a lapsed grant appears as a `derived` event marked as inferred rather than
 * recorded. "Granted at some point we cannot show you" is a useful statement;
 * implying it never happened is not.
 *
 * WHY THE ACTOR AND THE JUSTIFICATION ARE COLUMNS, NOT A DETAIL VIEW. The
 * question this answers is almost never "when" on its own — it is "who gave
 * this person that, and what did they say at the time". Putting either behind a
 * click makes the table decorative.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import QueryState from '../../components/QueryState';
import { useRoleTimelineQuery } from '../../hooks/useRbac';
import { formatDate } from '../../utils/format';
import type { RoleTimelineEntry } from '../../services/rbacService';

interface Props {
  /** null while nothing is selected; the query is gated on it. */
  subject: { kind: 'user' | 'role'; id: number } | null;
}

const ACTION_BADGE: Record<RoleTimelineEntry['action'], string> = {
  granted: 'bg-success',
  revoked: 'bg-danger',
  expired: 'bg-secondary',
};

/** A timestamp with its time, since two grants on one day are common. */
const stamp = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${formatDate(iso)} ${date.toTimeString().slice(0, 5)}`;
};

const RoleTimeline: React.FC<Props> = ({ subject }) => {
  const query = useRoleTimelineQuery(subject);
  const data = query.data ?? null;

  if (!subject) {
    return <p className="text-muted mb-0">Select someone to see their role history.</p>;
  }

  return (
    <QueryState
      isLoading={query.isLoading}
      isError={query.isError}
      error={query.error}
      onRetry={query.refetch}
      loadingMessage="Loading the role history…"
    >
      {data && (
        <>
          <h6 className="mb-2">Held now</h6>
          {data.current.length === 0 ? (
            <p className="text-muted">No roles currently granted.</p>
          ) : (
            <div className="table-responsive mb-4">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th scope="col">{subject.kind === 'role' ? 'Person' : 'Role'}</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Expires</th>
                    <th scope="col">History</th>
                  </tr>
                </thead>
                <tbody>
                  {data.current.map((grant) => (
                    <tr key={`${grant.userId}-${grant.roleId}-${grant.scopeOrgUnitId ?? 'all'}`}>
                      <td>
                        {subject.kind === 'role'
                          ? (grant.userName ?? `User ${grant.userId}`)
                          : (grant.roleName ?? `Role ${grant.roleId}`)}
                      </td>
                      <td className="text-muted">{grant.scopeOrgUnitName ?? 'All units'}</td>
                      <td>{grant.expiresAt ? stamp(grant.expiresAt) : <span className="text-muted">—</span>}</td>
                      <td>
                        {grant.hasHistory ? (
                          <span className="text-muted small">recorded below</span>
                        ) : (
                          // Not an error, and not nothing: it predates the audit
                          // log or was seeded, and saying so is more honest than
                          // an empty cell that reads as "never happened".
                          <span className="badge bg-warning text-dark">not in the log</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h6 className="mb-2">What happened</h6>
          {data.entries.length === 0 ? (
            <p className="text-muted mb-0">Nothing recorded.</p>
          ) : (
            <>
              {data.truncated && (
                <div className="alert alert-warning py-2 small" role="note">
                  Showing the most recent events only — there are more than this view returns.
                </div>
              )}
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">What</th>
                      <th scope="col">{subject.kind === 'role' ? 'Person' : 'Role'}</th>
                      <th scope="col">Scope</th>
                      <th scope="col">By</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.entries.map((entry) => (
                      <tr key={entry.auditId ?? `derived-${entry.userId}-${entry.roleId}-${entry.at}`}>
                        <td className="text-nowrap">{stamp(entry.at)}</td>
                        <td>
                          <span className={`badge ${ACTION_BADGE[entry.action]}`}>{entry.action}</span>
                          {entry.derived && (
                            <span className="text-muted small ms-2" title="Inferred from the grant's expiry; nothing recorded it">
                              inferred
                            </span>
                          )}
                        </td>
                        <td>
                          {subject.kind === 'role'
                            ? (entry.userName ?? `User ${entry.userId}`)
                            : (entry.roleName ?? `Role ${entry.roleId ?? '?'}`)}
                        </td>
                        <td className="text-muted">{entry.scopeOrgUnitName ?? 'All units'}</td>
                        <td>
                          {entry.derived ? (
                            <span className="text-muted">nobody — it lapsed</span>
                          ) : (
                            (entry.actorName ?? <span className="text-muted">unknown</span>)
                          )}
                        </td>
                        <td className="text-muted small">{entry.justification ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </QueryState>
  );
};

export default RoleTimeline;
