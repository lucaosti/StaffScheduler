/**
 * Test helper: seeded random scheduling instances, and a shrinker for the
 * ones that break a property (#907).
 *
 * WHY RANDOM INSTANCES AT ALL. Every fixed parity fixture was written by
 * someone who already knew where the rule was, so it tested the shape the
 * author had in mind — whole-hour shifts on one date, a rest gap well clear of
 * the limit. Three engine defects (#834, #835, #839) lived in exactly the
 * shapes nobody wrote down: half-hour durations, a night shift running into
 * the next day's, an employee eligible for nothing. A generator is not smarter
 * than the fixtures; it is less selective.
 *
 * WHY A HAND-WRITTEN PRNG AND SHRINKER RATHER THAN fast-check. fast-check
 * would give both, but it is built around arbitraries of independent values,
 * while an instance here is one coupled structure: pairings name employees,
 * unavailability targets the day after an overnight shift, externals must not
 * already breach a cap. Expressing that through combinators costs more code
 * than writing the instance directly, and its shrinking would still need
 * custom logic to keep an instance well formed. What the suite needs from a
 * library is twenty lines of mulberry32 and a remove-one-thing-at-a-time
 * loop, so it does not take a dependency for them.
 *
 * DETERMINISM. Instance `i` is drawn from its own stream seeded by
 * `instanceSeed(base, i)`, so a failure is replayed from two numbers without
 * generating the instances before it, and adding a field to the generator
 * shifts no other instance's draws more than it must.
 */

import { findConstraintViolations, findOverCommitments } from '../../optimization/constraintValidator';
import { DAY_MS, dateToMs } from '../../optimization/shiftTime';
import type { Employee, OptimizationProblem, Shift } from '../../optimization/types';

/**
 * The default base seed: fixed so CI is deterministic. Override with TEST_SEED.
 * Other seeded suites (the API fuzzer, #908) pass their own fixed default.
 */
const DEFAULT_SEED = 907;

export const baseSeed = (fallback: number = DEFAULT_SEED): number => {
  const raw = process.env.TEST_SEED;
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`TEST_SEED must be an integer, got "${raw}"`);
  return parsed >>> 0;
};

/** Per-instance seed: base mixed with the index through the golden-ratio constant. */
export const instanceSeed = (base: number, index: number): number =>
  (base ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;

/** mulberry32 — small, fast, and good enough for test-case generation. */
export const createRng = (seed: number) => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    chance: (p: number): boolean => next() < p,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)],
  };
};

const addDays = (date: string, days: number): string =>
  new Date(dateToMs(date) + days * DAY_MS).toISOString().slice(0, 10);

