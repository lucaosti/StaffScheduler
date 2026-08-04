-- 2FA method registry foundation (#586, part of #331).
--
-- Generalizes the TOTP-only columns on `users` into a per-user, per-method
-- enrollment table so the framework can add WebAuthn/email/SMS providers
-- (#587/#588/#589) without another users-table migration per method.
--
-- `secret_data` is a method-specific JSON blob (for TOTP: {"secret",
-- "lastCounter"}) rather than dedicated columns, because each provider's
-- enrollment data has a different shape (a WebAuthn credential is nothing
-- like a TOTP secret) and a users-table-style "one column per field of every
-- method" would force every future provider through another migration and
-- leave most columns NULL for most rows.
--
-- Recovery codes stay OFF this table, on `users` (renamed from
-- `totp_recovery_codes`): they authenticate "prove you're the account
-- owner," not "prove you have this specific method," so one set per user is
-- correct — a user with both TOTP and a passkey enrolled has one recovery
-- code list, not two.

-- migrate:up
CREATE TABLE IF NOT EXISTS two_factor_methods (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    method_type ENUM('totp', 'webauthn', 'email', 'sms') NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    secret_data TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_two_factor_methods_user_method (user_id, method_type),
    INDEX idx_two_factor_methods_user (user_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Carry every existing TOTP enrollment (started or fully enabled) into the
-- new table before the old columns are dropped, so no user is silently
-- logged out of 2FA by this migration.
INSERT INTO two_factor_methods (user_id, method_type, enabled, secret_data, created_at)
SELECT id, 'totp', totp_enabled,
       JSON_OBJECT('secret', totp_secret, 'lastCounter', totp_last_counter),
       NOW()
  FROM users
 WHERE totp_secret IS NOT NULL;

ALTER TABLE users CHANGE COLUMN totp_recovery_codes two_factor_recovery_codes TEXT NULL;
ALTER TABLE users DROP COLUMN totp_secret;
ALTER TABLE users DROP COLUMN totp_enabled;
ALTER TABLE users DROP COLUMN totp_last_counter;

-- migrate:down
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64) NULL;
ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN totp_last_counter BIGINT NULL;
ALTER TABLE users CHANGE COLUMN two_factor_recovery_codes totp_recovery_codes TEXT NULL;

UPDATE users u
   JOIN two_factor_methods m ON m.user_id = u.id AND m.method_type = 'totp'
   SET u.totp_secret = JSON_UNQUOTE(JSON_EXTRACT(m.secret_data, '$.secret')),
       u.totp_enabled = m.enabled,
       u.totp_last_counter = JSON_EXTRACT(m.secret_data, '$.lastCounter');

DROP TABLE IF EXISTS two_factor_methods;
