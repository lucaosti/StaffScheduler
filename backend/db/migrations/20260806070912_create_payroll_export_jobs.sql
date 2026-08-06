-- Payroll export jobs: a queued, retried delivery of a pay-period batch to an
-- external payroll provider, same shape as `webhook_deliveries`.
--
-- WHY A QUEUE AND NOT A SYNCHRONOUS API CALL. The issue this closes explicitly
-- calls for "scheduled export jobs" — an export is an outbound call to a
-- third party that can be slow or transiently unavailable, exactly the case
-- `webhook_deliveries` already solves for outbound webhooks. Reusing that
-- shape (status/attempts/backoff/next_attempt_at) rather than inventing a
-- second one means one delivery-retry mechanism to reason about, not two.
--
-- `provider` is a column, not a foreign key to a providers table: the set of
-- providers is a TypeScript-level abstraction (`PayrollProvider`), additive by
-- adding a class, not a row — there is nothing else to normalize against yet.
--
-- The batch itself is not stored here. It is rebuilt from `shift_assignments`
-- / `attendance_records` / `users.hourly_rate` at delivery time by
-- `PayrollExportService`, the same "recompute rather than cache" choice
-- `compliance_violations` rejected for the opposite reason (there, nothing
-- else recorded a rejected attempt at all) — here, the source data already
-- exists and stays authoritative if it changes before the job runs.

-- migrate:up

CREATE TABLE IF NOT EXISTS payroll_export_jobs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(40) NOT NULL,
    range_start DATE NOT NULL,
    range_end DATE NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    -- The provider's own reference for the accepted batch (e.g. a Gusto
    -- payroll run id), for a support conversation to point at.
    provider_reference VARCHAR(120) NULL,
    last_error TEXT NULL,
    next_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    INDEX idx_payroll_export_status_next_attempt (status, next_attempt_at),
    INDEX idx_payroll_export_range (range_start, range_end),

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- migrate:down

DROP TABLE IF EXISTS payroll_export_jobs;
