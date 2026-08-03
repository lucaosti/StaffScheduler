/**
 * Deciding what an employee record must contain.
 *
 * WHY THE FIELD LIST COMES FROM THE SERVER. `governableCoreFields` arrives with
 * the policies and is what this offers. Keeping a copy here would drift from the
 * list that actually enforces — and that list is a security boundary: it is what
 * stops a policy naming `password_hash`. A stale copy would either show a field
 * the server refuses, or hide one it accepts, and neither failure announces
 * itself.
 *
 * WHY THE GLOBAL ROW IS A DELIBERATE, LABELLED CHOICE. A policy with no
 * organization is the fallback for every organization; one naming yours
 * overrides it. Someone editing the first while meaning the second changes the
 * rules for everyone, so the scope is a control at the top with its consequence
 * spelled out, not an implicit default.
 *
 * WHY THE ALWAYS-REQUIRED FIELDS SHOW A DISABLED SWITCH RATHER THAN NO SWITCH.
 * The server forces `email`, `firstName` and `lastName` required whatever a
 * policy says. Offering a working-looking toggle that is silently ignored is the
 * failure to avoid; hiding it entirely would leave someone wondering why the
 * field behaves differently. It is shown, on, disabled, and explained.
 *
 * WHY THE HELP TEXT IS PROMINENT. It is what the employee reads when the rule
 * refuses their value. Left empty they get the generated wording — "does not
 * match the required format" — which tells them nothing they can act on.
 *
 * @author Luca Ostinelli
 */

import React, { useMemo, useState } from 'react';
import QueryState from '../../components/QueryState';
import {
  useDeleteFieldPolicy,
  useFieldPoliciesQuery,
  useSaveFieldPolicy,
} from '../../hooks/useFieldPolicies';
import type { FieldPolicy } from '../../services/fieldPolicyService';

interface Props {
  /** The signed-in administrator's organization, or null if they have none. */
  organizationName: string | null;
}

/** Fields the server keeps required whatever a policy says. */
const ALWAYS_REQUIRED = new Set(['email', 'firstName', 'lastName']);

/**
 * The form's own state, as raw strings.
 *
 * WHY NOT `FieldPolicy` DIRECTLY. An earlier version bound each input straight
 * to the `string | null` / `number | null` shape and normalised on every
 * keystroke (trimming, splitting `allowedValues` on commas). That fights the
 * person typing: trimming a trailing space on every change strips the space the
 * moment it's typed, so "We need a number" collapses to "Weneedanumber" as
 * words run together; splitting `allowedValues` on every change drops a
 * trailing comma the instant it's typed, since it produces one more empty
 * segment `filter(Boolean)` removes. A controlled input's `value` must be
 * exactly what the last `onChange` reported, or the DOM and React disagree
 * about the cursor and characters vanish.
 *
 * So the draft holds untouched strings, and parsing — trim, split, `Number()`
 * — happens exactly once, when the form is submitted.
 */
