/**
 * Employment contracts: the working-time limits the optimizer enforces, as a
 * shared entity with a validity period.
 *
 * WHY THIS EXISTS. Every limit lived on `user_preferences` — a table whose
 * name asserts its contents are preferences, which is how an employee came to
 * be able to raise their own legal maximums (#472). Beyond the authorization
 * hole, three modelling problems: a contract could not be expressed (each
 * person's limits were retyped and drifted independently), limits had no
 * validity period (moving to part-time overwrote the value, so last month's
 * schedule appeared to violate a limit that did not apply then), and the daily
 * cap was not stored at all — the engines invented `max(8, weekly/5)`, a
 * formula appearing in no contract and no documentation as a decision, yet
 * enforced as a hard constraint against real people.
 *
 * WHY THE PERIOD RESOLVER TAKES THE MOST RESTRICTIVE LIMITS. A schedule spans
 * weeks, so a contract change can fall inside it. Three options were weighed:
 *
 *   - resolve per shift date. Most precise, and wrong to build first: it makes
 *     limits vary per shift, which reshapes the problem format both engines and
 *     the canonical validator agree on, for a case that is uncommon.
 *   - take the contract in force on the schedule's start date. Simple, and
 *     unsafe: someone moving to part-time mid-period would be scheduled all
 *     period under their old full-time limits.
 *   - take the most restrictive value in force at any point in the period,
 *     which is what this does. It can under-schedule someone whose limits rose
 *     mid-period, which is conservative in the direction that matters — it
 *     never produces a schedule breaching a limit that applied while it ran.
 *
 * The conservative choice is stated here rather than left implicit because it
 * is a real trade-off, and per-shift resolution remains the eventual answer.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { NotFoundError, ValidationError } from '../errors';
import { logger } from '../config/logger';
import { DateUtils } from '../utils';
import type { SqlParam } from '../types';

/** The limits a contract may bound. `null` means "this contract does not constrain it". */
export interface ContractLimits {
  maxHoursPerWeek: number | null;
  minHoursPerWeek: number | null;
  maxHoursPerDay: number | null;
  maxConsecutiveDays: number | null;
  minHoursBetweenShifts: number | null;
}

export interface EmploymentContract extends ContractLimits {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface ContractAssignment {
  id: number;
  userId: number;
  contractId: number;
  contractName: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/** "YYYY-MM-DD" from whichever of the two shapes mysql2 hands back. */
const toDateString = (value: unknown): string =>
  value instanceof Date ? DateUtils.fromMySQLDate(value) : String(value).slice(0, 10);

const mapContract = (row: RowDataPacket): EmploymentContract => ({
  id: row.id as number,
  name: row.name as string,
  description: (row.description as string | null) ?? null,
  isActive: Boolean(row.is_active),
  maxHoursPerWeek: (row.max_hours_per_week as number | null) ?? null,
  minHoursPerWeek: (row.min_hours_per_week as number | null) ?? null,
  maxHoursPerDay: (row.max_hours_per_day as number | null) ?? null,
  maxConsecutiveDays: (row.max_consecutive_days as number | null) ?? null,
  minHoursBetweenShifts: (row.min_hours_between_shifts as number | null) ?? null,
});

/**
 * The tighter of two bounds, treating `null` as "unconstrained".
 *
 * `null` must lose to any number: a contract that does not mention a limit
 * cannot loosen one that another contract in the same period does mention.
 */
const tighter = (a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
};

/** For a lower bound, the tighter direction is the larger value. */
const tighterLowerBound = (a: number | null, b: number | null): number | null => {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
};

export class EmploymentContractService {
  constructor(private pool: Pool) {}

  async list(): Promise<EmploymentContract[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM employment_contracts ORDER BY name'
    );
    return rows.map(mapContract);
  }

