/**
 * The working-time limits that apply to a person: one resolver for every
 * place that enforces them.
 *
 * WHY THIS EXISTS. Manual assignments and swaps were checked by
 * `ComplianceEngine`, which resolved each limit through a chain — contract,
 * then preference, then the organization's policies, then system settings —
 * while auto-scheduling built its problem from constants: 8 h of rest for
 * everyone, and `COALESCE(..., 40)` / `COALESCE(..., 5)` for anyone without a
 * preference row. So an 11 h-rest contract got 9 h turnarounds from the
 * optimizer that `ComplianceEngine` then flagged (#838), and an organization
 * that applied the EU preset still got 8 h rest from every generated schedule
 * (#883). Two answers to "what is this person's limit" is one answer too many;
 * both now ask here.
 *
 * Resolution order, first match wins per field:
 *
 *   1. The employment contract in force (`EmploymentContractService
 *      .resolveLimitsForPeriod`, most restrictive across the period). FIRST
 *      because a contract is a deliberate, effective-dated limit a manager
 *      set, and a stale preference must not override it.
 *   2. `user_preferences` (weekly hours and consecutive days only; it has no
 *      rest column) — still the answer for anyone with no contract.
 *   3. An active GLOBAL `policies` row (`min_rest_hours`, `max_hours_week`,
 *      `max_consecutive_days`): the organization's own rule set, populated by
 *      hand or by applying a jurisdiction preset.
 *   4. `system_settings` (`scheduling.*`), the older non-scoped fallback.
 *   5. `DEFAULT_WORKING_TIME_LIMITS`.
 *
 * WHY BATCHED. The optimizer resolves a whole candidate pool at once and the
 * compliance check one person; four queries for either, rather than four per
 * person, is what lets both share the code.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { inClause } from '../utils/sql';
import { EmploymentContractService, type ContractLimits } from './EmploymentContractService';
import { PolicyService } from './PolicyService';

/** The limits every engine and check enforces for one person. */
export interface WorkingTimeLimits {
  /** Hard upper bound on consecutive working days. */
  maxConsecutiveDays: number;
  /** Hard lower bound on rest between two shifts, in hours. */
  minRestHoursBetweenShifts: number;
  /** Hard upper bound on hours worked in a rolling 7-day window. */
  maxHoursPerWeek: number;
}

/**
 * Used when nothing more specific is configured. Conservative numbers — the
 * assumption is that being too strict is a recoverable UX problem; being too
 * lax is a labour-law problem.
 */
export const DEFAULT_WORKING_TIME_LIMITS: WorkingTimeLimits = {
  maxConsecutiveDays: 5,
  minRestHoursBetweenShifts: 8,
  maxHoursPerWeek: 40,
};

export interface ResolvedWorkingTime {
  /** Resolved limits for every requested user. */
  limits: Map<number, WorkingTimeLimits>;
  /**
   * The contracts read on the way, returned so a caller needing a contract's
   * OTHER limits (daily cap, days off) does not read them a second time.
   */
  contracts: Map<number, ContractLimits>;
}

/**
 * A policy value in its documented shape (`{ hours }` / `{ days }`, see
 * PolicyValidator). Malformed or missing reads as absent rather than
 * throwing, as every layer of the chain treats "not set" as fall-through.
 */
const policyNumber = (value: unknown, field: string): number | undefined => {
  const n = (value as Record<string, unknown> | undefined)?.[field];
  return typeof n === 'number' && n > 0 ? n : undefined;
};

export class WorkingTimeLimitsService {
  constructor(private pool: Pool) {}

  /**
   * Limits for each of `userIds` over `[startDate, endDate]`. A single day
   * (`startDate === endDate`) is what a one-shift compliance check asks.
   */
  async resolve(userIds: number[], startDate: string, endDate: string): Promise<ResolvedWorkingTime> {
    const ids = userIds.map((id) => Number(id)).filter(Number.isInteger);
    if (ids.length === 0) return { limits: new Map(), contracts: new Map() };

    // Ids are inlined only after being coerced to integers; an IN list cannot
    // be one bound parameter.
    const [prefRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT user_id, max_hours_per_week, max_consecutive_days
         FROM user_preferences
        WHERE user_id IN (${inClause(ids)})`
    );
    const [settingRows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT \`key\`, value
         FROM system_settings
         WHERE category = 'scheduling'
           AND \`key\` IN ('min_hours_between_shifts', 'max_consecutive_days', 'max_hours_per_week')`
    );
    const policies = await new PolicyService(this.pool).getGlobalValues([
      'min_rest_hours',
      'max_hours_week',
      'max_consecutive_days',
    ]);
    const contracts = await new EmploymentContractService(this.pool).resolveLimitsForPeriod(
      ids,
      startDate,
      endDate
    );

    const settings: Record<string, string> = {};
    for (const row of settingRows) settings[row.key as string] = row.value as string;
    const prefs = new Map(
      prefRows.map((r) => [
        Number(r.user_id),
        r as { max_hours_per_week?: number | null; max_consecutive_days?: number | null },
      ])
    );

    // The organization-wide layers, resolved once: they are the same for
    // every person, and only the contract and preference above them vary.
    const orgWide: WorkingTimeLimits = {
      maxConsecutiveDays:
        policyNumber(policies.max_consecutive_days, 'days') ??
        (Number(settings.max_consecutive_days) || DEFAULT_WORKING_TIME_LIMITS.maxConsecutiveDays),
      minRestHoursBetweenShifts:
        policyNumber(policies.min_rest_hours, 'hours') ??
        (Number(settings.min_hours_between_shifts) ||
          DEFAULT_WORKING_TIME_LIMITS.minRestHoursBetweenShifts),
      maxHoursPerWeek:
        policyNumber(policies.max_hours_week, 'hours') ??
        (Number(settings.max_hours_per_week) || DEFAULT_WORKING_TIME_LIMITS.maxHoursPerWeek),
    };

    const limits = new Map<number, WorkingTimeLimits>();
    for (const id of ids) {
      const contract = contracts.get(id);
      const pref = prefs.get(id);
      limits.set(id, {
        maxConsecutiveDays:
          contract?.maxConsecutiveDays ?? pref?.max_consecutive_days ?? orgWide.maxConsecutiveDays,
        minRestHoursBetweenShifts:
          contract?.minHoursBetweenShifts ?? orgWide.minRestHoursBetweenShifts,
        maxHoursPerWeek: contract?.maxHoursPerWeek ?? pref?.max_hours_per_week ?? orgWide.maxHoursPerWeek,
      });
    }
    return { limits, contracts };
  }
}
