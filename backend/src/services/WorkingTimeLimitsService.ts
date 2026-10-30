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
 * The layers, per field (see `resolveField` for the rule and why):
 *
 *   - An active GLOBAL `policies` row (`min_rest_hours`, `max_hours_week`,
 *     `max_consecutive_days`): the organization's own rule set, populated by
 *     hand or by applying a jurisdiction preset. When present it is a
 *     CEILING — the personal layers below may only tighten it.
 *   - The employment contract in force (`EmploymentContractService
 *     .resolveForPeriod`, most restrictive across the period), ahead of the
 *     preference because it is a deliberate, effective-dated limit a manager
 *     set. When it does not cover the whole period, what applies without it
 *     governs the remaining days and the tighter of the two is used.
 *   - `user_preferences` (weekly hours and consecutive days only; it has no
 *     rest column).
 *   - `system_settings` (`scheduling.*`), then `DEFAULT_WORKING_TIME_LIMITS`:
 *     fallbacks used only when no policy value exists and no personal layer
 *     states one.
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
    const { limits: contracts, fullyCovered } = await new EmploymentContractService(
      this.pool
    ).resolveForPeriod(ids, startDate, endDate);

    const settings: Record<string, string> = {};
    for (const row of settingRows) settings[row.key as string] = row.value as string;
    const prefs = new Map(
      prefRows.map((r) => [
        Number(r.user_id),
        r as { max_hours_per_week?: number | null; max_consecutive_days?: number | null },
      ])
    );

    // The organization-wide layers, read once: the same for every person.
    const policy = {
      maxConsecutiveDays: policyNumber(policies.max_consecutive_days, 'days'),
      minRestHoursBetweenShifts: policyNumber(policies.min_rest_hours, 'hours'),
      maxHoursPerWeek: policyNumber(policies.max_hours_week, 'hours'),
    };
    const fallback: WorkingTimeLimits = {
      maxConsecutiveDays:
        Number(settings.max_consecutive_days) || DEFAULT_WORKING_TIME_LIMITS.maxConsecutiveDays,
      minRestHoursBetweenShifts:
        Number(settings.min_hours_between_shifts) || DEFAULT_WORKING_TIME_LIMITS.minRestHoursBetweenShifts,
      maxHoursPerWeek: Number(settings.max_hours_per_week) || DEFAULT_WORKING_TIME_LIMITS.maxHoursPerWeek,
    };

    const limits = new Map<number, WorkingTimeLimits>();
    for (const id of ids) {
      const contract = contracts.get(id);
      const pref = prefs.get(id);
      const covered = fullyCovered.has(id);
      const field = (key: keyof WorkingTimeLimits, contractValue: Personal, prefValue: Personal) =>
        resolveField(DIRECTION[key], {
          contract: contractValue,
          preference: prefValue,
          policy: policy[key],
          fallback: fallback[key],
          contractCoversPeriod: covered,
        });
      limits.set(id, {
        maxConsecutiveDays: field('maxConsecutiveDays', contract?.maxConsecutiveDays, pref?.max_consecutive_days),
        // user_preferences has no rest column.
        minRestHoursBetweenShifts: field('minRestHoursBetweenShifts', contract?.minHoursBetweenShifts, null),
        maxHoursPerWeek: field('maxHoursPerWeek', contract?.maxHoursPerWeek, pref?.max_hours_per_week),
      });
    }
    return { limits, contracts };
  }
}

type Personal = number | null | undefined;

/** Which way each limit tightens: a cap by going down, a minimum rest by going up. */
const DIRECTION: Record<keyof WorkingTimeLimits, 'cap' | 'floor'> = {
  maxConsecutiveDays: 'cap',
  maxHoursPerWeek: 'cap',
  minRestHoursBetweenShifts: 'floor',
};

const tightest = (direction: 'cap' | 'floor', values: Personal[]): number => {
  const present = values.filter((v): v is number => typeof v === 'number');
  return direction === 'cap' ? Math.min(...present) : Math.max(...present);
};

/**
 * One limit for one person.
 *
 * THE GLOBAL POLICY IS A LEGAL CEILING. When the organization states a value,
 * a contract or a preference may only TIGHTEN it (a lower cap, more rest),
 * never loosen it. They used to win outright, and that left #883 open for two
 * of its three limits: `user_preferences.max_hours_per_week` and
 * `max_consecutive_days` are `INT DEFAULT 40 / 5` and PreferencesService
 * writes 40/5 into every row it creates, so anyone with a preferences row —
 * the demo seed creates one for everyone — got 40 h and 5 days under a
 * 36 h / 4-day policy. A preference is the person's wish and a contract the
 * employer's terms; neither can waive a rule the organization adopted (often
 * a jurisdiction's, applied as a preset). Ignoring the preference row was
 * rejected: a stricter personal cap (someone asking for fewer hours) is
 * legitimate and is still honoured.
 *
 * THE CONTRACT AND THE PREFERENCE ARE ONE PERSONAL LAYER, contract first —
 * first match between them, and only then the ceiling on top. They were first
 * compared as separate layers (the tightest of policy, contract and
 * preference), which made the 40 h / 5-day defaults binding wherever a policy
 * existed: under the EU preset (48 h, 6 days) a 48 h / 6-day full-time
 * contract resolved to 40 h / 5, so applying a looser preset tightened
 * everyone. The contract is the deliberate, effective-dated limit; the
 * preference is consulted only where no contract states one.
 *
 * With no policy value, the personal layer stands, then the system setting or
 * default — fallbacks, not rules anyone adopted.
 *
 * WHEN THE CONTRACT DOES NOT COVER THE PERIOD, its value only governs part of
 * it. The rest of the period is governed by what applies without it, so the
 * tighter of the two is used for the whole period — the same conservative
 * choice EmploymentContractService already makes between two contracts
 * (see its module note). An 8 h-rest contract ending on the 15th used to set
 * the rest for the whole month, under an 11 h policy that governs the 20th.
 */
const resolveField = (
  direction: 'cap' | 'floor',
  layers: {
    contract: Personal;
    preference: Personal;
    policy: number | undefined;
    fallback: number;
    contractCoversPeriod: boolean;
  }
): number => {
  // The contract and the preference are ONE personal layer, contract first:
  // the preference speaks only where no contract states the limit. Taking the
  // tightest of all three instead made the 40 h / 5 days every preferences
  // row carries binding over a contract that said otherwise — under the EU
  // preset, a 48 h contract resolved to 40 h, so applying a LOOSER policy
  // silently tightened everyone.
  const resolve = (contract: Personal): number => {
    const personal = contract ?? layers.preference;
    return layers.policy !== undefined
      ? tightest(direction, [layers.policy, personal])
      : (personal ?? layers.fallback);
  };
  const withContract = resolve(layers.contract);
  if (layers.contract == null || layers.contractCoversPeriod) return withContract;
  return tightest(direction, [withContract, resolve(null)]);
};
