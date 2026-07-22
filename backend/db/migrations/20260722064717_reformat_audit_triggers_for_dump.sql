-- Recreate the audit_logs immutability triggers with explicit BEGIN...END
-- bodies so a mysqldump of the schema round-trips.
--
-- The original triggers (initial_schema) used a single-statement body:
--   CREATE TRIGGER ... FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '...';
-- mysqldump wraps trigger bodies in a /*!50003 ... */ version comment, and for a
-- single-statement body the statement's own terminating `;` lands INSIDE that
-- comment, so on reload MySQL ends the CREATE TRIGGER at that `;` and then
-- chokes on the trailing ` */` ("error near ' */'"). Wrapping the body in
-- BEGIN...END moves the inner `;` inside a compound statement, and the backup
-- restore test (.github/workflows/backup-restore.yml) proves the dump reloads.
--
-- Behaviour is identical — the triggers still raise SQLSTATE '45000' on any
-- UPDATE/DELETE of an audit_logs row.

-- migrate:up
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_logs rows are immutable and cannot be updated';
END;

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_logs rows are immutable and cannot be deleted';
END;

-- migrate:down
DROP TRIGGER IF EXISTS trg_audit_logs_no_update;
CREATE TRIGGER trg_audit_logs_no_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_logs rows are immutable and cannot be updated';

DROP TRIGGER IF EXISTS trg_audit_logs_no_delete;
CREATE TRIGGER trg_audit_logs_no_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_logs rows are immutable and cannot be deleted';
