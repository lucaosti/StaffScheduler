-- "At least N people on this shift at proficiency L or above."
--
-- WHY THIS IS NOT `min_proficiency` WITH A NUMBER. That column, added
-- immediately before this one, means "EVERYONE assigned must hold this skill at
-- level >= N" — a filter on who may be assigned. This is a COUNT over the
-- shift, and it cannot be expressed by narrowing eligibility: one senior per
-- night shift does not mean everyone must be senior, and requiring that would
-- make most rotas unstaffable.
--
-- They are independent requirements over the same shift, so they are separate
-- columns rather than one column with a mode switch encoded in nullability —
-- which would have been subtle to read and easy to misuse.
--
-- WHY TWO COLUMNS AND NOT ONE. The count and the level it applies to are both
-- needed and neither implies the other: "two people at level 3" and "one person
-- at level 5" are different requirements a rota might state.

-- migrate:up

ALTER TABLE shift_skills
    ADD COLUMN min_qualified_level TINYINT NULL
        COMMENT 'Proficiency that counts as qualified for min_qualified_staff',
    ADD COLUMN min_qualified_staff TINYINT NULL
        COMMENT 'How many assignees must reach min_qualified_level';

-- migrate:down

ALTER TABLE shift_skills
    DROP COLUMN min_qualified_staff,
    DROP COLUMN min_qualified_level;
