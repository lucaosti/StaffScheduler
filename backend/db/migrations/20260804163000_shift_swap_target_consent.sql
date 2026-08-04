-- Shift swap target consent (#522).
--
-- A swap used to skip straight from creation to manager approval: the target
-- employee — whose own assignment moves just as much as the requester's —
-- was never asked, and the only person who could decline on their behalf was
-- a manager. This adds the missing gate: `pending_target` is the new initial
-- state (the target hasn't responded yet); `pending` now means "the target
-- accepted, awaiting manager approval" rather than "request submitted." The
-- pending_approvals row for the manager step is created only once the target
-- accepts (see ShiftSwapService.respondAsTarget), not at request creation —
-- there is nothing for a manager to decide until then.
--
-- `declined_by` distinguishes the target refusing from the manager refusing:
-- both land the request in `declined`, but they mean different things to the
-- requester ("they said no" vs "it wasn't approved"), and the UI/notification
-- copy needs to say which.

-- migrate:up
-- Every row already in flight was created before this gate existed and has
-- therefore implicitly already cleared the "ask the target" step — nothing
-- to backfill. Existing 'pending' rows stay 'pending' (now meaning "target
-- accepted, awaiting manager"), not retroactively downgraded to
-- 'pending_target', so no in-flight request is asked for a second consent
-- its own workflow never required.
ALTER TABLE shift_swap_requests
  MODIFY COLUMN status ENUM('pending_target', 'pending', 'approved', 'declined', 'cancelled') NOT NULL DEFAULT 'pending_target';

ALTER TABLE shift_swap_requests
  ADD COLUMN declined_by ENUM('target', 'manager') NULL AFTER status;

-- migrate:down
ALTER TABLE shift_swap_requests DROP COLUMN declined_by;

UPDATE shift_swap_requests SET status = 'pending' WHERE status = 'pending_target';

ALTER TABLE shift_swap_requests
  MODIFY COLUMN status ENUM('pending', 'approved', 'declined', 'cancelled') NOT NULL DEFAULT 'pending';