/** "HH:MM" for a minute offset, wrapping past midnight. */
const clockTime = (offset: number): string => {
  const minutes = offset % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

const SKILLS = ['RN', 'ICU'] as const;

/*
 * Durations in minutes. Weighted toward the boundaries the engines have got
 * wrong rather than uniform, because a uniform draw rarely lands on a cap
 * exactly: 8 h, 8.5 h and 10.5 h on the half-hour grid, and on the 10-minute
 * grid 2h40, three of which make exactly 8 h — a sum that hours rounded to
 * 0.1 used to read as 8.1 h.
 */
const HALF_HOUR_DURATIONS = [120, 240, 360, 480, 480, 510, 510, 600, 630, 720];
const TEN_MINUTE_DURATIONS = [160, 160, 160, 250, 470, 490];

/*
 * Caps chosen so the two engines' fallback daily budgets agree: Python
 * computes max(8, week // 5) and TypeScript max(8, week / 5), which differ for
 * a week above 40 that is not a multiple of 5 (#853). That divergence is a
 * known separate defect; generating it here would make every property fail on
 * it rather than on what each property is about.
 */
const WEEKLY_CAPS = [12, 16, 20, 24, 37.5, 40];
const DAILY_CAPS = [6, 8, 8.5, 10, 12];
// 0 lets several shifts share a day, which is what makes a daily cap bind.
const REST_HOURS = [0, 6, 8, 10.5, 11, 12];

/*
 * Mostly the half-hour grid real rotas use; sometimes a 10-minute grid, so
 * durations that are not a whole number of tenths of an hour are exercised.
 */
const randomTimes = (rng: ReturnType<typeof createRng>) => {
  const tenMinute = rng.chance(0.3);
  let start: number;
  let duration: number;
  if (tenMinute) {
    start = rng.int(0, 143) * 10;
    duration = rng.chance(0.7) ? rng.pick(TEN_MINUTE_DURATIONS) : rng.int(12, 72) * 10;
  } else {
    start = rng.int(0, 47) * 30;
    duration = rng.chance(0.7) ? rng.pick(HALF_HOUR_DURATIONS) : rng.int(4, 24) * 30;
  }
  return { start_time: clockTime(start), end_time: clockTime(start + duration) };
};

const isOvernight = (s: { start_time: string; end_time: string }): boolean => s.end_time <= s.start_time;

/**
 * One small instance: at most 6 employees, 3 days and 8 shifts, so CP-SAT
 * proves optimality in well under a second.
 *
 * Deliberately NOT generated: `qualified_staff` and preferences. CP-SAT
 * minimises the qualified-staff shortfall at the same level as coverage, so
 * with it present "CP-SAT fills at least as many seats as greedy" is no
 * longer a theorem; preferences only steer among equally good schedules and
 * change no property asserted here.
 */
export const generateInstance = (seed: number): OptimizationProblem => {
  const rng = createRng(seed);
  const start = addDays('2026-03-02', rng.int(0, 13));
  const dayCount = rng.int(1, 3);
  const days = Array.from({ length: dayCount }, (_, d) => addDays(start, d));

  const shifts: Shift[] = Array.from({ length: rng.int(1, 8) }, (_, i) => {
    const min = rng.int(1, 2);
    const shift: Shift = { id: `s${i + 1}`, date: rng.pick(days), ...randomTimes(rng), min_staff: min };
    if (rng.chance(0.8)) shift.max_staff = min + rng.int(0, 1);
    if (rng.chance(0.3)) {
      const skill = rng.pick(SKILLS);
      shift.required_skills = [skill];
      if (rng.chance(0.5)) shift.required_skill_levels = { [skill]: rng.int(1, 4) };
    }
    return shift;
  });

  // The day after each overnight shift: the shape #853 is about.
  const dayAfterNight = [...new Set(shifts.filter(isOvernight).map((s) => addDays(s.date, 1)))];

  const employees: Employee[] = Array.from({ length: rng.int(2, 6) }, (_, i) => {
    const skills = SKILLS.filter(() => rng.chance(0.5));
    const employee: Employee = {
      id: `e${i + 1}`,
      max_hours_per_week: rng.pick(WEEKLY_CAPS),
      skills,
      unavailable_dates: [
        ...new Set([...days.filter(() => rng.chance(0.15)), ...dayAfterNight.filter(() => rng.chance(0.3))]),
      ],
    };
    if (rng.chance(0.6)) employee.max_hours_per_day = rng.pick(DAILY_CAPS);
    if (rng.chance(0.4)) employee.max_consecutive_days = rng.int(1, 3);
    const levels = Object.fromEntries(skills.filter(() => rng.chance(0.6)).map((s) => [s, rng.int(1, 5)]));
    if (Object.keys(levels).length > 0) employee.skill_levels = levels;
    if (rng.chance(0.4)) {
      // Up to six days either side, so a rolling 7-day window straddles the
      // period boundary and external load counts against in-period caps.
      employee.existing_assignments = Array.from({ length: rng.int(1, 2) }, () => ({
        date: addDays(start, rng.int(-6, dayCount + 5)),
        ...randomTimes(rng),
      }));
    }
    return employee;
  });

  const problem: OptimizationProblem = { shifts, employees, constraints: {} };
  if (rng.chance(0.8)) problem.constraints = { min_hours_between_shifts: rng.pick(REST_HOURS) };
  if (employees.length >= 2 && rng.chance(0.4)) {
    problem.pairings = Array.from({ length: rng.int(1, 2) }, () => {
      const a = rng.int(0, employees.length - 1);
      const b = (a + rng.int(1, employees.length - 1)) % employees.length;
      return {
        employee_id: employees[a].id,
        other_id: employees[b].id,
        kind: rng.pick(['apart', 'requires'] as const),
      };
    });
  }

  // External work is a fact the engines cannot change. If it already breaks
  // a rule on its own, every engine's output "violates" it, and the instance
  // tests nothing but the generator — so such externals are dropped.
  for (const employee of employees) {
    if (!employee.existing_assignments) continue;
    const alone = { ...problem, employees: [employee] };
    if (findConstraintViolations(alone, []).length > 0 || findOverCommitments(alone).length > 0) {
      delete employee.existing_assignments;
    }
  }
  return problem;
};

/**
 * Every instance one removal smaller than `problem`, in an order that tries
 * the biggest reductions first. Never the last shift or the last employee:
 * an empty side is not a scheduling problem, and both engines reject it.
 */
function* reductions(problem: OptimizationProblem): Generator<OptimizationProblem> {
  const { shifts, employees, pairings = [] } = problem;
  for (let i = 0; employees.length > 1 && i < employees.length; i++) {
    const gone = employees[i].id;
    yield {
      ...problem,
      employees: employees.filter((_, j) => j !== i),
      pairings: pairings.filter((p) => p.employee_id !== gone && p.other_id !== gone),
    };
  }
  for (let i = 0; shifts.length > 1 && i < shifts.length; i++) {
    yield { ...problem, shifts: shifts.filter((_, j) => j !== i) };
  }
  for (let i = 0; i < pairings.length; i++) yield { ...problem, pairings: pairings.filter((_, j) => j !== i) };

  const withEmployee = (i: number, employee: Employee) => ({
    ...problem,
    employees: employees.map((e, j) => (j === i ? employee : e)),
  });
  for (let i = 0; i < employees.length; i++) {
    const e = employees[i];
    const external = e.existing_assignments ?? [];
    for (let k = 0; k < external.length; k++) {
      const rest = external.filter((_, j) => j !== k);
      const { existing_assignments: _dropped, ...without } = e;
      yield withEmployee(i, rest.length > 0 ? { ...e, existing_assignments: rest } : without);
    }
    for (let k = 0; k < e.unavailable_dates.length; k++) {
      yield withEmployee(i, { ...e, unavailable_dates: e.unavailable_dates.filter((_, j) => j !== k) });
    }
  }
  for (let i = 0; i < shifts.length; i++) {
    if (!shifts[i].required_skills) continue;
    const { required_skills: _skills, required_skill_levels: _levels, ...plain } = shifts[i];
    yield { ...problem, shifts: shifts.map((s, j) => (j === i ? plain : s)) };
  }
}

/**
 * Smallest instance reachable from `problem` by removals that still fail.
 *
 * Greedy and one-step: take the first reduction that keeps the failure and
 * start again from it, until none does. Not a global minimum, but every
 * remaining element is necessary to the failure, which is what makes the
 * printed case readable.
 */
export const shrink = async (
  problem: OptimizationProblem,
  fails: (candidate: OptimizationProblem) => boolean | Promise<boolean>,
  budgetMs = Infinity
): Promise<{ problem: OptimizationProblem; complete: boolean }> => {
  // Bounded because each CP-SAT check is a Python start: an unbounded shrink
  // of a large instance could outlive the test's timeout, and the failure
  // would then be reported as a timeout with no instance at all. Stopping
  // early still yields a failing instance, only a less minimal one.
  const deadline = Date.now() + budgetMs;
  let current = problem;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const candidate of reductions(current)) {
      if (Date.now() > deadline) return { problem: current, complete: false };
      if (await fails(candidate)) {
        current = candidate;
        progressed = true;
        break;
      }
    }
  }
  return { problem: current, complete: true };
};

/** An instance as an `OptimizerFixture` literal, ready to paste into optimizerFixtures.ts. */
export const asFixture = (name: string, problem: OptimizationProblem): string =>
  [
    '{',
    `  name: ${JSON.stringify(name)},`,
    '  fullyCoverable: false,',
    `  problem: ${JSON.stringify(problem, null, 2).replace(/\n/g, '\n  ')},`,
    '},',
  ].join('\n');
