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
 * The table and the per-field editor live in FieldPolicyTable and
 * FieldPolicyForm; the draft shape and its conversions to/from the wire
 * `FieldPolicy` live in fieldPolicyDraft.
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
import FieldPolicyTable from './FieldPolicyTable';
import FieldPolicyForm from './FieldPolicyForm';
import { type Draft, toDraft, fromDraft } from './fieldPolicyDraft';

interface Props {
  /** The signed-in administrator's organization, or null if they have none. */
  organizationName: string | null;
}

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
          <FieldPolicyTable fields={fields} byKey={byKey} onEdit={startEditing} onDelete={handleDelete} />
        </QueryState>

        {editing && (
          <FieldPolicyForm
            editing={editing}
            saving={save.isPending}
            onChange={setEditing}
            onSubmit={handleSave}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
};

export default FieldPolicySection;
