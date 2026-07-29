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

import React, { useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useAssignmentsQuery, useAssignmentMutations } from '../../hooks/useAssignments';
import type { Assignment } from '../../types';

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

const time = (value?: string): string => (value ? value.slice(0, 5) : '—');

const MyAssignments: React.FC = () => {
  const { user } = useAuth();
  const [message, setMessage] = useState<string | null>(null);

  const filters = useMemo(
    () => (user?.id ? { userId: Number(user.id) } : {}),
    [user?.id]
  );
  const assignments = useAssignmentsQuery(filters);
  const { confirm, decline } = useAssignmentMutations();

  const act = async (run: Promise<unknown>) => {
    setMessage(null);
    try {
      await run;
    } catch (error) {
      // The server explains WHY an assignment cannot change state — a
      // cancelled one cannot be confirmed, a past one cannot be declined —
      // and that explanation is more use than "failed".
      setMessage(error instanceof Error ? error.message : 'The request failed');
    }
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-3">My shifts</h1>

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
        loadingMessage="Loading your shifts…"
        empty={<p className="text-muted">You have no shifts assigned.</p>}
      >
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Date</th>
              <th>Time</th>
              <th>Department</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(assignments.data ?? []).map((assignment: Assignment) => (
              <tr key={String(assignment.id)}>
                <td>{formatDate(assignment.shiftDate)}</td>
                <td>
                  {time(assignment.startTime)}–{time(assignment.endTime)}
                </td>
                <td>{assignment.departmentName ?? '—'}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[assignment.status] ?? 'bg-secondary'}`}>
                    {assignment.status}
                  </span>
                </td>
                <td className="text-end">
                  {/* Only a pending shift is still a question. Offering the
                      buttons on a settled one would invite a click the server
                      refuses. */}
                  {assignment.status === 'pending' && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-success me-2"
                        onClick={() => act(confirm.mutateAsync(Number(assignment.id)))}
                        disabled={confirm.isPending}
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => act(decline.mutateAsync(Number(assignment.id)))}
                        disabled={decline.isPending}
                      >
                        Decline
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryState>
    </div>
  );
};

export default MyAssignments;
