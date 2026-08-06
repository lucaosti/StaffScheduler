-- Payroll export permission.
--
-- WHY A NEW CODE AND NOT `report.read` OR `attendance.approve`. Triggering a
-- payroll export sends compensation data to an external vendor — a stronger
-- action than viewing a cost report or approving a punch, and neither
-- existing code implies "may push payroll data off-platform". Administrator
-- only: this is exactly the class of action `settings.manage` exists for
-- elsewhere, but payroll export is its own resource, not a system setting.

-- migrate:up

INSERT IGNORE INTO permissions (code, resource, action, description) VALUES
('payroll.manage', 'payroll', 'manage', 'Trigger and view payroll export jobs to external providers');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'payroll.manage'
 WHERE r.name = 'Administrator';

-- migrate:down

DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code = 'payroll.manage';

DELETE FROM permissions WHERE code = 'payroll.manage';
