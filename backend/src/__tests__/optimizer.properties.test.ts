/**
 * Seeded property suite: both engines against the canonical validator on
 * random small instances (#907).
 *
 * The parity suite checks fixed fixtures, and fixed fixtures only test the
 * shapes their author thought of — which is how CP-SAT came to truncate
 * half-hours (#834) and the greedy to miss a night shift overlapping the next
 * morning (#835) while every parity test was green. This suite asserts the
 * same guarantees over instances nobody chose:
 *
 *   (a) greedy output breaks no hard rule;
 *   (b) CP-SAT output breaks no hard rule;
 *   (c) every assignment pairs a known, eligible employee with a known shift,
 *       at most once;
 *   (d) the same seed yields the same instance and the same greedy schedule;
 *   (e) when CP-SAT proves OPTIMAL, it fills at least as many seats as the
 *       greedy. Sound because the greedy's output is legal under CP-SAT's own
 *       model and CP-SAT minimises the coverage shortfall above everything
 *       else — so a greedy that out-covers an OPTIMAL CP-SAT means CP-SAT's
 *       model forbids something the validator allows.
 *
 * SEEDS. `TEST_SEED` overrides the fixed default. A failure first prints the
 * base seed, the instance index and the unshrunk instance — before anything
 * that could time out — then shrinks it by removals within a time budget and
 * reports the result as an `OptimizerFixture` literal for optimizerFixtures.ts:
 * a random failure is meant to become a fixed regression test, not to be
 * re-rolled away.
 *
 * SIZE. Instances are at most 6 employees, 3 days and 8 shifts. The greedy is
 * cheap, so it sees many; CP-SAT costs a Python start per instance, so it sees
 * fewer, run concurrently with one search worker each and a short time limit.
 * A single worker that finishes inside its limit is deterministic, which a
 * replayed seed needs; a run cut off by the limit is not, which is one more
 * reason the instances are kept small enough to be proven well within it.
 *
 * @author Luca Ostinelli
 */

import { ScheduleOptimizer } from '../optimization/ScheduleOptimizerORTools';
import { findConstraintViolations, type ValidatedAssignment } from '../optimization/constraintValidator';
import { DAY_MS, dateToMs, shiftBoundsMs } from '../optimization/shiftTime';
import type { OptimizationProblem } from '../optimization/types';
import { describeOrtools, solveCpSat, solveCpSatAsync, type CpSatResult } from './helpers/cpSat';
import { asFixture, baseSeed, generateInstance, instanceSeed, shrink } from './helpers/scheduleGenerator';

const BASE_SEED = baseSeed();
const GREEDY_INSTANCES = 500;
const CPSAT_INSTANCES = 120;
const CPSAT_CONCURRENCY = 4;
const CPSAT_ENV = { ...process.env, OPTIMIZATION_SEARCH_WORKERS: '1' };
const CPSAT_TIME_LIMIT_SECONDS = 5;
/** How long a failure may spend shrinking; the property tests' timeout sits above it. */
const SHRINK_BUDGET_MS = 120_000;
const PROPERTY_TIMEOUT_MS = SHRINK_BUDGET_MS + 60_000;
// Above the shrink budget, so a failure is reported rather than cut off by
// the default 30s timeout while it is still being reduced.
jest.setTimeout(PROPERTY_TIMEOUT_MS);

interface Instance {
  index: number;
  seed: number;
  problem: OptimizationProblem;
}

const instances: Instance[] = Array.from({ length: GREEDY_INSTANCES }, (_, index) => {
  const seed = instanceSeed(BASE_SEED, index);
  return { index, seed, problem: generateInstance(seed) };
});

const optimizer = new ScheduleOptimizer();

const greedy = async (problem: OptimizationProblem): Promise<ValidatedAssignment[]> =>
  (await optimizer.generateGreedySchedule(problem)).map((a) => ({ employeeId: a.employeeId, shiftId: a.shiftId }));

