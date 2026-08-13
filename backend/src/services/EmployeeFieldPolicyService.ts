/**
 * Per-organization rules about employee fields, and their enforcement.
 *
 * WHY THIS IS NOT A ZOD SCHEMA. The shared Zod schemas are the PUBLISHED
 * CONTRACT: they generate the OpenAPI document and the typed client, so what
 * they say is true of the API for everyone. A field policy is per-deployment
 * CONFIGURATION — one organization requiring a phone number is not a fact about
 * this API. Folding it into the shared schemas would publish one customer's
 * rules as the contract, and the generated client would carry them everywhere.
 *
 * So the two run in sequence and mean different things: Zod decides what the API
 * accepts, the policy decides what THIS organization requires, and a policy
 * refusal carries its own code (`FIELD_POLICY_VIOLATION`) precisely because it
 * is not a contract violation.
 *
 * WHY THE GOVERNABLE CORE FIELDS ARE A CONSTANT HERE. This is the security
 * decision the whole feature turns on. A policy table that could name any column
 * would let a configuration change — not a deploy, not a review — make
 * `password_hash` a visible directory field or `totp_secret` editable. The set
 * below is fixed in code and a policy naming anything else is rejected on write.
 *
 * WHY ENFORCEMENT IS WRITE-ONLY. If switching on "phone is required" made
 * READING an employee without one fail, the first time anyone enabled it the
 * whole existing directory would break. A read of an incomplete record is
 * always fine; it is the next WRITE to that record that has to complete it.
 *
 * @author Luca Ostinelli
 */

import { Pool, RowDataPacket } from 'mysql2/promise';
import { ValidationUtils } from '../utils';
import { ConflictError, ValidationError } from '../errors';

/**
 * The core employee fields a policy may govern.
 *
 * Deliberately short. `email`, `firstName` and `lastName` appear because a
 * policy may add VALIDATION or restrict VISIBILITY on them — never because it
 * may make them optional: the database requires them and authentication depends
 * on the email, so a policy saying otherwise would describe something the system
 * refuses anyway, and configuration that lies is worse than configuration that
 * cannot express a thing.
 */
export const GOVERNABLE_CORE_FIELDS = [
  'email',
  'firstName',
  'lastName',
  'employeeId',
  'position',
  'phone',
  'hourlyRate',
] as const;

/** Fields a policy may never make optional, whatever it says. */
const NEVER_OPTIONAL = new Set(['email', 'firstName', 'lastName']);

export interface FieldPolicy {
  fieldKey: string;
  isRequired: boolean;
  visiblePermission: string | null;
  editPermission: string | null;
  minLength: number | null;
  maxLength: number | null;
  minValue: number | null;
  maxValue: number | null;
  pattern: string | null;
  allowedValues: string[] | null;
  helpText: string | null;
}

export interface FieldPolicyInput extends Omit<FieldPolicy, 'fieldKey'> {
  fieldKey: string;
  organizationName: string | null;
}

/** One refusal, named so the caller can point at the field that caused it. */
export interface FieldViolation {
  field: string;
  message: string;
}

const CUSTOM_PREFIX = 'custom:';
/** Same ceiling the column carries; a short regex is far harder to make pathological. */
const MAX_PATTERN_LENGTH = 200;

/** Whether a policy may name this field at all. */
export const isGovernableField = (fieldKey: string): boolean => {
  if (fieldKey.startsWith(CUSTOM_PREFIX)) {
    const key = fieldKey.slice(CUSTOM_PREFIX.length);
    // The same shape `user_custom_fields.field_key` accepts. Custom keys are
    // arbitrary by construction — they hold data an administrator entered — so
    // the only question is whether this is a well-formed key.
    return /^[A-Za-z0-9_-]{1,64}$/.test(key);
  }
  return (GOVERNABLE_CORE_FIELDS as readonly string[]).includes(fieldKey);
};

/**
 * The allow-list a field is restricted to, or null for "not restricted".
 *
 * A corrupted value reads as null — the field simply carries no allow-list —
 * rather than throwing a bare SyntaxError out of the row mapper and failing
 * the entire policy list over one row (#723).
 */
