/**
 * Renaming or correcting shipped translation strings per organization,
 * without a code deploy.
 *
 * WHY A PLAIN LIST + FORM RATHER THAN A DEDICATED PAGE. One override row is a
 * locale, an organization scope, and a key→value map — the same proportion
 * `CostPlansSection` already applies to a comparably small admin surface.
 *
 * WHY THE GLOBAL ROW IS A DELIBERATE, LABELLED CHOICE. A row with no
 * organization is the fallback every organization without its own row gets;
 * one naming yours overrides it for your organization only. Someone editing
 * the first while meaning the second changes strings for everyone else on
 * the deployment too, so the scope is a control at the top with its
 * consequence spelled out — the same shape `FieldPolicySection` uses for the
 * same reason.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import QueryState from '../../components/QueryState';
import { SUPPORTED_LOCALES } from '../../i18n';
import {
  useTranslationOverridesQuery,
  useCreateTranslationOverride,
  useDeleteTranslationOverride,
  useUpdateTranslationOverride,
} from '../../hooks/useTranslationOverrides';
import type { TranslationOverride } from '../../services/translationOverrideService';

interface Props {
  /** The signed-in administrator's organization, or null if they have none. */
  organizationName: string | null;
}

interface Pair {
  key: string;
  value: string;
}

interface Draft {
  organizationName: string;
  locale: string;
  pairs: Pair[];
}

const EMPTY_PAIR: Pair = { key: '', value: '' };

const toDraft = (organizationName: string, locale: string, overrides?: Record<string, string>): Draft => ({
  organizationName,
  locale,
  pairs: overrides && Object.keys(overrides).length > 0
    ? Object.entries(overrides).map(([key, value]) => ({ key, value }))
    : [{ ...EMPTY_PAIR }],
});

const pairsToOverrides = (pairs: Pair[]): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const { key, value } of pairs) {
    const trimmedKey = key.trim();
    if (trimmedKey === '') continue;
    result[trimmedKey] = value;
  }
  return result;
};

const TranslationOverridesSection: React.FC<Props> = ({ organizationName }) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overridesQuery = useTranslationOverridesQuery();
  const create = useCreateTranslationOverride();
  const update = useUpdateTranslationOverride();
  const remove = useDeleteTranslationOverride();

  const rows = overridesQuery.data ?? [];

  const scopeLabel = (row: TranslationOverride) => row.organizationName ?? 'Global';

  const startCreating = () => {
    setMessage(null);
    setError(null);
    setEditingId(null);
    setDraft(toDraft(organizationName ?? '', SUPPORTED_LOCALES[0]));
  };

  const startEditing = (row: TranslationOverride) => {
    setMessage(null);
    setError(null);
    setEditingId(row.id);
    setDraft(toDraft(row.organizationName ?? '', row.locale, row.overrides));
  };

  const resetForm = () => {
    setDraft(null);
    setEditingId(null);
  };

  const updatePair = (index: number, patch: Partial<Pair>) => {
    if (!draft) return;
    const pairs = draft.pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair));
    setDraft({ ...draft, pairs });
  };

  const addPair = () => {
    if (!draft) return;
    setDraft({ ...draft, pairs: [...draft.pairs, { ...EMPTY_PAIR }] });
  };

  const removePair = (index: number) => {
    if (!draft) return;
    setDraft({ ...draft, pairs: draft.pairs.filter((_, i) => i !== index) });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    const overrides = pairsToOverrides(draft.pairs);
    try {
      if (editingId !== null) {
        await update.mutateAsync({ id: editingId, overrides });
        setMessage('Translation override updated.');
      } else {
        await create.mutateAsync({
          organizationName: draft.organizationName === '' ? null : draft.organizationName,
          locale: draft.locale,
          overrides,
        });
        setMessage('Translation override saved.');
      }
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save the translation override');
    }
  };

  const handleDelete = async (row: TranslationOverride) => {
    if (
      !window.confirm(
        row.organizationName === null
          ? `Remove the GLOBAL ${row.locale} overrides? Every organization without its own row for this locale is affected.`
          : `Remove ${row.organizationName}'s ${row.locale} overrides?`
      )
    ) {
      return;
    }
    setError(null);
    try {
      await remove.mutateAsync(row.id);
      setMessage('Translation override removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to remove the translation override');
    }
  };

  return (
    <div className="card">
      <div className="card-header d-flex justify-content-between align-items-center">
        <h5 className="mb-0">Translation overrides</h5>
        <button type="button" className="btn btn-sm btn-primary" onClick={startCreating}>
          Add override
        </button>
      </div>
      <div className="card-body">
        <p className="text-muted small">
          Renames or corrects shipped translation strings per organization, layered over the base
          catalog at sign-in and whenever the locale changes — no code deploy needed. A row with no
          organization is the fallback every organization without one of its own uses.
        </p>

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
          isLoading={overridesQuery.isLoading}
          isError={overridesQuery.isError}
          error={overridesQuery.error}
          onRetry={overridesQuery.refetch}
          loadingMessage="Loading translation overrides…"
        >
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th scope="col">Scope</th>
                  <th scope="col">Locale</th>
                  <th scope="col">Keys</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-muted text-center">
                      No translation overrides set yet.
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.organizationName === null ? (
                        <span className="badge bg-secondary">Global</span>
                      ) : (
                        scopeLabel(row)
                      )}
                    </td>
                    <td className="text-uppercase small text-muted">{row.locale}</td>
                    <td>{Object.keys(row.overrides).length}</td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary me-2"
                        onClick={() => startEditing(row)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDelete(row)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>

        {draft && (
          <form className="border rounded p-3 mt-3" onSubmit={handleSubmit}>
            <h6 className="mb-3">{editingId !== null ? 'Edit override' : 'New override'}</h6>

            <div className="row g-3 mb-3">
              <div className="col-md-4">
                <label className="form-label" htmlFor="override-scope">
                  Applies to
                </label>
                <select
                  id="override-scope"
                  className="form-select"
                  disabled={editingId !== null}
                  value={draft.organizationName}
                  onChange={(e) => setDraft({ ...draft, organizationName: e.target.value })}
                >
                  {organizationName && <option value={organizationName}>{organizationName}</option>}
                  <option value="">Every organization (global)</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label" htmlFor="override-locale">
                  Locale
                </label>
                <select
                  id="override-locale"
                  className="form-select"
                  required
                  disabled={editingId !== null}
                  value={draft.locale}
                  onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <option key={locale} value={locale}>
                      {locale}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="form-label">Overrides</label>
            {draft.pairs.map((pair, index) => (
              <div className="row g-2 mb-2" key={index}>
                <div className="col-5">
                  <input
                    className="form-control font-monospace"
                    placeholder="auth.signIn"
                    aria-label="Translation key"
                    value={pair.key}
                    onChange={(e) => updatePair(index, { key: e.target.value })}
                  />
                </div>
                <div className="col-6">
                  <input
                    className="form-control"
                    placeholder="Enter"
                    aria-label="Translation value"
                    value={pair.value}
                    onChange={(e) => updatePair(index, { value: e.target.value })}
                  />
                </div>
                <div className="col-1">
                  <button
                    type="button"
                    className="btn btn-outline-danger w-100"
                    aria-label="Remove key"
                    onClick={() => removePair(index)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={addPair}>
              Add key
            </button>

            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={create.isPending || update.isPending}>
                {create.isPending || update.isPending ? 'Saving…' : editingId !== null ? 'Save' : 'Create'}
              </button>
              <button type="button" className="btn btn-link" onClick={resetForm}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default TranslationOverridesSection;
