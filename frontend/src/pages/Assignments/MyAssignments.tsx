/**
 * My shifts — the assignments belonging to the person looking at the screen.
 *
 * WHY THIS EXISTS AT ALL. Thirteen assignment operations were reachable only
 * over HTTP, which meant the most-used action in a workforce product —
 * "am I working on Tuesday, and do I accept it?" — could not be performed in
 * the application.
 *
 * WHY CONFIRM AND DECLINE ARE THE ONLY ACTIONS HERE. Creating and deleting an
 * assignment is a planner's act on a shift, not a person's act on their own
 * row; putting them on the same screen would suggest an employee can give
 * themselves work. Completing is likewise not self-service — the server gates
 * it, and a button that always 403s teaches the reader the app is broken.
 *
 * WHY A DECLINED SHIFT STAYS VISIBLE. It is a record of a decision, and
 * removing it from the list would leave someone unsure whether their decline
 * registered. It is shown with its status rather than hidden.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useMyAssignmentsQuery, useAssignmentMutations } from '../../hooks/useAssignments';
import type { ShiftAssignment } from '../../types';
import { formatTime } from '../../utils/format';
import { useActionFeedback } from '../../hooks/useActionFeedback';

/** The shared formatter, with the dash these tables use for an absent time. */
const shiftTime = (value?: string): string => formatTime(value) || '—';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-warning text-dark',
  confirmed: 'bg-success',
  completed: 'bg-secondary',
  cancelled: 'bg-danger',
};

const formatDate = (value?: string | Date | null): string => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return String(value);
  }
};


const MyAssignments: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();

  // The self-service endpoint, not the planner's listing with a filter: the
  // latter is gated on `assignment.manage` and would 403 for everyone this
  // page exists for.
  const assignments = useMyAssignmentsQuery(user?.id ? Number(user.id) : null);
  const { confirm, decline } = useAssignmentMutations();


  return (
    <div className="container-fluid py-3 myassignments-page">
      <h1 className="h4 mb-3">{t('myAssignments.title')}</h1>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <QueryState
        isLoading={assignments.isLoading}
        isError={assignments.isError}
        error={assignments.error}
        onRetry={assignments.refetch}
        isEmpty={(assignments.data?.length ?? 0) === 0}
        loadingMessage={t('myAssignments.loading')}
        empty={<p className="text-muted">{t('myAssignments.empty')}</p>}
      >
        <div className="table-responsive">
          <table className="table table-sm align-middle">
            <thead>
              <tr>
                <th>{t('myAssignments.columns.date')}</th>
                <th>{t('myAssignments.columns.time')}</th>
                <th>{t('myAssignments.columns.department')}</th>
                <th>{t('myAssignments.columns.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(assignments.data ?? []).map((assignment: ShiftAssignment) => (
                <tr key={String(assignment.id)}>
                  <td>{formatDate(assignment.shiftDate)}</td>
                  <td>
                    {t('common.timeRange', { start: shiftTime(assignment.startTime), end: shiftTime(assignment.endTime) })}
                  </td>
                  <td>{assignment.departmentName ?? t('common.emptyValue')}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[assignment.status] ?? 'bg-secondary'}`}>
                      {t(`assignments.status.${assignment.status}`, assignment.status)}
                    </span>
                  </td>
                  <td className="text-end">
                    {/* Only a pending shift is still a question. Offering the
                        buttons on a settled one would invite a click the server
                        refuses. */}
                    {assignment.status === 'pending' && (
                      <div className="d-flex flex-wrap justify-content-end gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          onClick={() => act(confirm.mutateAsync(Number(assignment.id)))}
                          disabled={confirm.isPending}
                        >
                          {t('myAssignments.confirm')}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => act(decline.mutateAsync(Number(assignment.id)))}
                          disabled={decline.isPending}
                        >
                          {t('myAssignments.decline')}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </QueryState>
    </div>
  );
};

export default MyAssignments;
