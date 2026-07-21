-- migrate:up

-- Persistent, rotating refresh tokens (replaces the previous "re-issue while
-- the access token is still valid" pseudo-refresh). Design rationale:
--
-- * We store only a SHA-256 hash of the opaque refresh token, never the token
--   itself — a database leak must not hand an attacker usable credentials, and
--   the token is high-entropy so a plain hash (no salt/bcrypt needed) is
--   sufficient and keeps lookup a single indexed equality.
-- * `family_id` groups every token in one rotation chain. On each refresh the
--   presented token is revoked and a new one issued in the same family. If a
--   token that was ALREADY rotated (revoked) is presented again, a stolen copy
--   is being replayed, so the whole family is revoked at once — the standard
--   refresh-token-reuse detection that caps the blast radius of a leaked token
--   to a single rotation.
-- * `replaced_by` records the successor for auditability of a chain;
--   `revoked_at` distinguishes a spent/rotated or revoked token from a valid one.
-- * ON DELETE CASCADE ties tokens to their user so deleting a user cleans up.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    family_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME NULL,
    replaced_by BIGINT NULL,

    UNIQUE KEY uq_refresh_token_hash (token_hash),
    INDEX idx_refresh_user (user_id),
    INDEX idx_refresh_family (family_id),
    INDEX idx_refresh_expires (expires_at),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- migrate:down
DROP TABLE IF EXISTS refresh_tokens;
