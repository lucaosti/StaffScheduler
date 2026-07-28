-- Required proficiency per shift skill.
--
-- `user_skills.proficiency_level` has existed since the initial schema (1–5,
-- constrained) and is settable through POST /api/employees/:id/skills. It was
-- never compared against anything: `shift_skills` had no way to say what level
-- a shift needs, and the optimizer received skills as bare names. So the data
-- was captured, displayed, and then discarded at exactly the point it would
-- matter — someone at level 1 and someone at level 5 were interchangeable to
-- the scheduler.
--
-- NULL means the shift does not constrain the level, which is what every shift
-- meant before this column existed. Consistent with the contract limits, where
-- absent is deliberately distinct from zero.
--
-- This expresses "EVERYONE assigned must be at least this good". The other
-- reading — "at least ONE person must be" — is a counting constraint over the
-- shift rather than a predicate over each assignment, and is tracked
-- separately.

-- migrate:up

ALTER TABLE shift_skills
    ADD COLUMN min_proficiency TINYINT NULL
        COMMENT 'Minimum user_skills.proficiency_level required of every assignee';

-- migrate:down

ALTER TABLE shift_skills DROP COLUMN min_proficiency;
