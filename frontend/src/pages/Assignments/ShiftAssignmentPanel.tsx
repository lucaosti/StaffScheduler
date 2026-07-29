/**
 * Who is on this shift, and who could be — the planner's half of assignments.
 *
 * WHY THE AVAILABLE-EMPLOYEES PICKER RATHER THAN A LIST OF EVERYONE. The
 * server already answers "who may work this shift", applying the skill,
 * availability and conflict rules. Offering the full staff list instead would
 * push the user into discovering those rules one refusal at a time, and would
 * leave an endpoint that exists precisely to prevent that going unused.
 *
 * WHY THE REFUSAL IS SHOWN VERBATIM. `createAssignment` rejects conflicts,
 * unavailability, missing skills, capacity and policy violations, each with
 * its own message naming what is wrong. Those messages are the only place in
 * the product where the scheduling rules are explained to a person, and
 * replacing them with "failed" would throw that away — the picker narrows the
 * candidates, but a rule can still fire between opening it and clicking.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import QueryState from '../../components/QueryState';
import {
  useAssignmentsQuery,
  useAvailableEmployeesQuery,
  useAssignmentMutations,
} from '../../hooks/useAssignments';
import type { ShiftAssignment } from '../../types';
import { useActionFeedback } from '../../hooks/useActionFeedback';

interface Props {
  shiftId: number;
  /** Hides the controls for a caller who may only look. */
  canManage: boolean;
}

const ShiftAssignmentPanel: React.FC<Props> = ({ shiftId, canManage }) => {
  const { message, run: act } = useActionFeedback();
  const [picking, setPicking] = useState(false);

  const assigned = useAssignmentsQuery({ shiftId });
  // Only asked for while the picker is open: the answer is worthless to
  // someone who is not choosing.
  const available = useAvailableEmployeesQuery(picking ? shiftId : null);
  const { create, remove } = useAssignmentMutations();


  const nameOf = (person: { firstName?: string; lastName?: string; email?: string }): string =>
    [person.firstName, person.lastName].filter(Boolean).join(' ') || person.email || 'Unnamed';

  return (
    <div>
      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      <QueryState
        isLoading={assigned.isLoading}
        isError={assigned.isError}
        error={assigned.error}
        onRetry={assigned.refetch}
        isEmpty={(assigned.data?.length ?? 0) === 0}
        loadingMessage="Loading assignments…"
        empty={<p className="text-muted">Nobody is assigned to this shift.</p>}
      >
        <ul className="list-group mb-3">
          {(assigned.data ?? []).map((assignment: ShiftAssignment) => (
            <li
              key={String(assignment.id)}
              className="list-group-item d-flex justify-content-between align-items-center"
            >
              <span>
                {assignment.userName ?? `User ${assignment.userId}`}{' '}
                <span className="badge bg-light text-dark">{assignment.status}</span>
              </span>
              {canManage && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  onClick={() => act(remove.mutateAsync(Number(assignment.id)))}
                  disabled={remove.isPending}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </QueryState>

      {canManage && !picking && (
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setPicking(true)}>
          Assign someone
        </button>
      )}

      {canManage && picking && (
        <QueryState
          isLoading={available.isLoading}
          isError={available.isError}
          error={available.error}
          onRetry={available.refetch}
          isEmpty={(available.data?.length ?? 0) === 0}
          loadingMessage="Finding who can work this shift…"
          empty={
            <p className="text-muted">
              Nobody is available for this shift — everyone is either unqualified, already
              committed, or unavailable.
            </p>
          }
        >
          <ul className="list-group">
            {(available.data ?? []).map((person) => (
              <li
                key={person.id}
                className="list-group-item d-flex justify-content-between align-items-center"
              >
                <span>{nameOf(person)}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() =>
                    act(create.mutateAsync({ shiftId, userId: person.id }).then(() => setPicking(false)))
                  }
                  disabled={create.isPending}
                >
                  Assign
                </button>
              </li>
            ))}
          </ul>
        </QueryState>
      )}
    </div>
  );
};

export default ShiftAssignmentPanel;
