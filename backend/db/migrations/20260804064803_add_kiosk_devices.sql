-- migrate:up

-- KIOSK DEVICES TABLE - shared-tablet clock-in/out credentials (#309)
CREATE TABLE IF NOT EXISTS kiosk_devices (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    department_id INT NOT NULL,
    -- Only the SHA-256 hash is stored, same reasoning as refresh_tokens: the
    -- raw token is high-entropy already (32 random bytes), so hashing (not
    -- bcrypt) is correct, and a DB leak yields nothing usable.
    token_hash CHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP NULL,

    INDEX idx_kiosk_department (department_id),
    INDEX idx_kiosk_active (is_active),

    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- migrate:down

DROP TABLE IF EXISTS kiosk_devices;

