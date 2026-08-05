-- Minimum total days off per period: a COUNT guarantee, distinct from the
-- rest a contract already guarantees in blocks.
--
-- `min_consecutive_days_off` asks for one consecutive rest block per rolling
-- 7-day window and says nothing about the total. `min_days_off_per_period`
-- asks the opposite question — how many days off in total, however
-- distributed — and the two are independent: a contract can guarantee a
-- weekend every week while still saying nothing about whether four weeks in a
-- row of exactly one rest day each is enough days off overall.
--
-- Stored as a RATE per 7-day reference period, not an absolute count, because
-- a contract has no fixed schedule length to be absolute about — a schedule
-- period is decided later, per run. The rate is prorated against the actual
-- period length at validation time (see constraintValidator.ts), the same way
-- `min_consecutive_days_off` is evaluated against whatever period the
-- schedule turns out to span.
--
-- NULL means this contract does not constrain it, consistent with every
-- other limit on the table.

-- migrate:up

ALTER TABLE employment_contracts
    ADD COLUMN min_days_off_per_period INT NULL
        COMMENT 'Minimum days off guaranteed per 7-day reference period; prorated to the schedule''s actual length'
        AFTER min_consecutive_days_off;

-- migrate:down

ALTER TABLE employment_contracts DROP COLUMN min_days_off_per_period;
