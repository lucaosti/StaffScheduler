/**
 * Directory — who someone is, and how to reach them.
 *
 * WHY THIS IS NOT THE ACCOUNTS PAGE. `/users` answers "may this person sign
 * in, with which roles". This answers "who is this person" — the same human,
 * a different question, and in most organisations a different audience.
 *
 * WHY A FIELD'S VISIBILITY IS SHOWN NEXT TO IT. Custom fields carry
 * `isPublic`, and a field someone fills in without knowing who will read it is
 * how a private note becomes a published one. The flag is stated on every row
 * rather than hidden in an edit dialog nobody opens.
 *
 * WHY THE vCARD IS A LINK AND NOT A FETCH. The endpoint returns a file with a
 * content type. Pulling it through the typed client into a blob, only to hand
 * it back to a download, is work that achieves nothing an anchor does not — and
 * it would lose the filename the server sets.
 *
 * WHAT IS DELIBERATELY ABSENT: bulk vCard import. It writes people into the
 * system from a file, and its questions — what happens on a duplicate email,
 * what happens halfway through — are not UI questions. Left to its own issue
 * rather than given a button whose failure mode nobody has decided.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import QueryState from '../../components/QueryState';
import { useActionFeedback } from '../../hooks/useActionFeedback';
import { useMyProfileQuery, useProfileQuery, useDirectoryMutations } from '../../hooks/useDirectory';
import { useEmployeesQuery } from '../../hooks/useEmployees';
import { vcardUrl } from '../../services/directoryService';
import type { DirectoryProfile } from '../../services/directoryService';

const Directory: React.FC = () => {
  const { user } = useAuth();
  const { message, run: act } = useActionFeedback();
  const permissions = user?.permissions ?? [];
  const canReadOthers = permissions.includes('user.read');
  const canManage = permissions.includes('user.manage');

  const [selectedId, setSelectedId] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldValue, setFieldValue] = useState('');

  const mine = useMyProfileQuery();
  const others = useEmployeesQuery('', '', canReadOthers);
  const selected = useProfileQuery(selectedId ? Number(selectedId) : null, canReadOthers);
  const { saveFields, removeField } = useDirectoryMutations();

  const shown: DirectoryProfile | null = selectedId ? selected.data ?? null : mine.data ?? null;
  const showing = selectedId ? selected : mine;

  const addField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shown) return;
    const ok = await act(
      saveFields.mutateAsync({ id: shown.id, fields: [{ key: fieldKey, value: fieldValue }] })
    );
    if (ok) {
      setFieldKey('');
      setFieldValue('');
    }
  };

  return (
    <div className="container-fluid py-3">
      <h1 className="h4 mb-1">Directory</h1>
      <p className="text-muted">
        Who someone is and how to reach them. Separate from the account, which decides whether they
        can sign in.
      </p>

      {message && (
        <div className="alert alert-warning" role="alert">
          {message}
        </div>
      )}

      {canReadOthers && (
        <div className="mb-3">
          <label className="form-label" htmlFor="directory-person">Person</label>
          <select
            id="directory-person"
            className="form-select"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">My profile</option>
            {(others.data ?? []).map((e) => (
              <option key={String(e.id)} value={String(e.id)}>
                {[e.firstName, e.lastName].filter(Boolean).join(' ') || e.email}
              </option>
            ))}
          </select>
        </div>
      )}

      <QueryState
        isLoading={showing.isLoading}
        isError={showing.isError}
        error={showing.error}
        onRetry={showing.refetch}
        isEmpty={!shown}
        loadingMessage="Loading profile…"
        empty={<p className="text-muted">No profile to show.</p>}
      >
        {shown && (
          <>
            <dl className="row">
              <dt className="col-sm-3">Name</dt>
              <dd className="col-sm-9">
                {shown.firstName} {shown.lastName}
              </dd>
              <dt className="col-sm-3">Email</dt>
              <dd className="col-sm-9">{shown.email}</dd>
              <dt className="col-sm-3">Phone</dt>
              <dd className="col-sm-9">{shown.phone ?? '—'}</dd>
              <dt className="col-sm-3">Position</dt>
              <dd className="col-sm-9">{shown.position ?? '—'}</dd>
              <dt className="col-sm-3">Roles</dt>
              <dd className="col-sm-9">{shown.roles.join(', ') || '—'}</dd>
            </dl>

            <a className="btn btn-sm btn-outline-secondary mb-4" href={vcardUrl(shown.id)}>
              Download vCard
            </a>

            <h2 className="h6">Additional fields</h2>
            {shown.fields.length === 0 ? (
              <p className="text-muted">No additional fields.</p>
            ) : (
              <table className="table table-sm align-middle">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Value</th>
                    <th>Visibility</th>
                    {canManage && <th />}
                  </tr>
                </thead>
                <tbody>
                  {shown.fields.map((f) => (
                    <tr key={f.key}>
                      <td>{f.key}</td>
                      <td>{f.value}</td>
                      <td>
                        {/* Stated on every row: a field filled in without
                            knowing who reads it is how a private note becomes
                            a published one. */}
                        <span className={`badge ${f.isPublic ? 'bg-info text-dark' : 'bg-secondary'}`}>
                          {f.isPublic ? 'Visible to colleagues' : 'Private'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="text-end">
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => act(removeField.mutateAsync({ id: shown.id, key: f.key }))}
                            disabled={removeField.isPending}
                          >
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {canManage && (
              <form className="row g-2 align-items-end" onSubmit={addField}>
                <div className="col-md-3">
                  <label className="form-label" htmlFor="field-key">Field</label>
                  <input
                    id="field-key"
                    className="form-control"
                    value={fieldKey}
                    onChange={(e) => setFieldKey(e.target.value)}
                    required
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="field-value">Value</label>
                  <input
                    id="field-value"
                    className="form-control"
                    value={fieldValue}
                    onChange={(e) => setFieldValue(e.target.value)}
                  />
                </div>
                <div className="col-auto">
                  <button type="submit" className="btn btn-primary" disabled={saveFields.isPending}>
                    Save field
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </QueryState>
    </div>
  );
};

export default Directory;
