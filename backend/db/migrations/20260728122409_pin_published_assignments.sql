-- Pinned assignments: a published assignment is a COMMITMENT, not a proposal.
--
-- WHY THIS EXISTS. `POST /schedules/:id/generate` always solved from scratch,
-- so re-running it on a published schedule could legally reshuffle everyone.
-- That is wrong in a way a scheduling metric cannot see: once published, an
-- assignment is something a person has arranged their life around. Someone who
-- knew they were free on Saturday has made plans; someone who knew they were
-- working Tuesday has arranged childcare. A re-solve that improves the schedule
-- by 3% while moving a third of the staff has made things WORSE, and the model
-- could not even express that — disruption had no cost, so the solver was free
-- to cause any amount of it.
--
-- WHY A COLUMN AND NOT AN INFERRED RULE. "Assignments on a published schedule
-- are pinned" could be derived from the schedule's status instead of stored.
-- Rejected because pinning must be able to diverge from status: a planner
-- deliberately unpinning one person to let the optimizer move them is the
-- normal way to use this, and an inferred rule leaves nowhere to record that.
-- The column also survives a schedule being unpublished and republished, which
-- an inferred rule would silently reset.

-- migrate:up

ALTER TABLE shift_assignments
    ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE
        COMMENT 'A commitment the optimizer must plan around rather than reconsider';

-- Existing assignments on published schedules are already commitments — people
-- have been told about them. Backfilling is what makes the first re-solve after
-- this migration safe; without it, the first regeneration would treat every
-- live schedule as a draft.
UPDATE shift_assignments sa
   JOIN shifts s ON s.id = sa.shift_id
   JOIN schedules sc ON sc.id = s.schedule_id
    SET sa.is_pinned = TRUE
  WHERE sc.status = 'published'
    AND sa.status IN ('pending', 'confirmed');

-- migrate:down

ALTER TABLE shift_assignments DROP COLUMN is_pinned;
