/**
 * The audit gate's decision, exercised without a network.
 *
 * The whole point of the script is that two events must never be confused:
 * "npm answered and found a high advisory" and "npm did not answer". A bare
 * `npm audit` conflates them in one exit code, which is how a retiring registry
 * endpoint came to fail builds that had nothing wrong with them. These cases
 * pin the distinction.
 *
 * Run with `node --test scripts/` — no framework, because a gate that needed the
 * dev dependencies installed to verify itself would be circular.
 *
 * @author Luca Ostinelli
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { describe, parseReport } from './audit-dependencies.mjs';

const report = (vulnerabilities, entries = {}) =>
  JSON.stringify({ metadata: { vulnerabilities }, vulnerabilities: entries });

const clean = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };

test('a real report parses', () => {
  const parsed = parseReport(report({ ...clean, moderate: 2, total: 2 }));
  assert.notEqual(parsed, null);
  assert.equal(parsed.metadata.vulnerabilities.moderate, 2);
});

test('npm\'s own JSON error object is NOT a report', () => {
  // This is the exact failure mode: npm prints a parseable object that carries
  // no vulnerability metadata, so a naive JSON.parse would treat a registry
  // error as an all-clear.
  const npmError = JSON.stringify({
    error: {
      code: 'E400',
      summary: 'Invalid package tree, run npm install to rebuild your package-lock.json',
      detail: '',
    },
  });
  assert.equal(parseReport(npmError), null);
});

test('unparseable output is not a report', () => {
  assert.equal(parseReport(''), null);
  assert.equal(parseReport('npm warn audit 400 Bad Request'), null);
  assert.equal(parseReport('null'), null);
});

test('moderate and low advisories do not block', () => {
  // The two react-router advisories this repository carries knowingly are
  // moderate; the gate is `--audit-level=high` and stays that way.
  const { blocking } = describe(JSON.parse(report({ ...clean, low: 3, moderate: 2, total: 5 })));
  assert.equal(blocking, 0);
});

test('a high advisory blocks', () => {
  const { blocking, named } = describe(
    JSON.parse(
      report({ ...clean, high: 1, total: 1 }, {
        'brace-expansion': { severity: 'high', via: [{ title: 'Regular Expression DoS' }] },
      })
    )
  );
  assert.equal(blocking, 1);
  // The failure has to name what it found, or the next person re-runs it to see.
  assert.match(named.join('\n'), /brace-expansion/);
  assert.match(named.join('\n'), /Regular Expression DoS/);
});

test('a critical advisory blocks', () => {
  const { blocking } = describe(JSON.parse(report({ ...clean, critical: 1, total: 1 })));
  assert.equal(blocking, 1);
});

test('high and critical are counted together', () => {
  const { blocking } = describe(JSON.parse(report({ ...clean, high: 2, critical: 1, total: 3 })));
  assert.equal(blocking, 3);
});

test('a via entry that is a plain string is handled', () => {
  // npm writes a string when the vulnerability is transitive, and an object when
  // it is direct. Both shapes appear in one report.
  const { named } = describe(
    JSON.parse(
      report({ ...clean, high: 1, total: 1 }, {
        'some-pkg': { severity: 'high', via: ['other-pkg'] },
      })
    )
  );
  assert.match(named.join('\n'), /other-pkg/);
});

test('a report with no vulnerabilities map still decides', () => {
  const { blocking, named } = describe(JSON.parse(report({ ...clean })));
  assert.equal(blocking, 0);
  assert.deepEqual(named, []);
});
