/**
 * ops/backup/backup.sh and restore.sh, run for real against stub MySQL clients.
 *
 * The failure these pin is silent: `mysqldump | gzip` without pipefail reports
 * gzip's status, so a dump that died halfway was kept under its final name,
 * retention then deleted the older good dumps, and `restore.sh --latest` picked
 * the broken one (#846). Nothing short of a restore notices, and a restore is
 * exactly when a broken backup is discovered too late. The weekly
 * backup-restore workflow proves the happy path against a real server; these
 * cases prove the failure paths, which a healthy server never produces.
 *
 * The scripts run through their own shebang, as the compose sidecar runs them,
 * with stub `mysqldump`/`mysql` first on PATH. gzip, find and date are real.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BACKUP = path.join(root, 'ops', 'backup', 'backup.sh');
const RESTORE = path.join(root, 'ops', 'backup', 'restore.sh');

// Incompressible on purpose: a half-written dump of a real database is far
// above any size heuristic, so the stub's must be too, or a "too small" check
// would pass these cases for the wrong reason.
const DUMP_BODY = `-- MySQL dump\nCREATE TABLE t (v TEXT);\nINSERT INTO t VALUES ('${randomBytes(8192).toString('hex')}');\n`;
const TRAILER = '-- Dump completed on 2026-10-30 12:00:00\n';

// STUB_DUMP selects the stub's behaviour: `ok` writes a complete dump, `dies`
// writes half of one and exits non-zero (a dropped connection, a killed
// process), `truncated` writes half of one and still exits 0.
const MYSQLDUMP_STUB = `#!/bin/sh
printf '%s' "$STUB_BODY"
case "$STUB_DUMP" in
  ok) printf '%s' "$STUB_TRAILER" ;;
  dies) echo "mysqldump: Lost connection to server during query" >&2; exit 2 ;;
  truncated) ;;
esac
`;

// Records what reached the server: the restore's stdin, or nothing for `-e`.
const MYSQL_STUB = `#!/bin/sh
for arg in "$@"; do case "$arg" in -e) exit 0 ;; esac; done
cat > "$STUB_RECEIVED"
exit "\${STUB_MYSQL_RC:-0}"
`;

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'backup-scripts-'));
  const bin = path.join(dir, 'bin');
  const backups = path.join(dir, 'backups');
  mkdirSync(bin);
  mkdirSync(backups);
  for (const [name, body] of [['mysqldump', MYSQLDUMP_STUB], ['mysql', MYSQL_STUB]]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  const received = path.join(dir, 'received.sql');
  const run = (script, args, env = {}) =>
    spawnSync(script, args, {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        DB_HOST: 'stub', DB_USER: 'stub', DB_PASSWORD: 'stub', DB_NAME: 'staff_scheduler',
        BACKUP_DIR: backups, BACKUP_RETENTION_DAYS: '14',
        STUB_BODY: DUMP_BODY, STUB_TRAILER: TRAILER, STUB_RECEIVED: received,
        ...env,
      },
    });
  return { backups, received, run };
}

/** A dump older than the retention window, which a SUCCESSFUL run must prune. */
function seedExpiredDump(backups) {
  const file = path.join(backups, 'staff_scheduler_20200101T000000Z.sql.gz');
  writeFileSync(file, gzipSync(DUMP_BODY + TRAILER));
  const monthAgo = Date.now() / 1000 - 30 * 86400;
  utimesSync(file, monthAgo, monthAgo);
  return file;
}

for (const mode of ['dies', 'truncated']) {
  test(`backup: a dump that ${mode === 'dies' ? 'exits non-zero' : 'lacks its completion trailer'} fails, leaves nothing, prunes nothing`, () => {
    const { backups, run } = sandbox();
    const expired = seedExpiredDump(backups);
    const result = run(BACKUP, [], { STUB_DUMP: mode });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    // Only the pre-existing dump: no final file, no leftover temporary.
    assert.deepEqual(readdirSync(backups), [path.basename(expired)]);
  });
}

test('backup: a complete dump is kept under its final name, then old ones are pruned', () => {
  const { backups, run } = sandbox();
  const expired = seedExpiredDump(backups);
  const result = run(BACKUP, [], { STUB_DUMP: 'ok' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(expired), false, 'the expired dump survived a successful run');
  const files = readdirSync(backups);
  assert.equal(files.length, 1);
  assert.match(files[0], /^staff_scheduler_\d{8}T\d{6}Z\.sql\.gz$/);
  const gunzip = spawnSync('gzip', ['-dc', path.join(backups, files[0])], { encoding: 'utf8' });
  assert.equal(gunzip.stdout, DUMP_BODY + TRAILER);
});

test('restore: a complete dump reaches the server', () => {
  const { backups, received, run } = sandbox();
  const dump = path.join(backups, 'staff_scheduler_20261030T120000Z.sql.gz');
  writeFileSync(dump, gzipSync(DUMP_BODY + TRAILER));
  const result = run(RESTORE, ['--latest']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(received, 'utf8'), DUMP_BODY + TRAILER);
});

test('restore: a corrupt archive fails before anything reaches the server', () => {
  // gunzip's failure used to be masked by mysql's success at the end of the
  // pipe, so a restore that applied half a dump reported success.
  const { backups, received, run } = sandbox();
  const dump = path.join(backups, 'staff_scheduler_20261030T120000Z.sql.gz');
  writeFileSync(dump, gzipSync(DUMP_BODY + TRAILER).subarray(0, 40));
  const result = run(RESTORE, [dump]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(received), false);
});

test('restore: a dump without its completion trailer is refused', () => {
  const { backups, received, run } = sandbox();
  const dump = path.join(backups, 'staff_scheduler_20261030T120000Z.sql.gz');
  writeFileSync(dump, gzipSync(DUMP_BODY));
  const result = run(RESTORE, [dump]);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(received), false);
});

test('restore: a server-side failure fails the restore', () => {
  const { backups, run } = sandbox();
  writeFileSync(path.join(backups, 'staff_scheduler_20261030T120000Z.sql.gz'), gzipSync(DUMP_BODY + TRAILER));
  const result = run(RESTORE, ['--latest'], { STUB_MYSQL_RC: '1' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
});