const parseAllowedValues = (raw: unknown): string[] | null => {
  const value = ValidationUtils.parseJsonColumn<unknown>(
    raw,
    null,
    'employee_field_policies.allowed_values'
  );
  return Array.isArray(value) ? value.map(String) : null;
};

const mapRow = (row: RowDataPacket): FieldPolicy => ({
  fieldKey: row.field_key as string,
  isRequired: Boolean(row.is_required),
  visiblePermission: (row.visible_permission as string | null) ?? null,
  editPermission: (row.edit_permission as string | null) ?? null,
  minLength: row.min_length === null ? null : Number(row.min_length),
  maxLength: row.max_length === null ? null : Number(row.max_length),
  minValue: row.min_value === null ? null : Number(row.min_value),
  maxValue: row.max_value === null ? null : Number(row.max_value),
  pattern: (row.pattern as string | null) ?? null,
  allowedValues: parseAllowedValues(row.allowed_values),
  helpText: (row.help_text as string | null) ?? null,
});

export class EmployeeFieldPolicyService {
  constructor(private readonly pool: Pool) {}

  /**
   * The policies that apply to an organization, most specific first.
   *
   * A named row overrides the global one for the same field — the same
   * resolution order module overrides use, so an administrator who has met one
   * already knows this one.
   */
  async listForOrganization(organizationName: string | null): Promise<FieldPolicy[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT * FROM employee_field_policies
        WHERE organization_name IS NULL
           OR organization_name = ?
        ORDER BY field_key ASC, organization_name IS NULL ASC`,
      [organizationName]
    );

    // First row per field wins: the ORDER BY puts the organization-specific one
    // ahead of the global one.
    const byField = new Map<string, FieldPolicy>();
    for (const row of rows) {
      const policy = mapRow(row);
      if (!byField.has(policy.fieldKey)) byField.set(policy.fieldKey, policy);
    }
    return [...byField.values()];
  }

  /** Creates or replaces one field's policy for an organization. */
  async upsert(input: FieldPolicyInput): Promise<void> {
    if (!isGovernableField(input.fieldKey)) {
      // The allowlist refusal. Naming a column outside it is how a
      // configuration change would reach `password_hash`.
      throw new ConflictError(
        `Field "${input.fieldKey}" cannot be governed by a policy. Core fields: ${GOVERNABLE_CORE_FIELDS.join(', ')}; custom fields as "custom:<key>".`
      );
    }
    if (NEVER_OPTIONAL.has(input.fieldKey)) {
      // Forced true whatever the policy says, rather than refused: these fields
      // are required by the database and by authentication, so a stored row
      // claiming otherwise would be configuration that lies about what the
      // system does. Someone may still want a row here for its VALIDATION or
      // its visibility rule, which is why this corrects rather than rejects.
      input = { ...input, isRequired: true };
    }
    if (input.pattern && input.pattern.length > MAX_PATTERN_LENGTH) {
      throw new ConflictError(`Pattern must be at most ${MAX_PATTERN_LENGTH} characters`);
    }
    if (input.pattern) {
      try {
        new RegExp(input.pattern);
      } catch {
        // Rejected here rather than at enforcement time: a broken pattern stored
        // now would refuse every write later, with no clue where it came from.
        throw new ConflictError('Pattern is not a valid regular expression');
      }
    }

    await this.pool.execute(
      `INSERT INTO employee_field_policies
         (organization_name, field_key, is_required, visible_permission, edit_permission,
          min_length, max_length, min_value, max_value, pattern, allowed_values, help_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         is_required = VALUES(is_required),
         visible_permission = VALUES(visible_permission),
         edit_permission = VALUES(edit_permission),
         min_length = VALUES(min_length),
         max_length = VALUES(max_length),
         min_value = VALUES(min_value),
         max_value = VALUES(max_value),
         pattern = VALUES(pattern),
         allowed_values = VALUES(allowed_values),
         help_text = VALUES(help_text)`,
      [
        input.organizationName,
        input.fieldKey,
        input.isRequired,
        input.visiblePermission,
        input.editPermission,
        input.minLength,
        input.maxLength,
        input.minValue,
        input.maxValue,
        input.pattern,
        input.allowedValues === null ? null : JSON.stringify(input.allowedValues),
        input.helpText,
      ]
    );
  }

  async remove(organizationName: string | null, fieldKey: string): Promise<boolean> {
    const [result] = await this.pool.execute(
      `DELETE FROM employee_field_policies
        WHERE COALESCE(organization_name, '') = COALESCE(?, '') AND field_key = ?`,
      [organizationName, fieldKey]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
  }
}

/**
 * Checks a payload against the policies, and returns every violation.
 *
 * EVERY violation, not the first: a form that rejects one field at a time makes
 * someone submit four times to learn four things, and they will have forgotten
 * the first correction by the last.
 *
 * `isPartial` is the update case. A field absent from a PATCH-style body is not
 * being cleared, so a required-field check on it would make every partial update
 * of an incomplete record impossible — which is precisely the record that most
 * needs updating.
 */
export const checkAgainstPolicies = (
  payload: Record<string, unknown>,
  policies: readonly FieldPolicy[],
  options: { isPartial?: boolean; callerPermissions?: readonly string[] } = {}
): FieldViolation[] => {
  const violations: FieldViolation[] = [];
  const permissions = options.callerPermissions ?? null;

  for (const policy of policies) {
    const key = policy.fieldKey.startsWith(CUSTOM_PREFIX)
      ? policy.fieldKey.slice(CUSTOM_PREFIX.length)
      : policy.fieldKey;
    const present = Object.prototype.hasOwnProperty.call(payload, key);
    const value = payload[key];
    const missing = value === null || value === undefined || value === '';

    if (present && policy.editPermission && permissions && !permissions.includes(policy.editPermission)) {
      // Refused rather than silently dropped: a write that appears to succeed
      // and does nothing is the worse failure, and the caller has no way to
      // discover it.
      violations.push({
        field: key,
        message: policy.helpText ?? `You are not allowed to change ${key}`,
      });
      continue;
    }

    if (policy.isRequired && (options.isPartial ? present && missing : missing)) {
      violations.push({ field: key, message: policy.helpText ?? `${key} is required` });
      continue;
    }

    if (!present || missing) continue;

    const text = String(value);
    if (policy.minLength !== null && text.length < policy.minLength) {
      violations.push({ field: key, message: policy.helpText ?? `${key} must be at least ${policy.minLength} characters` });
    }
    if (policy.maxLength !== null && text.length > policy.maxLength) {
      violations.push({ field: key, message: policy.helpText ?? `${key} must be at most ${policy.maxLength} characters` });
    }
    if (policy.minValue !== null || policy.maxValue !== null) {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        violations.push({ field: key, message: policy.helpText ?? `${key} must be a number` });
      } else {
        if (policy.minValue !== null && numeric < policy.minValue) {
          violations.push({ field: key, message: policy.helpText ?? `${key} must be at least ${policy.minValue}` });
        }
        if (policy.maxValue !== null && numeric > policy.maxValue) {
          violations.push({ field: key, message: policy.helpText ?? `${key} must be at most ${policy.maxValue}` });
        }
      }
    }
    if (policy.allowedValues !== null && !policy.allowedValues.includes(text)) {
      violations.push({
        field: key,
        message: policy.helpText ?? `${key} must be one of: ${policy.allowedValues.join(', ')}`,
      });
    }
    if (policy.pattern !== null) {
      let matches: boolean;
      try {
        matches = new RegExp(policy.pattern).test(text);
      } catch {
        // A stored pattern that no longer compiles must not refuse every write
        // with an unexplained failure; it is skipped and the rest still apply.
        matches = true;
      }
      if (!matches) {
        violations.push({ field: key, message: policy.helpText ?? `${key} does not match the required format` });
      }
    }
  }

  return violations;
};

/** Throws the standard refusal when there is anything to refuse. */
export const assertPolicies = (violations: readonly FieldViolation[]): void => {
  if (violations.length === 0) return;
  throw new ValidationError(
    `Field policy: ${violations.map((v) => `${v.field} — ${v.message}`).join('; ')}`
  );
};
