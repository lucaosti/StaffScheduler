-- Attendance punches: one open record per user (#851), and where a punch came
-- from (#978).
--
-- WHY A UNIQUE KEY AND NOT A CHECK IN CODE: clock-in checked for an open
-- record and then inserted, as two autocommitted statements, so two
-- concurrent requests (a double tap, a client retry) could both pass the
-- check and both insert. The second open record was later closed or left
-- dangling arbitrarily, and if both were approved the hours were paid twice.
-- A transaction with SELECT ... FOR UPDATE was rejected: it locks nothing
-- when no open row exists yet, which is exactly the racing case, and a gap
-- lock on the user index would serialise every clock-in for that user range.
--
-- WHY A GENERATED COLUMN: MySQL has no partial (filtered) unique index.
-- `open_marker` is 1 while the record is open and NULL once it is closed, and
-- a UNIQUE key allows any number of NULLs, so (user_id, open_marker) admits
-- many closed records but at most one open one per user. STORED rather than
-- VIRTUAL so the key reads a materialised value and the column needs no
-- recomputation on index maintenance; it is one byte.
--
-- WHY THE UP MIGRATION FIRST CLOSES DUPLICATES: the race this fixes has had
-- time to happen, and adding the key over existing duplicates would fail the
-- deployment. For each user the newest open record (latest clock_in, then
-- highest id) is kept open — it is the one a later clock-out would be meant
-- for — and every older one is closed at its own clock_in, so it adds zero
-- hours rather than inventing a clock-out time nobody punched. The status is
-- left as it was (normally `pending`) and a note says what happened, so a
-- reviewer sees each closed record instead of having it silently disappear.
-- Deleting the duplicates was rejected: they are evidence of what was punched.
-- The window function forces the derived table to materialise, which is what
-- lets MySQL update the table it reads from (error 1093 otherwise).
--
-- SOURCE AND DEVICE: a kiosk punch is made at a shared tablet bound to one
-- department, and the record did not say so. `source` records where the
-- record was opened; `kiosk_device_id` which tablet, NULL for self punches.
-- ON DELETE SET NULL so removing a device keeps the punches it recorded.

-- migrate:up
UPDATE attendance_records ar
  JOIN (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY clock_in DESC, id DESC) AS open_rank
      FROM attendance_records
     WHERE clock_out IS NULL
  ) ranked ON ranked.id = ar.id AND ranked.open_rank > 1
   SET ar.clock_out = ar.clock_in,
       ar.notes = CONCAT_WS('\n', ar.notes,
         'Closed at its clock-in time by a schema migration: a newer open record existed for this user (duplicate clock-in).');

ALTER TABLE attendance_records
    ADD COLUMN open_marker TINYINT GENERATED ALWAYS AS (IF(clock_out IS NULL, 1, NULL)) STORED AFTER clock_out,
    ADD COLUMN source ENUM('self', 'kiosk') NOT NULL DEFAULT 'self' AFTER longitude,
    ADD COLUMN kiosk_device_id INT NULL AFTER source,
    ADD UNIQUE KEY uq_attendance_one_open (user_id, open_marker),
    ADD CONSTRAINT fk_attendance_kiosk_device
        FOREIGN KEY (kiosk_device_id) REFERENCES kiosk_devices(id) ON DELETE SET NULL;

-- migrate:down
-- Records closed by the up migration stay closed: which of them were open
-- before is only recorded in their notes, and reopening them would recreate
-- the double-counting this migration removed.
ALTER TABLE attendance_records DROP FOREIGN KEY fk_attendance_kiosk_device;
ALTER TABLE attendance_records
    DROP INDEX uq_attendance_one_open,
    DROP COLUMN kiosk_device_id,
    DROP COLUMN source,
    DROP COLUMN open_marker;
