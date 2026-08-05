-- migrate:up

-- Open shift board: an employee posts one of their own assignments as
-- available to swap, without naming a specific counterpart, and any eligible
-- peer can claim it by offering one of their own assignments back. Claiming
-- creates a real `shift_swap_requests` row (see ShiftSwapService.claimOpenOffer)
-- reusing the same compliance checks and manager-approval workflow the
-- targeted flow already has — an open offer is a discovery mechanism on top
-- of that flow, not a second approval path.
CREATE TABLE IF NOT EXISTS shift_swap_offers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    assignment_id INT NOT NULL,
    user_id INT NOT NULL,
    notes TEXT,
    status ENUM('open', 'claimed', 'cancelled') NOT NULL DEFAULT 'open',
    -- Set once claimed, linking back to the real swap request the claim
    -- produced. NULL for the whole life of an offer that is never claimed.
    claimed_by_swap_request_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_assignment (assignment_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),

    FOREIGN KEY (assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (claimed_by_swap_request_id) REFERENCES shift_swap_requests(id) ON DELETE SET NULL
);

-- migrate:down

DROP TABLE IF EXISTS shift_swap_offers;