interface Draft {
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

const toDraft = (fieldKey: string, policy: FieldPolicy | undefined): Draft => ({
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

const fromDraft = (draft: Draft): FieldPolicy => ({
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

const FieldPolicySection: React.FC<Props> = ({ organizationName }) => {
  // null = the global fallback row; the administrator's own organization is the
  // other choice. Starts on their own, which is the one they usually mean.
  const [scope, setScope] = useState<string | null>(organizationName);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useFieldPoliciesQuery(scope);
  const save = useSaveFieldPolicy(scope);
  const remove = useDeleteFieldPolicy(scope);

  const policies = useMemo(() => query.data?.policies ?? [], [query.data]);
  const fields = query.data?.governableCoreFields ?? [];

  const byKey = useMemo(
    () => new Map(policies.map((policy) => [policy.fieldKey, policy])),
    [policies]
  );

  const startEditing = (fieldKey: string) => {
    setMessage(null);
    setError(null);
    setEditing(toDraft(fieldKey, byKey.get(fieldKey)));
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setError(null);
    try {
      await save.mutateAsync({ ...fromDraft(editing), organizationName: scope });
      setMessage(`Saved the rule for ${editing.fieldKey}.`);
      setEditing(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save the policy');
    }
  };

  const handleDelete = async (fieldKey: string) => {
    if (
      !window.confirm(
        scope === null
          ? `Remove the GLOBAL rule for ${fieldKey}? Every organization without its own rule for this field is affected.`
          : `Remove your organization's rule for ${fieldKey}? The global rule, if there is one, applies again.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      await remove.mutateAsync(fieldKey);
      setMessage(`Removed the rule for ${fieldKey}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to remove the policy');
    }
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
        <h5 className="mb-0">Employee field rules</h5>
        <div className="d-flex align-items-center gap-2">
          <label className="form-label mb-0 small" htmlFor="policy-scope">
            Applies to
          </label>
          <select
            id="policy-scope"
            className="form-select form-select-sm w-auto"
            value={scope ?? ''}
            onChange={(e) => {
              setScope(e.target.value === '' ? null : e.target.value);
              setEditing(null);
              setMessage(null);
            }}
          >
            {organizationName && <option value={organizationName}>{organizationName}</option>}
            <option value="">Every organization (global)</option>
          </select>
        </div>
      </div>

      <div className="card-body">
        <p className="text-muted small">
          What an employee record must contain here. Checked when a record is <strong>saved</strong>,
          never when one is read — turning a field on does not break the records that predate it.
        </p>

        {scope === null && (
          <div className="alert alert-warning py-2" role="note">
            You are editing the <strong>global</strong> rules. They apply to every organization that
            has no rule of its own for that field.
          </div>
        )}
        {message && (
          <div className="alert alert-success py-2" role="status">
            {message}
          </div>
        )}
        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}

        <QueryState
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={query.refetch}
          loadingMessage="Loading the field rules…"
        >
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Required</th>
                  <th scope="col">Rule</th>
                  <th scope="col">Message shown</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field) => {
                  const policy = byKey.get(field);
                  const alwaysRequired = ALWAYS_REQUIRED.has(field);
                  return (
                    <tr key={field}>
                      <td className="fw-semibold">{field}</td>
                      <td>
                        {alwaysRequired ? (
                          <span
                            className="badge bg-secondary"
                            title="Required by the database and by sign-in; a rule cannot make it optional"
                          >
                            always
                          </span>
                        ) : policy?.isRequired ? (
                          <span className="badge bg-primary">yes</span>
                        ) : (
                          <span className="text-muted">no</span>
                        )}
                      </td>
                      <td className="small text-muted">
                        {policy
                          ? [
                              policy.minLength !== null && `min ${policy.minLength} chars`,
                              policy.maxLength !== null && `max ${policy.maxLength} chars`,
                              policy.minValue !== null && `min ${policy.minValue}`,
                              policy.maxValue !== null && `max ${policy.maxValue}`,
                              policy.pattern && `pattern ${policy.pattern}`,
                              policy.allowedValues && `one of ${policy.allowedValues.join(', ')}`,
                              policy.editPermission && `edit needs ${policy.editPermission}`,
                            ]
                              .filter(Boolean)
                              .join(' · ') || 'no rule'
                          : 'no rule'}
                      </td>
                      <td className="small">
                        {policy?.helpText ?? <span className="text-muted">generated wording</span>}
                      </td>
                      <td className="text-end">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary me-2"
                          onClick={() => startEditing(field)}
                        >
                          {policy ? 'Edit' : 'Add rule'}
                        </button>
                        {policy && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleDelete(field)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </QueryState>

        {editing && (
          <form className="border rounded p-3 mt-3" onSubmit={handleSave}>
            <h6 className="mb-3">
              Rule for <code>{editing.fieldKey}</code>
            </h6>

            <div className="row g-3">
              <div className="col-md-4">
                <div className="form-check">
                  <input
                    id="policy-required"
                    className="form-check-input"
                    type="checkbox"
                    checked={ALWAYS_REQUIRED.has(editing.fieldKey) || editing.isRequired}
                    disabled={ALWAYS_REQUIRED.has(editing.fieldKey)}
                    onChange={(e) => setEditing({ ...editing, isRequired: e.target.checked })}
                  />
                  <label className="form-check-label" htmlFor="policy-required">
                    Required
                  </label>
                </div>
                {ALWAYS_REQUIRED.has(editing.fieldKey) && (
                  <div className="form-text">
                    Always required — the database and sign-in depend on it, so this cannot be
                    turned off.
                  </div>
                )}
              </div>

              <div className="col-md-4">
                <label className="form-label" htmlFor="policy-edit-permission">
                  Changing it needs
                </label>
                <input
                  id="policy-edit-permission"
                  className="form-control"
                  placeholder="e.g. payroll.manage"
                  value={editing.editPermission}
                  onChange={(e) => setEditing({ ...editing, editPermission: e.target.value })}
                />
                <div className="form-text">A permission code. Leave empty for no restriction.</div>
              </div>

              <div className="col-md-4">
                <label className="form-label" htmlFor="policy-visible-permission">
                  Seeing it needs
                </label>
                <input
                  id="policy-visible-permission"
                  className="form-control"
                  placeholder="e.g. payroll.read"
                  value={editing.visiblePermission}
                  onChange={(e) => setEditing({ ...editing, visiblePermission: e.target.value })}
                />
              </div>

              <div className="col-md-3">
                <label className="form-label" htmlFor="policy-min-length">
                  Min length
                </label>
                <input
                  id="policy-min-length"
                  type="number"
                  min={0}
                  className="form-control"
                  value={editing.minLength}
                  onChange={(e) => setEditing({ ...editing, minLength: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label" htmlFor="policy-max-length">
                  Max length
                </label>
                <input
                  id="policy-max-length"
                  type="number"
                  min={1}
                  className="form-control"
                  value={editing.maxLength}
                  onChange={(e) => setEditing({ ...editing, maxLength: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label" htmlFor="policy-min-value">
                  Min value
                </label>
                <input
                  id="policy-min-value"
                  type="number"
                  className="form-control"
                  value={editing.minValue}
                  onChange={(e) => setEditing({ ...editing, minValue: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label" htmlFor="policy-max-value">
                  Max value
                </label>
                <input
                  id="policy-max-value"
                  type="number"
                  className="form-control"
                  value={editing.maxValue}
                  onChange={(e) => setEditing({ ...editing, maxValue: e.target.value })}
                />
              </div>

              <div className="col-md-6">
                <label className="form-label" htmlFor="policy-pattern">
                  Pattern
                </label>
                <input
                  id="policy-pattern"
                  className="form-control font-monospace"
                  maxLength={200}
                  placeholder="^[A-Z]{2}\d{4}$"
                  value={editing.pattern}
                  onChange={(e) => setEditing({ ...editing, pattern: e.target.value })}
                />
                <div className="form-text">
                  A regular expression, at most 200 characters. Rejected on save if it does not
                  compile.
                </div>
              </div>

              <div className="col-md-6">
                <label className="form-label" htmlFor="policy-allowed">
                  Permitted values
                </label>
                <input
                  id="policy-allowed"
                  className="form-control"
                  placeholder="Nurse, Doctor, Porter"
                  value={editing.allowedValues}
                  onChange={(e) => setEditing({ ...editing, allowedValues: e.target.value })}
                />
                <div className="form-text">Comma-separated. Leave empty to allow anything.</div>
              </div>

              <div className="col-12">
                <label className="form-label" htmlFor="policy-help">
                  Message shown when the rule refuses a value
                </label>
                <input
                  id="policy-help"
                  className="form-control"
                  maxLength={255}
                  placeholder="Include the area code, e.g. +39 02 …"
                  value={editing.helpText}
                  onChange={(e) => setEditing({ ...editing, helpText: e.target.value })}
                />
                <div className="form-text">
                  This is what the person filling the form reads. Left empty they get the generated
                  wording, which tells them the rule but not what to do about it.
                </div>
              </div>
            </div>

            <div className="mt-3 d-flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save rule'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default FieldPolicySection;
