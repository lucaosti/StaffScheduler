#!/usr/bin/env node
/**
 * The dependency-advisory gate, run in place of a bare `npm audit`.
 *
 * WHY THIS EXISTS. Both CI jobs ran `npm audit --audit-level=high --omit=dev`
 * and both failed intermittently with a 400 from
 * `/-/npm/v1/security/audits/quick` — an endpoint the registry is retiring —
 * carrying the message "Invalid package tree, run npm install to rebuild your
 * package-lock.json". That message is the least likely explanation, and was
 * disproved by the simplest possible experiment: re-running the identical job on
 * the identical lockfile passes. npm uses the BULK advisory endpoint normally
 * and falls back to `quick` when the bulk call fails; the 400 and its misleading
 * text are what that fallback produces. So the failure is transport, not tree.
 *
 * WHY IT MATTERS MORE THAN THE ANNOYANCE. A security gate that fails for reasons
 * unrelated to security teaches people to re-run it. Once "re-run the audit" is
 * the reflex, a genuine advisory gets the same treatment and the gate has
 * stopped being one. Fixing the flake is how the gate keeps its authority.
 *
 * WHAT THIS DOES DIFFERENTLY. It asks npm for the report as JSON and decides
 * locally, rather than delegating the decision to an exit code that conflates
 * "found a vulnerability" with "could not reach the registry". Those are
 * different events and this script never confuses them:
 *
 *  - a report that parses and contains a high or critical advisory  -> FAIL
 *  - a report that parses and contains nothing at that level        -> pass
 *  - no report after every retry (registry unreachable or erroring) -> pass,
 *    loudly, as a GitHub warning annotation on the run
 *
 * THE LAST CASE IS A DECISION, NOT A `|| true`. Blocking every merge on the
 * availability of an external service is its own failure mode, and one nobody
 * can fix from inside the repository — the realistic response to it is to
 * disable the gate, which is strictly worse. So an unreachable registry degrades
 * to a visible warning, while ANY advisory the registry does report still fails
 * the build. What is explicitly NOT tolerated is a report that arrives and
 * contains a finding: no network condition can produce that.
 *
 * The retries come first, because a flake retried is better than a flake
 * tolerated: three attempts with backoff turn the observed intermittent 400 into
 * a pass in almost every case, and the degradation is what remains for a real
 * outage.
 *
 * The decision itself — `parseReport` and `describe` — is exported and pure, so
 * the two cases that must never be confused can be tested without a network:
 * "npm answered and found something" and "npm did not answer".
 *
 * @author Luca Ostinelli
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Advisory levels that fail the build, mirroring `--audit-level=high`. */
const BLOCKING = ['high', 'critical'];
const ATTEMPTS = 3;
/** Backoff between attempts, in ms. Short: this is a flake, not a queue. */
const BACKOFF_MS = [0, 3_000, 10_000];

const isCi = process.env.GITHUB_ACTIONS === 'true';

/** A GitHub annotation when running in Actions, a plain line otherwise. */
const warn = (message) => {
  console.warn(isCi ? `::warning title=Dependency audit::${message}` : `WARNING: ${message}`);
};

const runAudit = () =>
  new Promise((resolve) => {
    // `--omit=dev` keeps the gate on what actually ships. npm exits non-zero
    // when it finds anything at all, so the exit code is not the signal here —
    // the parsed report is.
    const child = spawn('npm', ['audit', '--json', '--omit=dev'], {
      cwd: process.cwd(),
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => resolve({ stdout: '', stderr: String(error) }));
    child.on('close', () => resolve({ stdout, stderr }));
  });

/**
 * The report, or null if npm produced no usable one.
 *
 * npm prints its JSON error object to stdout too, so a successful parse is not
 * enough — a report is only a report if it carries the vulnerability metadata
 * the decision is made from. Anything else is treated as no answer.
 */
export const parseReport = (stdout) => {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object' && parsed.metadata?.vulnerabilities) {
    return parsed;
  }
  return null;
};

export const describe = (report) => {
  const counts = report.metadata.vulnerabilities;
  const blocking = BLOCKING.reduce((sum, level) => sum + (counts[level] ?? 0), 0);
  const named = Object.entries(report.vulnerabilities ?? {})
    .filter(([, v]) => BLOCKING.includes(v.severity))
    .map(([name, v]) => `  ${v.severity.padEnd(8)} ${name} — ${(v.via ?? [])
      .map((entry) => (typeof entry === 'string' ? entry : entry.title))
      .filter(Boolean)
      .join('; ')}`);
  return { counts, blocking, named };
};

export const main = async () => {
  let report = null;
  let lastStderr = '';

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (BACKOFF_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]));
    }
    const { stdout, stderr } = await runAudit();
    lastStderr = stderr;
    report = parseReport(stdout);
    if (report) break;
    warn(`npm audit returned no usable report (attempt ${attempt + 1}/${ATTEMPTS}).`);
  }

  if (!report) {
    // The degradation. Loud, named, and never silent — a gate that skipped
    // quietly would read as coverage it is not providing.
    warn(
      'Dependency audit SKIPPED: the npm registry returned no usable report after ' +
        `${ATTEMPTS} attempts. This does NOT mean the tree is clean — nothing was checked. ` +
        `Last error from npm: ${lastStderr.trim().split('\n').slice(-3).join(' ') || '(none)'}`
    );
    process.exit(0);
  }

  const { counts, blocking, named } = describe(report);
  const summary = Object.entries(counts)
    .filter(([level, n]) => level !== 'total' && n > 0)
    .map(([level, n]) => `${n} ${level}`)
    .join(', ');

  if (blocking > 0) {
    console.error(`Dependency audit FAILED: ${blocking} high or critical advisory(ies).`);
    console.error(named.join('\n'));
    console.error('\nProduction dependencies only (--omit=dev).');
    process.exit(1);
  }

  console.log(
    `Dependency audit passed: no high or critical advisories in production dependencies${
      summary ? ` (${summary} at lower levels)` : ''
    }.`
  );
};

// Only when run as a program. Importing the module — which the tests do, to
// exercise the decision without a network — must not audit anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // An unexpected fault in this script is not an all-clear.
    console.error(`Dependency audit could not run: ${error?.stack ?? error}`);
    process.exit(1);
  });
}
