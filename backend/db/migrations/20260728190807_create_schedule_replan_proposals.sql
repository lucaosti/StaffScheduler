-- Re-solving a PUBLISHED schedule proposes; it no longer applies.
--
-- WHY. `generate` applied its result and reported the diff afterwards, so a
-- planner discovered that fourteen people had moved by reading the response.
-- For a draft that is correct — nobody has been told anything. For a published
-- schedule it inverts the decision: the change to people's commitments has
-- already happened by the time anyone can judge whether it was worth making.
--
-- WHY A DEDICATED TABLE AND NOT `change_requests`. `change_requests` carries a
-- proposed change with a payload and routes it through `approval_workflows`,
-- which is the right shape — but its `apply` executes no domain effect for any
-- change type: it marks the row applied and writes an audit entry, leaving a
-- human to perform the change. A replanning diff cannot be performed by hand,
-- and the whole point here is that approving it is what writes the rows. Its
-- payload is also unlike the others: hundreds of assignments plus the diff
-- against what people were told, which must be verified against live data
-- before it can be applied at all.
--
-- WHY THE WHOLE PROPOSED SET, NOT JUST THE DIFF. Three options were weighed:
--
--   - store the diff and re-derive the rest at apply time. Smallest payload,
--     and wrong: the unchanged assignments are what make the diff meaningful,
--     and re-deriving them means trusting that nothing else moved.
--   - re-solve at approval time with the same pins and require the diff to
--     match. Rejected because a solver is not required to return the same
--     optimum twice, so an approved diff could legitimately fail to reproduce —
--     the planner would be approving a decision the system then declines to
--     make.
--   - store the whole solved set and VERIFY it against current data when
--     applying, refusing if the world moved. Chosen: what gets applied is
--     exactly what was approved, or nothing.
--
-- `superseded` exists because a second re-solve before the first is decided
-- leaves a stale proposal. Silently keeping both would let a planner approve a
-- diff computed against inputs that have since changed; the newer proposal
-- wins, and the older one keeps a status saying why it will never be applied
-- rather than disappearing.

-- migrate:up

CREATE TABLE IF NOT EXISTS schedule_replan_proposals (
    id INT PRIMARY KEY AUTO_INCREMENT,
    schedule_id INT NOT NULL,
    proposed_by INT NULL,
    status ENUM('pending', 'applied', 'rejected', 'superseded') NOT NULL DEFAULT 'pending',
    engine VARCHAR(20) NOT NULL,
    -- The complete proposed assignment set, plus the commitments it keeps and
    -- breaks, as computed at solve time.
    payload JSON NOT NULL,
    decided_by INT NULL,
    decided_at TIMESTAMP NULL,
    decision_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_replan_schedule_status (schedule_id, status),

    FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (proposed_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
);

-- migrate:down

DROP TABLE IF EXISTS schedule_replan_proposals;
