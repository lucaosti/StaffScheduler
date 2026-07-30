-- Delegating your own authority, without needing to administer delegations.
--
-- WHY A PERMISSION CODE AND NOT A NEW POLICY TABLE. The issue asked for "a
-- policy flag, per role or per org unit". A permission code is already both:
-- roles are configurable data, so granting `delegation.self` to a role IS the
-- per-role flag, and a role grant carrying `scope_org_unit_id` IS the
-- per-org-unit one. A separate policy table would be a SECOND authorization
-- mechanism sitting beside the one every other decision in this system uses,
-- with every occasion to disagree with it that implies — and the project's rule
-- is that permission gating is always code-based.
--
-- WHY THIS GRANTS NOTHING NEW. `createDelegation` already refuses any code the
-- delegator does not hold, and the route has never accepted a delegator other
-- than the caller. So `delegation.manage` on that route was never a limit on
-- WHAT could be delegated — only on WHO was allowed to delegate at all. This
-- code says the same thing with the meaning it should have had: you may pass on
-- your own authority, and nothing more than your own.
--
-- WHY `delegation.manage` SURVIVES rather than being replaced. It still means
-- something different: a deployment that wants delegation to be an administered
-- act, arranged by someone with oversight rather than by each person, keeps
-- exactly that by granting `manage` and withholding `self`. The two are not a
-- hierarchy, they are two answers to "who decides that a delegation happens".
--
-- WHY NO ORDINARY ROLE RECEIVES IT BY DEFAULT. Whether employees may hand their
-- own authority to a colleague unsupervised is an organizational decision, not
-- a technical default — and the safe direction for a permission that moves
-- authority between people is to require someone to have chosen it. Manager and
-- Administrator keep `delegation.manage`, so no existing deployment changes
-- behaviour when this migration runs.

-- migrate:up

INSERT IGNORE INTO permissions (code, resource, action, description) VALUES
('delegation.self', 'delegation', 'self',
 'Delegate one''s own permissions to a colleague without holding delegation.manage');

-- Administrator holds every permission by construction in the initial seed;
-- this keeps that true for a code added afterwards.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'delegation.self'
 WHERE r.name = 'Administrator';

-- migrate:down

DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code = 'delegation.self';

DELETE FROM permissions WHERE code = 'delegation.self';
