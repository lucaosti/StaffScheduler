-- Native mobile push notifications (device tokens + delivery queue).
--
-- Parallels the Web Push migration's shape (`push_subscriptions` /
-- `push_outbox`) rather than reusing it: a Capacitor WebView has no browser
-- Push API, so a mobile client registers a Firebase Cloud Messaging (Android)
-- or Apple Push Notification service (iOS) device token instead of a
-- `PushSubscription`. Same reasoning throughout — a durable per-device
-- registration table, and a transactional-outbox delivery queue delivered
-- at-least-once by a separate worker.
--
-- WHY A SEPARATE TABLE PER DEVICE, NOT ONE ROW PER USER: identical reasoning
-- to `push_subscriptions` — a person can carry the app on more than one
-- device, and each install gets its own token from its own OS push service.

-- migrate:up
CREATE TABLE IF NOT EXISTS device_push_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    platform ENUM('ios', 'android') NOT NULL,
    -- The APNs device token / FCM registration token, as returned by
    -- `PushNotifications.register()`'s `registration` event on the client.
    -- The natural dedup key for "already registered on this device" — an OS
    -- can reissue a fresh token for the same physical device (app
    -- reinstall, token rotation), so re-registering updates the row in place
    -- rather than accumulating duplicates.
    token VARCHAR(500) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,

    UNIQUE KEY uq_device_push_token (token(255)),
    INDEX idx_device_push_user_active (user_id, is_active),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS native_push_outbox (
    id INT PRIMARY KEY AUTO_INCREMENT,
    notification_id INT NULL,
    device_token_id INT NOT NULL,
    -- The push payload (title/body/link), stored rather than re-derived from
    -- the notification at delivery time — same reasoning as `push_outbox.payload`.
    payload TEXT NOT NULL,
    status ENUM('pending', 'sent', 'failed') NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    INDEX idx_native_push_status_created (status, created_at),

    FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL,
    FOREIGN KEY (device_token_id) REFERENCES device_push_tokens(id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE IF EXISTS native_push_outbox;
DROP TABLE IF EXISTS device_push_tokens;
