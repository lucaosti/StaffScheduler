-- Cost plan write permission.
--
-- WHY A NEW CODE AND NOT `report.read`. Viewing the plan-vs-actual cost
-- comparison uses the existing `report.read` gate, same as the actual-cost
-- figure it sits next to on `/dashboard/stats`. Setting the target is a
-- different act — it changes what the organization is being measured
-- against, not just who can see the measurement — so it needs its own
-- write-side code, the same read/write separation `payroll.manage` already
-- draws against its own read-side gates.

-- migrate:up

INSERT IGNORE INTO permissions (code, resource, action, description) VALUES
('report.manage', 'report', 'manage', 'Create, edit and delete cost plan targets');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'report.manage'
 WHERE r.name = 'Administrator';

-- migrate:down

DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code = 'report.manage';

DELETE FROM permissions WHERE code = 'report.manage';
