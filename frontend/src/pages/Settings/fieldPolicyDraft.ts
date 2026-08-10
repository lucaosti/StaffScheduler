/**
 * The field-policy edit form's draft shape and its conversions to/from the
 * `FieldPolicy` the API sends and expects. Shared between FieldPolicySection
 * and FieldPolicyForm.
 *
 * WHY NOT `FieldPolicy` DIRECTLY IN THE FORM. An earlier version bound each
 * input straight to the `string | null` / `number | null` shape and
 * normalised on every keystroke (trimming, splitting `allowedValues` on
 * commas). That fights the person typing: trimming a trailing space on every
 * change strips the space the moment it's typed, so "We need a number"
 * collapses to "Weneedanumber" as words run together; splitting
 * `allowedValues` on every change drops a trailing comma the instant it's
 * typed, since it produces one more empty segment `filter(Boolean)` removes.
 * A controlled input's `value` must be exactly what the last `onChange`
 * reported, or the DOM and React disagree about the cursor and characters
 * vanish.
 *
 * So the draft holds untouched strings, and parsing — trim, split,
 * `Number()` — happens exactly once, when the form is submitted.
 *
 * @author Luca Ostinelli
 */

import type { FieldPolicy } from '../../services/fieldPolicyService';

/** Fields the server keeps required whatever a policy says. */
export const ALWAYS_REQUIRED = new Set(['email', 'firstName', 'lastName']);

export interface Draft {
  fieldKey: string;
  isRequired: boolean;
  visiblePermission: string;
  editPermission: string;
  minLength: string;
  maxLength: string;
  minValue: string;
  maxValue: string;
  pattern: string;
  allowedValues: string;
  helpText: string;
}

export const toDraft = (fieldKey: string, policy: FieldPolicy | undefined): Draft => ({
  fieldKey,
  isRequired: policy?.isRequired ?? false,
  visiblePermission: policy?.visiblePermission ?? '',
  editPermission: policy?.editPermission ?? '',
  minLength: policy?.minLength?.toString() ?? '',
  maxLength: policy?.maxLength?.toString() ?? '',
  minValue: policy?.minValue?.toString() ?? '',
  maxValue: policy?.maxValue?.toString() ?? '',
  pattern: policy?.pattern ?? '',
  allowedValues: policy?.allowedValues?.join(', ') ?? '',
  helpText: policy?.helpText ?? '',
});

/** An empty input means "no rule", which is null rather than 0 or "". */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const numberOrNull = (value: string): number | null =>
  value.trim() === '' ? null : Number(value);

export const fromDraft = (draft: Draft): FieldPolicy => ({
  fieldKey: draft.fieldKey,
  isRequired: draft.isRequired,
  visiblePermission: orNull(draft.visiblePermission),
  editPermission: orNull(draft.editPermission),
  minLength: numberOrNull(draft.minLength),
  maxLength: numberOrNull(draft.maxLength),
  minValue: numberOrNull(draft.minValue),
  maxValue: numberOrNull(draft.maxValue),
  pattern: orNull(draft.pattern),
  allowedValues:
    draft.allowedValues.trim() === ''
      ? null
      : draft.allowedValues.split(',').map((v) => v.trim()).filter(Boolean),
  helpText: orNull(draft.helpText),
});
