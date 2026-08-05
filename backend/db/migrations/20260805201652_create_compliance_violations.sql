-- Compliance violations: a historical record of what ComplianceEngine
-- detects, so a trend can be charted from something other than a proxy.
--
-- WHY THIS TABLE, RATHER THAN DERIVING A TREND FROM `audit_logs`.
-- `evaluateAssignmentCompliance` decides pass/fail at the moment an
-- assignment is created or approved, but a rejected attempt today leaves no
-- row behind anywhere — the caller sees an error and nothing is written. The
-- audit trail records actions that HAPPENED, not attempts that were refused,
-- and most of the call sites that hit a compliance violation write no audit
-- entry at all on that path. Deriving a trend from a proxy would mean adding
-- an audit write to every one of those call sites instead of one; a dedicated
-- table at the single point violations are actually detected
-- (`evaluateAssignmentCompliance`) is the smaller, more precise change.
--
-- One row per VIOLATION, not per compliance check: a single candidate shift
-- can fail more than one rule at once (e.g. both consecutive-days and
-- weekly-hours), and each is its own fact for a "trend by rule code" query to
-- aggregate over — collapsing them into one row per check would hide which
-- rule is actually the recurring problem.

-- migrate:up

CREATE TABLE IF NOT EXISTS compliance_violations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    code VARCHAR(40) NOT NULL,
    message TEXT NOT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_compliance_violations_detected_at (detected_at),
    INDEX idx_compliance_violations_code (code),
    INDEX idx_compliance_violations_user (user_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- migrate:down

DROP TABLE IF EXISTS compliance_violations;
