-- Several named calendar feed tokens per person, revocable independently.
--
-- WHY THE OLD SHAPE COULD NOT DO THIS. `user_calendar_tokens` had `user_id` as
-- its PRIMARY KEY, so a person could hold exactly one token, and obtaining a
-- new one meant overwriting the old hash. Every device already subscribed
-- stopped working the moment a second was added — the opposite of what a
-- calendar subscription is for: a feed is set up once and expected to keep
-- working until someone deliberately stops it.
--
-- WHY A LABEL. With one token there was nothing to distinguish; with several,
-- revoking the right one requires knowing which is which. "Phone" and "Work
-- laptop" is the difference between revoking a lost device's access and
-- revoking your own.
--
-- WHY `revoked_at` RATHER THAN DELETING THE ROW. Keeping the record is what
-- lets someone see that a token existed and when it stopped working; a feed
-- that quietly vanished from the list is indistinguishable from one that was
-- never created. It also keeps the hash reserved, so a revoked token can never
-- be resurrected by a collision, however remote.
--
-- THE UNIQUE KEY STAYS ON THE HASH ALONE, not on (user_id, hash): a token
-- identifies its owner, so the same hash belonging to two people would make
-- `resolveToken` ambiguous — exactly the case the constraint must prevent
-- rather than permit.
--
-- Existing tokens are carried over with a label saying where they came from,
-- because "feeds must keep working until explicitly revoked" applies to the
-- ones that already exist as much as to the ones created afterwards. A
-- migration that dropped them would be the very failure this change fixes.

-- migrate:up

CREATE TABLE IF NOT EXISTS calendar_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    label VARCHAR(100) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE COMMENT 'SHA-256 hex digest of the raw bearer token',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,

    -- Resolving a feed request looks up a live token by hash (the unique key);
    -- listing a person's tokens looks them up by owner.
    INDEX idx_calendar_tokens_user (user_id, revoked_at),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO calendar_tokens (user_id, label, token_hash, created_at)
SELECT user_id, 'Existing subscription', token_hash, created_at
  FROM user_calendar_tokens;

DROP TABLE user_calendar_tokens;

-- migrate:down

CREATE TABLE IF NOT EXISTS user_calendar_tokens (
    user_id INT PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Only one token can survive the reversal, since the old shape holds one per
-- person: the most recently created live one, which is the likeliest to be in
-- active use. Any others are lost, which is inherent to returning to a shape
-- that cannot represent them.
INSERT INTO user_calendar_tokens (user_id, token_hash, created_at)
SELECT ct.user_id, ct.token_hash, ct.created_at
  FROM calendar_tokens ct
  JOIN (
    SELECT user_id, MAX(id) AS keep_id
      FROM calendar_tokens
     WHERE revoked_at IS NULL
     GROUP BY user_id
  ) newest ON newest.keep_id = ct.id;

DROP TABLE calendar_tokens;
