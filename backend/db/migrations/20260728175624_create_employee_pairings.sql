-- Relationships between people that constrain who may share a shift.
--
-- `apart`    — these two must not be on the same shift. Conflict separation, or
--              a control requirement such as no two relatives on one till.
-- `requires` — `user_id` may only work a shift that `other_user_id` also works.
--
-- WHY `requires` IS DIRECTIONAL. "They must work together" reads as symmetric
-- and almost never is: a trainee must not work without their supervisor, but
-- the supervisor works perfectly well alone. A symmetric rule would forbid the
-- supervisor from taking any shift the trainee is not on, which is the opposite
-- of what anyone wants. Symmetric pairing, where genuinely needed, is two rows.
--
-- WHY GLOBAL AND NOT SCOPED TO A DEPARTMENT. These relationships are about
-- people, not places: two people who must not share a till must not share it
-- anywhere. A scope can be added if a real case needs one, but adding it now
-- would be inventing a requirement.
--
-- The unique key is on the ordered pair plus kind, so `apart` and `requires`
-- can both exist between the same two people (they are not contradictory: A may
-- require B while B must stay apart from C).

-- migrate:up

CREATE TABLE IF NOT EXISTS employee_pairings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    other_user_id INT NOT NULL,
    kind ENUM('apart', 'requires') NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_employee_pairing (user_id, other_user_id, kind),
    INDEX idx_employee_pairings_user (user_id),
    INDEX idx_employee_pairings_other (other_user_id),

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (other_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- migrate:down

DROP TABLE IF EXISTS employee_pairings;
