-- Minimum consecutive days off: the rest a contract guarantees, not just the
-- work it caps.
--
-- `max_consecutive_days` bounds how long someone works without a break and says
-- nothing about the break. A schedule of five-on, one-off, five-on, one-off
-- satisfies it completely while the person never gets two days together — the
-- difference between "not overworked" and "rested", and only the first was
-- modelled. Two separate single days is not a weekend.
--
-- NULL means this contract does not constrain it, consistent with every other
-- limit on the table: absent is distinct from zero.

-- migrate:up

ALTER TABLE employment_contracts
    ADD COLUMN min_consecutive_days_off INT NULL
        COMMENT 'Consecutive days off guaranteed at least once per rolling 7-day window'
        AFTER max_consecutive_days;

-- migrate:down

ALTER TABLE employment_contracts DROP COLUMN min_consecutive_days_off;