/** Assignments that pair an unknown or ineligible employee and shift, or repeat a pair. */
const ineligible = (problem: OptimizationProblem, assignments: ValidatedAssignment[]): string[] => {
  const shifts = new Map(problem.shifts.map((s) => [s.id, s]));
  const employees = new Map(problem.employees.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const found: string[] = [];
  for (const { employeeId, shiftId } of assignments) {
    const pair = `${employeeId}->${shiftId}`;
    const shift = shifts.get(shiftId);
    const employee = employees.get(employeeId);
    if (!shift || !employee) found.push(`${pair}: unknown`);
    else if (seen.has(pair)) found.push(`${pair}: repeated`);
    else if (employee.unavailable_dates.includes(shift.date)) found.push(`${pair}: unavailable`);
    else {
      for (const skill of shift.required_skills ?? []) {
        const required = shift.required_skill_levels?.[skill];
        const held = employee.skill_levels?.[skill];
        if (!employee.skills.includes(skill) || (required !== undefined && held !== undefined && held < required)) {
          found.push(`${pair}: lacks ${skill}`);
        }
      }
    }
    seen.add(pair);
  }
  return found;
};

/** Seats filled up to each shift's min_staff — what both engines' coverage aims at. */
const filledSeats = (problem: OptimizationProblem, assignments: ValidatedAssignment[]): number =>
  problem.shifts.reduce(
    (sum, s) => sum + Math.min(s.min_staff, assignments.filter((a) => a.shiftId === s.id).length),
    0
  );

/**
 * Throw a replayable report for the first failing instance, shrunk.
 *
 * `fails` is re-run on every candidate reduction; a candidate that throws is
 * treated as not reproducing the failure, so the shrinker never walks into a
 * crash and reports that instead of the property.
 */
const assertNoFailures = async (
  property: string,
  failing: Instance[],
  fails: (problem: OptimizationProblem) => boolean | Promise<boolean>,
  explain: (problem: OptimizationProblem) => unknown | Promise<unknown>
): Promise<void> => {
  if (failing.length === 0) return;
  const [first] = failing;
  const header = [
    `Property "${property}" failed on ${failing.length} instance(s): #${failing.map((f) => f.index).join(', #')}`,
    `Replay with TEST_SEED=${BASE_SEED} (instance #${first.index}, instance seed ${first.seed}).`,
  ];
  // Written before shrinking: if shrinking is killed (timeout, interrupted
  // run), the seed and a failing instance must already be on record.
  process.stderr.write(
    [...header, 'Unshrunk failing instance:', asFixture(`${property} (unshrunk)`, first.problem), ''].join('\n')
  );
  const safe = async (p: OptimizationProblem) => {
    try {
      return await fails(p);
    } catch {
      return false;
    }
  };
  const { problem: minimal, complete } = await shrink(first.problem, safe, SHRINK_BUDGET_MS);
  throw new Error(
    [
      ...header,
      complete
        ? 'Minimal failing instance, as an OptimizerFixture for optimizerFixtures.ts:'
        : `Shrinking stopped at its ${SHRINK_BUDGET_MS / 1000}s budget; failing instance, not necessarily minimal:`,
      asFixture(`${property} (TEST_SEED=${BASE_SEED} #${first.index})`, minimal),
      `On it: ${JSON.stringify(await explain(minimal), null, 2)}`,
    ].join('\n')
  );
};

const addDay = (date: string) => new Date(dateToMs(date) + DAY_MS).toISOString().slice(0, 10);

/** Whether an employee could hold any shift at all (skills, levels, unavailability). */
const eligibleForSome = (p: OptimizationProblem, e: OptimizationProblem['employees'][number]) =>
  p.shifts.some((s) => ineligible({ ...p, employees: [e] }, [{ employeeId: e.id, shiftId: s.id }]).length === 0);

describe('seeded instance generator', () => {
  it('yields the identical instance for the same seed (d)', () => {
    for (const { seed, problem } of instances) expect(generateInstance(seed)).toEqual(problem);
  });

  it('draws different instances for different seeds', () => {
    const distinct = new Set(instances.map((i) => JSON.stringify(i.problem)));
    expect(distinct.size).toBeGreaterThan(GREEDY_INSTANCES * 0.95);
  });

  it('covers the shapes it exists to cover', () => {
    // A generator that stopped emitting a shape would let the properties
    // pass vacuously for it; this keeps each one present in the default run.
    const problems = instances.map((i) => i.problem);
    const some = (pred: (p: OptimizationProblem) => boolean) => problems.some(pred);
    expect(some((p) => p.shifts.some((s) => s.start_time.endsWith(':30') || s.end_time.endsWith(':30')))).toBe(true);
    expect(some((p) => p.shifts.some((s) => s.end_time <= s.start_time))).toBe(true);
    expect(some((p) => p.employees.some((e) => (e.existing_assignments ?? []).length > 0))).toBe(true);
    expect(some((p) => (p.pairings ?? []).some((r) => r.kind === 'apart'))).toBe(true);
    expect(some((p) => (p.pairings ?? []).some((r) => r.kind === 'requires'))).toBe(true);
    expect(some((p) => p.shifts.some((s) => s.required_skill_levels !== undefined))).toBe(true);
    expect(some((p) => p.employees.some((e) => e.max_hours_per_day !== undefined))).toBe(true);
    expect(some((p) => p.employees.some((e) => e.max_consecutive_days !== undefined))).toBe(true);
    expect(some((p) => p.constraints?.min_hours_between_shifts === 10.5)).toBe(true);
    // An employee whose own rest differs from the problem's (#838).
    expect(
      some((p) =>
        p.employees.some(
          (e) =>
            e.min_hours_between_shifts !== undefined &&
            e.min_hours_between_shifts !== (p.constraints?.min_hours_between_shifts ?? 8)
        )
      )
    ).toBe(true);
    // Durations that are not whole tenths of an hour (2h40 is 2.666...h).
    expect(some((p) => p.shifts.some((s) => /:[1245]0$/.test(s.start_time) || /:[1245]0$/.test(s.end_time)))).toBe(
      true
    );
    // Unavailable the day after an overnight shift (#853's shape).
    expect(
      some((p) =>
        p.shifts.some(
          (s) => s.end_time <= s.start_time && p.employees.some((e) => e.unavailable_dates.includes(addDay(s.date)))
        )
      )
    ).toBe(true);
    // An employee eligible for no shift at all (#839's shape).
    expect(some((p) => p.employees.some((e) => !eligibleForSome(p, e)))).toBe(true);
    // A night shift overlapping a shift that starts the next day (#835's shape).
    expect(
      some((p) =>
        p.shifts.some((n) => {
          const [, nightEnd] = shiftBoundsMs(n);
          return p.shifts.some((m) => m.date === addDay(n.date) && shiftBoundsMs(m)[0] < nightEnd);
        })
      )
    ).toBe(true);
    // External work outside the period that survived the drop step, so a
    // rolling window straddles the boundary.
    expect(
      some((p) => {
        const dates = p.shifts.map((s) => s.date).sort();
        return p.employees.some((e) =>
          (e.existing_assignments ?? []).some((x) => x.date < dates[0] || x.date > dates[dates.length - 1])
        );
      })
    ).toBe(true);
    // A period crossing a calendar-week boundary (Sunday into Monday).
    expect(
      some((p) => {
        const dates = [...new Set(p.shifts.map((s) => s.date))].sort();
        return dates.some((d, i) => i > 0 && new Date(dateToMs(d)).getUTCDay() === 1);
      })
    ).toBe(true);
  });

  it('shrinks a failing instance to the part that fails', async () => {
    const { problem } = instances.find((i) => i.problem.shifts.length > 3 && i.problem.employees.length > 2)!;
    const hasOvernight = (p: OptimizationProblem) => p.shifts.some((s) => s.end_time <= s.start_time);
    const seeded = { ...problem, shifts: [...problem.shifts, { ...problem.shifts[0], id: 'night', start_time: '22:00', end_time: '06:00' }] };
    const { problem: minimal, complete } = await shrink(seeded, hasOvernight);
    expect(complete).toBe(true);
    expect(minimal.shifts).toHaveLength(1);
    expect(hasOvernight(minimal)).toBe(true);
    expect(minimal.employees).toHaveLength(1);
    expect(minimal.pairings ?? []).toEqual([]);
  });

  it('stops shrinking at its budget and says so', async () => {
    const { problem } = instances.find((i) => i.problem.shifts.length > 3)!;
    const { problem: partial, complete } = await shrink(problem, () => true, -1);
    expect(complete).toBe(false);
    expect(partial).toBe(problem);
  });
});

describe('greedy engine on seeded instances', () => {
  it('breaks no hard rule (a)', async () => {
    const failing: Instance[] = [];
    for (const instance of instances) {
      if (findConstraintViolations(instance.problem, await greedy(instance.problem)).length > 0) failing.push(instance);
    }
    await assertNoFailures(
      'greedy breaks no hard rule',
      failing,
      async (p) => findConstraintViolations(p, await greedy(p)).length > 0,
      async (p) => findConstraintViolations(p, await greedy(p))
    );
  });

  it('assigns only eligible pairs (c)', async () => {
    const failing: Instance[] = [];
    for (const instance of instances) {
      if (ineligible(instance.problem, await greedy(instance.problem)).length > 0) failing.push(instance);
    }
    await assertNoFailures(
      'greedy assigns only eligible pairs',
      failing,
      async (p) => ineligible(p, await greedy(p)).length > 0,
      async (p) => ineligible(p, await greedy(p))
    );
  });

  it('produces the identical schedule for the same seed (d)', async () => {
    for (const { seed, problem } of instances) {
      expect(await greedy(generateInstance(seed))).toEqual(await greedy(problem));
    }
  });
});

describeOrtools('CP-SAT engine on seeded instances', () => {
  const sample = instances.slice(0, CPSAT_INSTANCES);
  let results: CpSatResult[] = [];

  beforeAll(async () => {
    results = new Array<CpSatResult>(sample.length);
    let next = 0;
    const worker = async () => {
      while (next < sample.length) {
        const i = next++;
        results[i] = await solveCpSatAsync(sample[i].problem, CPSAT_ENV, CPSAT_TIME_LIMIT_SECONDS);
      }
    };
    await Promise.all(Array.from({ length: CPSAT_CONCURRENCY }, worker));
  }, 180_000);

  const solve = (p: OptimizationProblem) => solveCpSat(p, CPSAT_ENV, CPSAT_TIME_LIMIT_SECONDS);
  const solved = (r: CpSatResult) => r.status === 'OPTIMAL' || r.status === 'FEASIBLE';

  it('returns a schedule for every instance', async () => {
    // Every generated instance is solvable — the empty schedule is legal — so
    // anything else is an engine fault, not a hard instance.
    await assertNoFailures(
      'CP-SAT returns a schedule',
      sample.filter((_, i) => !solved(results[i])),
      (p) => !solved(solve(p)),
      (p) => {
        const { status, error } = solve(p);
        return { status, error };
      }
    );
  });

  it('breaks no hard rule (b)', async () => {
    const failing = sample.filter((s, i) => findConstraintViolations(s.problem, results[i].assignments).length > 0);
    await assertNoFailures(
      'CP-SAT breaks no hard rule',
      failing,
      (p) => findConstraintViolations(p, solve(p).assignments).length > 0,
      (p) => findConstraintViolations(p, solve(p).assignments)
    );
  });

  it('assigns only eligible pairs (c)', async () => {
    const failing = sample.filter((s, i) => ineligible(s.problem, results[i].assignments).length > 0);
    await assertNoFailures(
      'CP-SAT assigns only eligible pairs',
      failing,
      (p) => ineligible(p, solve(p).assignments).length > 0,
      (p) => ineligible(p, solve(p).assignments)
    );
  });

  it('fills at least as many seats as the greedy when it proves optimality (e)', async () => {
    const optimal = sample.filter((_, i) => results[i].status === 'OPTIMAL');
    // Small instances should nearly always be proven; if they stop being,
    // this property would pass by checking nothing.
    expect(optimal.length).toBeGreaterThan(CPSAT_INSTANCES / 2);

    const outCovered = async (p: OptimizationProblem, cpSat: CpSatResult) =>
      cpSat.status === 'OPTIMAL' && filledSeats(p, cpSat.assignments) < filledSeats(p, await greedy(p));
    const failing: Instance[] = [];
    for (const s of optimal) {
      if (await outCovered(s.problem, results[sample.indexOf(s)])) failing.push(s);
    }
    await assertNoFailures(
      'CP-SAT fills at least as many seats as the greedy',
      failing,
      (p) => outCovered(p, solve(p)),
      async (p) => ({ cpSat: filledSeats(p, solve(p).assignments), greedy: filledSeats(p, await greedy(p)) })
    );
  });
});
