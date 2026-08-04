-- Web Push notifications (#310).
--
-- Two tables mirroring the email_outbox pattern already established for the
-- notifications outbox: `push_subscriptions` is per-device registration
-- state (durable, survives across notifications), `push_outbox` is the
-- transactional-outbox delivery queue (one row per notification per
-- subscription, delivered at-least-once by a separate worker).
--
-- WHY A SEPARATE TABLE PER SUBSCRIPTION, NOT ONE ROW PER USER: a person can
-- have push enabled on more than one device (a laptop and a phone), and each
-- is an independent endpoint the browser/OS issued — there is no shared key
-- across devices to collapse them into one row.

-- migrate:up
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    -- The push service URL the browser issued (unique per device+browser
    -- install); the natural dedup key for "already subscribed on this device".
    endpoint VARCHAR(500) NOT NULL,
    p256dh VARCHAR(255) NOT NULL,
    auth VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,

    UNIQUE KEY uq_endpoint (endpoint(255)),
    INDEX idx_user_active (user_id, is_active),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_outbox (
    id INT PRIMARY KEY AUTO_INCREMENT,
    notification_id INT NULL,
    subscription_id INT NOT NULL,
    -- The push payload (title/body/link), stored rather than re-derived from
    -- the notification at delivery time — the notification may since have
    -- been deleted, and the outbox's job is to deliver what was promised at
    -- enqueue time, not whatever the row looks like later.
    payload TEXT NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    INDEX idx_status_created (status, created_at),

    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL,
    FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE IF EXISTS push_outbox;
DROP TABLE IF EXISTS push_subscriptions;
