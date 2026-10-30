/**
 * The OR-Tools wrapper against a REAL child process (#836).
 *
 * Kept apart from scheduleOptimizer.test.ts because that suite mocks
 * `child_process` whole, and the defect here only exists between two real
 * ends of a pipe: a python3 that exits before reading its input (as it does
 * when ortools is missing) closes the pipe while a problem larger than the
 * pipe buffer is still being written, and the write fails with EPIPE. With no
 * listener on stdin that error was thrown as an uncaught exception, which
 * took the backend down. A mocked stdin can emit the error, but cannot show
 * that a real pipe produces it on the path the code actually takes.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import type { OptimizationProblem } from '../optimization/types';

describe('ScheduleOptimizer with a solver that exits without reading its input', () => {
  let dir: string;
  let stub: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'optimizer-stub-'));
    stub = join(dir, 'exits_immediately.py');
    writeFileSync(stub, 'import sys\nsys.exit(3)\n');
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('degrades to greedy, and the process survives, when the payload exceeds the pipe buffer', async () => {
    const optimizer = new ScheduleOptimizer();
    (optimizer as unknown as { pythonScriptPath: string }).pythonScriptPath = stub;

    // Far beyond any pipe buffer (64 KiB on Linux), so the write cannot
    // complete before the stub has exited.
    const problem: OptimizationProblem = {
      shifts: [{ id: 's1', date: '2026-03-02', start_time: '09:00', end_time: '17:00', min_staff: 1 }],
      employees: [{ id: 'e1', max_hours_per_week: 40, skills: [], unavailable_dates: [] }],
      constraints: { padding: 'x'.repeat(8 * 1024 * 1024) },
    };

    const result = await optimizer.optimize(problem);

    // Reaching this line at all is the regression: before the fix the EPIPE
    // was an uncaught exception and the test process died.
    expect(result.status).toBe('GREEDY_FALLBACK');
    expect(result.assignments).toEqual([expect.objectContaining({ employeeId: 'e1', shiftId: 's1' })]);
  });
});
