-- Which schedule this one continues from.
--
-- WHY. Schedules are monthly, but a month is not independent of the one before
-- it: rest between shifts, consecutive days worked and weekly hours all run
-- across the boundary, so generating month N has to know how month N-1 ended.
-- That was already half-true — the optimizer read assignments from *every
-- other* schedule within ±14 days — and the half that was missing is the one
-- that matters when a planner is comparing options.
--
-- THE DEFECT THIS FIXES. That query filtered on the ASSIGNMENT's status and
-- not the SCHEDULE's, so draft schedules counted. A planner who produced three
-- candidate generations for last month had all three read at once: the same
-- person appeared to be working three overlapping sets of shifts, their
-- consecutive-days and weekly-hours history at the boundary was inflated
-- threefold, and the new month was constrained by work that will never happen
-- — at most one of those drafts can ever be published.
--
-- WHY A COLUMN AND NOT AN INFERRED RULE. "The previous schedule" is inferable
-- (same department, latest one ending before this one starts) and that
-- inference is kept as the DEFAULT, so existing schedules and the ordinary
-- case need no decision. But it cannot be the only answer: when several
-- generations exist for the same period, which one actually happened is a
-- judgement the manager makes, and an inferred rule leaves nowhere to record
-- it. The column is what makes the choice expressible.
--
-- NULL therefore means "use the default", not "no predecessor". A schedule
-- genuinely first in its department resolves to no predecessor by the same
-- rule, because there is nothing published before it.
--
-- ON DELETE SET NULL rather than RESTRICT: deleting an old schedule should not
-- be blocked by a newer one pointing at it, and falling back to the default is
-- a better outcome than refusing the delete.

-- migrate:up

ALTER TABLE schedules
    ADD COLUMN previous_schedule_id INT NULL
        COMMENT 'Schedule this one continues from; NULL means resolve the default',
    ADD INDEX idx_schedules_previous (previous_schedule_id),
    ADD CONSTRAINT fk_schedules_previous
        FOREIGN KEY (previous_schedule_id) REFERENCES schedules(id) ON DELETE SET NULL;

-- migrate:down

ALTER TABLE schedules
    DROP FOREIGN KEY fk_schedules_previous,
    DROP INDEX idx_schedules_previous,
    DROP COLUMN previous_schedule_id;
