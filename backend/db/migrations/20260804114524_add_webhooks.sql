-- Outbound webhooks (#315).
--
-- Scoped by `organization_name` (VARCHAR, matching `users.organization_name`
-- and `organization_module_overrides` — this app's existing soft-multi-tenant
-- tag, not a separate `organizations` table), not by department: a webhook
-- subscriber wants every matching event across the organization, and
-- departments are a scheduling concept orthogonal to who gets told about it.
--
-- Two tables, the same outbox shape as email_outbox/push_outbox:
-- `webhook_subscriptions` is durable configuration, `webhook_deliveries` is
-- the transactional-outbox delivery queue AND the delivery log the issue
-- asks for in one table — a delivered row and a logged delivery are the same
-- fact, so there is nothing to keep in sync between two tables.
--
-- WHY `next_attempt_at` INSTEAD OF THE FLAT retry-every-poll THE OTHER TWO
-- OUTBOXES USE: the issue specifically asks for backoff, and a webhook
-- endpoint that is down tends to stay down for a while — hammering it every
-- 30s (the email/push poll interval) for five attempts is over in 2.5
-- minutes, not a meaningful backoff. `next_attempt_at` lets WebhookWorker's
-- poll query skip a row until its computed backoff has elapsed, while still
-- polling on the same short interval for everything that IS ready.

-- migrate:up
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    organization_name VARCHAR(120) NOT NULL,
    url VARCHAR(500) NOT NULL,
    -- HMAC-SHA256 signing secret, generated server-side at creation and shown
    -- once (same one-time-reveal convention as the kiosk device token).
    secret VARCHAR(255) NOT NULL,
    -- Comma-separated event type keys (e.g. "schedule.published,assignment.confirmed").
    -- Not a normalized join table: the set is small and always read/written
    -- whole, so a join table would add a second write path for no query this
    -- app ever needs (nobody asks "which subscriptions include event X" at
    -- the SQL level — dispatch already loads a subscription's full row and
    -- filters in application code, the same way push_subscriptions doesn't
    -- normalize per-device capability flags).
    event_types VARCHAR(1000) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_org_active (organization_name, is_active),

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    subscription_id INT NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    payload TEXT NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    -- The delivered endpoint's own HTTP status, when one was received at all
    -- (NULL on a connection-level failure — timeout, DNS, refused) — the
    -- delivery log detail an admin actually wants when a webhook misbehaves.
    response_status INT NULL,
    last_error TEXT NULL,
    next_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    INDEX idx_status_next_attempt (status, next_attempt_at),
    INDEX idx_subscription_created (subscription_id, created_at),

    FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhook_subscriptions;
