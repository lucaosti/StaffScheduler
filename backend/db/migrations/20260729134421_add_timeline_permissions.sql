-- Timeline (Gantt) visibility.
--
-- WHY TWO CODES AND NOT ONE. The timeline shows who works when, which is
-- something an ordinary employee should see for the people they work
-- alongside, and something a planner should see across everything they are
-- responsible for. One code cannot express both, because `allowedOrgUnitIds`
-- is NULL for anyone whose roles carry no org-unit scope — and NULL means
-- unrestricted. A single code granted to the Employee role would therefore
-- publish the whole organization's movements to everyone in it, which is the
-- opposite of what it is for.
--
--   timeline.read      — the caller's own org units, and their subtrees.
--   timeline.read_all  — no restriction; for planners and administrators.
--
-- WHY NOT REUSE `schedule.read`. That governs the schedule as an object of
-- planning: its period, its status, whether it may be published. This governs
-- seeing PEOPLE — when a named colleague is at work. They are different
-- questions and conflating them would mean the answer to one silently decided
-- the other.
--
-- WHAT THE VIEW MAY SHOW is not expressible in a permission and is enforced in
-- the query: name, activity, start and end. Never pay, never the reason for an
-- absence, never assignment notes. Absences are excluded entirely — showing
-- who is away on covered days makes leave and sickness deducible, which is the
-- inference the narrow projection exists to prevent.

-- migrate:up

INSERT IGNORE INTO permissions (code, resource, action, description) VALUES
('timeline.read',     'timeline', 'read',     'View the timeline for one''s own organization units'),
('timeline.read_all', 'timeline', 'read_all', 'View the timeline across all organization units');

-- Everyone can see their own unit's timeline: knowing who you are working
-- alongside is ordinary information about your own working day.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'timeline.read'
 WHERE r.name IN ('Administrator', 'Manager', 'Employee');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'timeline.read_all'
 WHERE r.name IN ('Administrator', 'Manager');

-- migrate:down

DELETE rp FROM role_permissions rp
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.code IN ('timeline.read', 'timeline.read_all');

DELETE FROM permissions WHERE code IN ('timeline.read', 'timeline.read_all');
