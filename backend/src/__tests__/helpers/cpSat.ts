/**
 * Test helper: run the Python CP-SAT engine the way the parity suites need.
 *
 * WHY THIS EXISTS. The OR-Tools gate and the stdin/stdout call lived inside
 * optimizer.parity.test.ts. The seeded property suite measures the same engine
 * against the same validator and must sit behind the SAME gate — mandatory
 * under REQUIRE_ORTOOLS=1, self-skipping only on a machine without OR-Tools.
 * A second copy of that gate is how the two suites would end up enforcing
 * different things, so both import it from here.
 *
 * Two runners because the callers want different things: the fixed fixtures
 * call one engine per test and read best synchronously, while the property
 * suite solves dozens of instances and runs them concurrently.
 */

import { spawn, spawnSync } from 'child_process';
import { join } from 'path';
import type { ValidatedAssignment } from '../../optimization/constraintValidator';

export const PYTHON_SCRIPT = join(__dirname, '../../../optimization-scripts/schedule_optimizer.py');

const REQUIRE_ORTOOLS = process.env.REQUIRE_ORTOOLS === '1';

/** Probe whether python3 + ortools are importable in this environment. */
const ortoolsAvailable = (): boolean => {
  const probe = spawnSync('python3', ['-c', 'import ortools'], { encoding: 'utf8' });
  return probe.status === 0;
};

/** `describe` when CP-SAT can (or must) run, `describe.skip` otherwise. */
export const describeOrtools = REQUIRE_ORTOOLS || ortoolsAvailable() ? describe : describe.skip;

export interface CpSatResult {
  status: string;
  assignments: ValidatedAssignment[];
  /** Employees the engine excluded because external work already breaches a cap. */
  overCommittedIds: string[];
  /** The script's reason when `status` is ERROR. */
  error?: string;
}

interface RawResult {
  status: string;
  error?: string;
  assignments?: Array<{ employee_id: string; shift_id: string }>;
  over_committed_employees?: Array<{ employee_id: string }>;
}

const ARGS = [PYTHON_SCRIPT, '--stdin', '--stdout', '--time-limit', '10'];

/*
 * Exit 2 is the script's ERROR protocol: a JSON body naming the fault. It is
 * returned as a result rather than thrown so a property can report WHICH
 * instance made the engine fail, with the reason; only a crash that wrote no
 * JSON at all throws.
 */
const parse = (code: number | null, stdout: string, stderr: string): CpSatResult => {
  if (code !== 0 && code !== 1 && code !== 2) {
    throw new Error(`Python optimizer failed (status ${code}): ${stderr}`);
  }
  const parsed = JSON.parse(stdout) as RawResult;
  return {
    status: parsed.status,
    error: parsed.error,
    assignments: (parsed.assignments ?? []).map((a) => ({
      employeeId: String(a.employee_id),
      shiftId: String(a.shift_id),
    })),
    overCommittedIds: (parsed.over_committed_employees ?? []).map((o) => String(o.employee_id)),
  };
};

/** Solve synchronously with the engine's default search workers. */
export const solveCpSat = (problem: unknown, env: typeof process.env = process.env): CpSatResult => {
  const res = spawnSync('python3', ARGS, {
    input: JSON.stringify(problem),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env,
  });
  return parse(res.status, res.stdout, res.stderr);
};

/** Solve in a child process without blocking, so several instances can run at once. */
export const solveCpSatAsync = (problem: unknown, env: typeof process.env): Promise<CpSatResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('python3', ARGS, { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        resolve(parse(code, stdout, stderr));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(problem));
  });

/** Solve a problem expected to yield a schedule, and return its assignments. */
export const runPython = (problem: unknown): ValidatedAssignment[] => {
  const result = solveCpSat(problem);
  if (result.status !== 'OPTIMAL' && result.status !== 'FEASIBLE') {
    throw new Error(`Python optimizer returned ${result.status} for a feasible fixture${result.error ? `: ${result.error}` : ''}`);
  }
  return result.assignments;
};
