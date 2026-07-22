-- Transactional outbox for email notifications.
--
-- WHY: an in-app notification and its email are two writes. If the email is sent
-- inline they can diverge — the notification row commits but the email send
-- crashes (lost email), or the email goes out but the transaction rolls back
-- (phantom email). The outbox pattern makes them one atomic write: the email
-- intent is INSERTed into this table in the SAME transaction as the notification
-- row, and a separate worker delivers it afterwards with retries. Delivery is
-- therefore at-least-once and survives a process crash between commit and send.
--
-- A row is created only when email delivery is actually configured (see
-- NotificationService), so a deployment without SMTP never accumulates outbox
-- rows — there is no silent no-op either way.

-- migrate:up
CREATE TABLE IF NOT EXISTS email_outbox (
    id INT PRIMARY KEY AUTO_INCREMENT,
    -- The in-app notification this email mirrors (NULL if the notification is
    -- later deleted; the email intent still stands until processed).
    notification_id INT NULL,
    recipient_email VARCHAR(255) NOT NULL,
    subject VARCHAR(255) NOT NULL,
    body TEXT,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    -- The worker claims rows by (status, created_at); index it for the poll.
    INDEX idx_status_created (status, created_at),

    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
);

-- migrate:down
DROP TABLE IF EXISTS email_outbox;
