-- Employment contracts: working-time limits as a shared, effective-dated
-- entity instead of columns on user_preferences.
--
-- WHY THIS EXISTS. Every limit the optimizer enforces as a HARD constraint —
-- max_hours_per_week, max_consecutive_days, min_hours_between_shifts — lived
-- on user_preferences, a table whose name asserts its contents are
-- preferences. Three consequences, all real:
--
--   1. A contract could not be expressed. "Part-time 20h, max 4 consecutive
--      days, 11h rest" is a policy dozens of people share; retyped per person
--      it drifts per person, and changing it means updating every row.
--   2. Limits had no validity period. Someone moving from full-time to
--      part-time OVERWRITES the value, so a schedule generated last month was
--      legal under the old contract and now appears to violate the new one.
--      The system had no way to say which applied when.
--   3. The daily cap was not stored at all — the engines invented it as
--      max(8, weekly/5), a formula appearing in no contract, no policy table
--      and no documentation as a decision, yet enforced against real people.
--
-- WHY A DEDICATED ENTITY AND NOT A `policies` SCOPE. `policies` already does
-- scoped, configurable rules with exception requests, which made it a genuine
-- candidate. It was rejected because it has NO validity period, and effective
-- dating is the core requirement here — adding it would change a table used
-- for unrelated things. A contract is also a coherent BUNDLE of limits rather
-- than independent key/value rules, and the exception machinery does not
-- apply: you do not request an exception to your contract, you are given a
-- different one.

-- migrate:up

CREATE TABLE IF NOT EXISTS employment_contracts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    description TEXT,

    -- The limits. Nullable means "this contract does not constrain it", which
    -- is distinct from zero and lets a contract bound only what it means to.
    max_hours_per_week INT NULL,
    min_hours_per_week INT NULL,
    -- Stored, not derived. Replaces max(8, weekly/5) — a formula nobody agreed
    -- to that was enforced as a hard constraint.
    max_hours_per_day INT NULL,
    max_consecutive_days INT NULL,
    min_hours_between_shifts INT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_employment_contract_name (name),
    INDEX idx_employment_contracts_active (is_active)
);

-- Which contract applies to whom, and WHEN.
--
-- `effective_to` NULL means open-ended. Overlap is not enforced by a
-- constraint because MySQL has no exclusion constraints; the service rejects
-- overlapping ranges, and `idx_user_effective` makes the check cheap.
CREATE TABLE IF NOT EXISTS user_employment_contracts (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    contract_id INT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_user_effective (user_id, effective_from, effective_to),
    INDEX idx_user_employment_contracts_contract (contract_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (contract_id) REFERENCES employment_contracts(id) ON DELETE RESTRICT
);

-- Carry the existing per-user values across so nothing changes behaviourally
-- on migration and no data is lost.
--
-- One contract per DISTINCT combination of limits rather than one per user:
-- the whole point is that a contract is shared, and most installations will
-- collapse to a handful. The generated names are deliberately descriptive and
-- obviously machine-made, so an operator can recognise and rename them.
INSERT INTO employment_contracts
    (name, description, max_hours_per_week, min_hours_per_week,
     max_hours_per_day, max_consecutive_days, min_hours_between_shifts)
SELECT DISTINCT
    CONCAT('Imported ', COALESCE(p.max_hours_per_week, 40), 'h/week, ',
           COALESCE(p.max_consecutive_days, 5), ' consecutive days'),
    'Generated when working-time limits moved off user_preferences. Rename or consolidate as appropriate.',
    p.max_hours_per_week,
    p.min_hours_per_week,
    -- The previously derived daily cap, made explicit at its existing value so
    -- the migration changes no schedule's legality.
    GREATEST(8, COALESCE(p.max_hours_per_week, 40) DIV 5),
    p.max_consecutive_days,
    NULL
FROM user_preferences p
ON DUPLICATE KEY UPDATE employment_contracts.id = employment_contracts.id;

INSERT INTO user_employment_contracts (user_id, contract_id, effective_from, effective_to)
SELECT
    p.user_id,
    c.id,
    -- Open-ended in both directions: these limits have applied for as long as
    -- the row has existed, and dating them from today would make every past
    -- schedule appear to have had no contract at all.
    '1970-01-01',
    NULL
FROM user_preferences p
JOIN employment_contracts c
  ON c.name = CONCAT('Imported ', COALESCE(p.max_hours_per_week, 40), 'h/week, ',
                     COALESCE(p.max_consecutive_days, 5), ' consecutive days');

-- migrate:down

DROP TABLE IF EXISTS user_employment_contracts;
DROP TABLE IF EXISTS employment_contracts;