  async getById(id: number): Promise<EmploymentContract> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      'SELECT * FROM employment_contracts WHERE id = ?',
      [id]
    );
    if (rows.length === 0) throw new NotFoundError('Employment contract not found');
    return mapContract(rows[0]);
  }

  async create(input: { name: string; description?: string | null } & Partial<ContractLimits>): Promise<EmploymentContract> {
    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO employment_contracts
         (name, description, max_hours_per_week, min_hours_per_week,
          max_hours_per_day, max_consecutive_days, min_hours_between_shifts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.name,
        input.description ?? null,
        input.maxHoursPerWeek ?? null,
        input.minHoursPerWeek ?? null,
        input.maxHoursPerDay ?? null,
        input.maxConsecutiveDays ?? null,
        input.minHoursBetweenShifts ?? null,
      ]
    );
    logger.info(`Employment contract created: ${input.name}`);
    return this.getById(res.insertId);
  }

  async update(id: number, patch: Partial<ContractLimits & { name: string; description: string | null; isActive: boolean }>): Promise<EmploymentContract> {
    const current = await this.getById(id);
    await this.pool.execute<ResultSetHeader>(
      `UPDATE employment_contracts
          SET name = ?, description = ?, is_active = ?,
              max_hours_per_week = ?, min_hours_per_week = ?, max_hours_per_day = ?,
              max_consecutive_days = ?, min_hours_between_shifts = ?
        WHERE id = ?`,
      [
        patch.name ?? current.name,
        patch.description !== undefined ? patch.description : current.description,
        patch.isActive ?? current.isActive,
        patch.maxHoursPerWeek !== undefined ? patch.maxHoursPerWeek : current.maxHoursPerWeek,
        patch.minHoursPerWeek !== undefined ? patch.minHoursPerWeek : current.minHoursPerWeek,
        patch.maxHoursPerDay !== undefined ? patch.maxHoursPerDay : current.maxHoursPerDay,
        patch.maxConsecutiveDays !== undefined ? patch.maxConsecutiveDays : current.maxConsecutiveDays,
        patch.minHoursBetweenShifts !== undefined ? patch.minHoursBetweenShifts : current.minHoursBetweenShifts,
        id,
      ]
    );
    return this.getById(id);
  }

  /** Contract assignments for a user, newest first. */
  async assignmentsForUser(userId: number): Promise<ContractAssignment[]> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT uec.id, uec.user_id, uec.contract_id, c.name AS contract_name,
              uec.effective_from, uec.effective_to
         FROM user_employment_contracts uec
         JOIN employment_contracts c ON c.id = uec.contract_id
        WHERE uec.user_id = ?
        ORDER BY uec.effective_from DESC`,
      [userId]
    );
    return rows.map((r) => ({
      id: r.id as number,
      userId: r.user_id as number,
      contractId: r.contract_id as number,
      contractName: r.contract_name as string,
      // mysql2 materializes a DATE column as a `Date`, so `String(...)` gives
      // "Sat Jan 01 2033 ..." and slicing it yields "Sat Jan 01". The same trap
      // that produced `Invalid time value` in conflict detection; DateUtils
      // exists for exactly this, and reads LOCAL components rather than
      // `toISOString()`, which rolls back a day in any positive UTC offset.
      effectiveFrom: toDateString(r.effective_from),
      effectiveTo: r.effective_to === null ? null : toDateString(r.effective_to),
    }));
  }

  /**
   * Assigns a contract to a user for a period.
   *
   * Overlap is rejected rather than silently allowed: two contracts in force
   * at once has no defined meaning, and the resolver below would quietly pick
   * the intersection of both — an answer nobody asked for. MySQL has no
   * exclusion constraint, so the check is here.
   */
  async assign(input: {
    userId: number;
    contractId: number;
    effectiveFrom: string;
    effectiveTo?: string | null;
  }): Promise<ContractAssignment> {
    const effectiveTo = input.effectiveTo ?? null;
    if (effectiveTo !== null && effectiveTo < input.effectiveFrom) {
      throw new ValidationError('effectiveTo must not be before effectiveFrom');
    }

    // Half-open comparison against an open-ended end: `effective_to IS NULL`
    // means "still in force", so it overlaps anything starting after it.
    const [clash] = await this.pool.execute<RowDataPacket[]>(
      `SELECT id FROM user_employment_contracts
        WHERE user_id = ?
          AND effective_from <= COALESCE(?, '9999-12-31')
          AND COALESCE(effective_to, '9999-12-31') >= ?
        LIMIT 1`,
      [input.userId, effectiveTo, input.effectiveFrom]
    );
    if (clash.length > 0) {
      throw new ValidationError(
        'This period overlaps an existing contract assignment for the user'
      );
    }

    const [res] = await this.pool.execute<ResultSetHeader>(
      `INSERT INTO user_employment_contracts (user_id, contract_id, effective_from, effective_to)
       VALUES (?, ?, ?, ?)`,
      [input.userId, input.contractId, input.effectiveFrom, effectiveTo]
    );
    logger.info(`Contract ${input.contractId} assigned to user ${input.userId}`);
    const all = await this.assignmentsForUser(input.userId);
    const created = all.find((a) => a.id === res.insertId);
    if (!created) throw new Error('Failed to retrieve contract assignment after insert');
    return created;
  }

  /**
   * The limits to enforce for each user over a scheduling period.
   *
   * Returns the tightest bound in force at any point in `[startDate, endDate]`
   * — see the module note for why conservative rather than per-shift. Users
   * with no contract are absent from the map; callers apply their own
   * defaults, which keeps this function's answer honest (no contract is not
   * the same as a contract with no limits).
   */
  async resolveLimitsForPeriod(
    userIds: number[],
    startDate: string,
    endDate: string
  ): Promise<Map<number, ContractLimits>> {
    const resolved = new Map<number, ContractLimits>();
    if (userIds.length === 0) return resolved;

    // Inlined only after being coerced to integers — these are ids from the
    // caller's own query, and an IN list cannot be a single bound parameter.
    const ids = userIds.map((id) => Number(id)).filter(Number.isInteger);
    if (ids.length === 0) return resolved;

    const params: SqlParam[] = [endDate, startDate];
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT uec.user_id, c.*
         FROM user_employment_contracts uec
         JOIN employment_contracts c ON c.id = uec.contract_id
        WHERE uec.user_id IN (${ids.join(',')})
          AND c.is_active = 1
          AND uec.effective_from <= ?
          AND COALESCE(uec.effective_to, '9999-12-31') >= ?`,
      params
    );

    for (const row of rows) {
      const userId = row.user_id as number;
      const contract = mapContract(row);
      const current = resolved.get(userId);
      resolved.set(
        userId,
        current === undefined
          ? {
              maxHoursPerWeek: contract.maxHoursPerWeek,
              minHoursPerWeek: contract.minHoursPerWeek,
              maxHoursPerDay: contract.maxHoursPerDay,
              maxConsecutiveDays: contract.maxConsecutiveDays,
              minHoursBetweenShifts: contract.minHoursBetweenShifts,
            }
          : {
              maxHoursPerWeek: tighter(current.maxHoursPerWeek, contract.maxHoursPerWeek),
              // A MINIMUM is tightened by raising it, not lowering it.
              minHoursPerWeek: tighterLowerBound(current.minHoursPerWeek, contract.minHoursPerWeek),
              maxHoursPerDay: tighter(current.maxHoursPerDay, contract.maxHoursPerDay),
              maxConsecutiveDays: tighter(current.maxConsecutiveDays, contract.maxConsecutiveDays),
              // Minimum rest is likewise tightened by raising it.
              minHoursBetweenShifts: tighterLowerBound(
                current.minHoursBetweenShifts,
                contract.minHoursBetweenShifts
              ),
            }
      );
    }

    return resolved;
  }
}
