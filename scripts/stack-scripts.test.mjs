/**
 * What scripts/demo.sh and stop.sh ask Docker to destroy.
 *
 * Both used to run `docker compose down -v` against docker-compose.yml under
 * the deployment's own project name, with no confirmation: `demo.sh down` and
 * `stop.sh -c` (documented as removing containers) deleted the production
 * database volume, and the backups with it (#847). These cases run the real
 * scripts with stub `docker`/`docker-compose` binaries that only record their
 * arguments, and assert on what would have been executed.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// One line per invocation, arguments separated by spaces. `compose version`
// must succeed: demo.sh checks for the plugin before doing anything.
const RECORDER = `#!/bin/sh
echo "$(basename "$0") $*" >> "$STUB_LOG"
exit 0
`;

function run(script, args, { input = '' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stack-scripts-'));
  const bin = path.join(dir, 'bin');
  mkdirSync(bin);
  for (const name of ['docker', 'docker-compose']) {
    writeFileSync(path.join(bin, name), RECORDER);
    chmodSync(path.join(bin, name), 0o755);
  }
  const log = path.join(dir, 'calls.log');
  const result = spawnSync(path.join(root, script), args, {
    encoding: 'utf8',
    input,
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: dir, STUB_LOG: log },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  return { ...result, calls };
}

/** The compose commands that act on a project (the plugin probe does not). */
const projectCalls = (calls) => calls.filter((call) => call.startsWith('docker compose ') && call !== 'docker compose version');

test('demo.sh down removes the demo project and nothing else (#847)', () => {
  const { status, calls, stderr } = run('scripts/demo.sh', ['down']);
  assert.equal(status, 0, stderr);
  const down = calls.filter((call) => / down( |$)/.test(call));
  assert.equal(down.length, 1, calls.join('\n'));
  assert.match(down[0], /-p staffscheduler-demo /);
  // Every compose call the script makes is scoped to the demo project; one
  // without -p would resolve to the deployment's default project.
  for (const call of projectCalls(calls)) assert.match(call, /-p staffscheduler-demo /, call);
});

test('stop.sh -c removes containers but keeps every volume (#847)', () => {
  const { status, calls, stderr } = run('stop.sh', ['-c']);
  assert.equal(status, 0, stderr);
  const down = calls.filter((call) => / down( |$)/.test(call));
  assert.equal(down.length, 1, calls.join('\n'));
  assert.doesNotMatch(down[0], / -v( |$)|--volumes/);
});

for (const [label, input] of [['no answer', ''], ['the wrong answer', 'yes\n']]) {
  test(`stop.sh -p with ${label} deletes nothing (#847)`, () => {
    const { status, calls } = run('stop.sh', ['-p'], { input });
    assert.notEqual(status, 0);
    assert.deepEqual(calls.filter((call) => / down( |$)/.test(call)), []);
  });
}

test('stop.sh -p deletes the volumes once DELETE is typed (#847)', () => {
  const { status, calls, stderr } = run('stop.sh', ['-p'], { input: 'DELETE\n' });
  assert.equal(status, 0, stderr);
  const down = calls.filter((call) => / down( |$)/.test(call));
  assert.equal(down.length, 1, calls.join('\n'));
  assert.match(down[0], / -v( |$)/);
});
