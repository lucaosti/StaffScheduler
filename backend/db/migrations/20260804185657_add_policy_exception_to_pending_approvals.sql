-- migrate:up

-- Fifth entity FK on pending_approvals: policy exceptions were the one
-- request type still routed exclusively through the legacy approval_matrix
-- (see PolicyExceptionService), never through this table at all.
ALTER TABLE pending_approvals
  ADD COLUMN policy_exception_id INT NULL AFTER shift_swap_request_id,
  ADD CONSTRAINT fk_pending_approvals_policy_exception
    FOREIGN KEY (policy_exception_id) REFERENCES policy_exception_requests(id) ON DELETE CASCADE,
  ADD INDEX idx_pending_approvals_policy_exception (policy_exception_id);

-- The "exactly one entity FK is set" CHECK constraint has to be redefined to
-- count the new column — MySQL has no ALTER CHECK, only drop-and-recreate.
ALTER TABLE pending_approvals
  DROP CHECK chk_pending_approval_one_entity,
  ADD CONSTRAINT chk_pending_approval_one_entity CHECK (
    (CASE WHEN change_request_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN time_off_request_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN employee_loan_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN shift_swap_request_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN policy_exception_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

-- Backfill: any exception request already 'pending' under the legacy matrix
-- gets a first-step pending_approvals row on the new workflow, so it becomes
-- decidable through the same path a newly created one now uses instead of
-- being stranded on a mechanism PolicyExceptionService no longer decides
-- through. 'policy_owner' resolves directly to policies.imposed_by_user_id
-- (NOT NULL), so every pending request has an approver to backfill to.
INSERT INTO pending_approvals (policy_exception_id, workflow_id, step_id, step_order, assigned_to_user_id, status)
SELECT per.id, w.id, s.id, s.step_order, p.imposed_by_user_id, 'pending'
  FROM policy_exception_requests per
  JOIN policies p ON p.id = per.policy_id
  JOIN approval_workflows w ON w.change_type = 'Policy.Exception'
  JOIN approval_steps s ON s.workflow_id = w.id AND s.step_order = 1
 WHERE per.status = 'pending';

-- migrate:down

-- Backfilled rows have no other entity FK set, so they would violate the
-- 4-column CHECK this step restores — remove them before recreating it.
DELETE FROM pending_approvals WHERE policy_exception_id IS NOT NULL;

ALTER TABLE pending_approvals
  DROP CHECK chk_pending_approval_one_entity,
  ADD CONSTRAINT chk_pending_approval_one_entity CHECK (
    (CASE WHEN change_request_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN time_off_request_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN employee_loan_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN shift_swap_request_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  );

ALTER TABLE pending_approvals
  DROP FOREIGN KEY fk_pending_approvals_policy_exception,
  DROP INDEX idx_pending_approvals_policy_exception,
  DROP COLUMN policy_exception_id;
