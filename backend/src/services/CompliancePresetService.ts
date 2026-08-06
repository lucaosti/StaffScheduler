/**
 * Jurisdiction compliance presets.
 *
 * WHY THIS IS SEED DATA, NOT A HARDCODED RULESET. #312 asked for the opposite
 * of what "labor-law compliance rule sets" sounds like: not a per-jurisdiction
 * implementation baked into `ComplianceEngine`, but a generic, configurable
 * rule engine an organization edits through the existing `policies` CRUD
 * (`POST/PUT/DELETE /api/policies`) — which already existed and already had
 * an owner, an exception-request flow, and JSON-valued rules per key. What
 * was missing was two things: nothing had ever wired `ComplianceEngine` to
 * actually READ a `policies` row (see its `evaluateAssignmentCompliance`
 * resolution chain), and there was no convenient way to seed a starting rule
 * set rather than typing three rows by hand.
 *
 * A preset here is exactly that convenience: a named bundle of ordinary
 * GLOBAL policy rows, applied once, then editable or removable individually
 * through the same CRUD every other policy uses. Loading a preset never
 * enforces anything on its own — the resulting rows are enforced the same
 * way any admin-authored policy is, and can be adjusted or deleted the same
 * way. Nothing about "EU Working Time Directive" is a special case in code
 * beyond the seed values below.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { ValidationError } from '../errors';
import { PolicyService, Policy } from './PolicyService';

export interface CompliancePresetRule {
  policyKey: string;
  policyValue: unknown;
  description: string;
}

export interface CompliancePresetDefinition {
  key: string;
  name: string;
  description: string;
  rules: CompliancePresetRule[];
}

/**
 * Only one preset today. Adding another jurisdiction (FLSA, Fair Workweek)
 * means adding another entry here — the engine and the route are already
 * generic over the rule keys `ComplianceEngine` knows how to enforce
 * (`min_rest_hours`, `max_hours_week`, `max_consecutive_days`).
 */
export const COMPLIANCE_PRESETS: Record<string, CompliancePresetDefinition> = {
  eu_working_time_directive: {
    key: 'eu_working_time_directive',
    name: 'EU Working Time Directive',
    description:
      'Baseline rest and weekly-hours limits from Directive 2003/88/EC. A starting template — edit or remove any individual rule after loading.',
    rules: [
      {
        policyKey: 'min_rest_hours',
        policyValue: { hours: 11 },
        description: 'Minimum 11 consecutive hours of daily rest (Art. 3).',
      },
      {
        policyKey: 'max_hours_week',
        policyValue: { hours: 48 },
        description: 'Maximum average 48-hour working week (Art. 6).',
      },
      {
        policyKey: 'max_consecutive_days',
        policyValue: { days: 6 },
        description:
          'At least one rest day per 7-day period (Art. 5), expressed as a cap of 6 consecutive working days.',
      },
    ],
  },
};

export class CompliancePresetService {
  private policies: PolicyService;
  constructor(pool: Pool) {
    this.policies = new PolicyService(pool);
  }

  list(): CompliancePresetDefinition[] {
    return Object.values(COMPLIANCE_PRESETS);
  }

  /**
   * Loads a preset's rules as ordinary GLOBAL policy rows.
   *
   * UPSERTS BY KEY, so re-applying a preset (or applying it after an admin
   * already created a policy for the same key) updates that one row in
   * place rather than creating a duplicate the resolution chain would have
   * no defined way to pick between. A policy under a DIFFERENT key that the
   * organization already set is left untouched — a preset seeds, it does
   * not reset.
   */
  async apply(presetKey: string, imposedByUserId: number): Promise<Policy[]> {
    const preset = COMPLIANCE_PRESETS[presetKey];
    if (!preset) {
      throw new ValidationError(`Unknown compliance preset: ${presetKey}`);
    }

    const existingGlobal = (await this.policies.list()).filter((p) => p.scopeType === 'global');

    const applied: Policy[] = [];
    for (const rule of preset.rules) {
      const current = existingGlobal.find((p) => p.policyKey === rule.policyKey);
      applied.push(
        current
          ? await this.policies.update(current.id, {
              policyValue: rule.policyValue,
              description: rule.description,
              isActive: true,
            })
          : await this.policies.create({
              scopeType: 'global',
              policyKey: rule.policyKey,
              policyValue: rule.policyValue,
              description: rule.description,
              imposedByUserId,
            })
      );
    }
    return applied;
  }
}
