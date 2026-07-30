/**
 * Builds a filtered aggregate feed URL for a token you already have.
 *
 * WHY IT BUILDS A URL RATHER THAN CREATING SOMETHING. There is nothing to
 * create: the filters live in the query string, so a person can have as many
 * filtered views as they like from one token, and can edit one by editing the
 * link. That also means revoking the token stops every view built from it at
 * once, which is the behaviour someone expects from "revoke my calendar
 * access" and would not get if each filtered feed were its own stored object.
 *
 * WHY THE SCOPE IS NOT A FIELD HERE. It is not a filter and it is not the
 * user's to set: the server resolves the token owner's org-unit scope on every
 * fetch and intersects it with these filters. A feed made while someone managed
 * a ward stops publishing that ward when they stop managing it. Offering a
 * scope control would imply the opposite — that the link's reach is fixed at
 * the moment it is made — which is exactly the misunderstanding a shared
 * calendar URL must not create.
 *
 * WHY THE PAST RANGE IS OFFERED AT ALL. The per-department feed started at
 * today, so a subscribed calendar had no memory: it could not answer "who was
 * on that Tuesday" once Tuesday had passed. Being able to look back is most of
 * why a manager wants this in their calendar rather than in the app.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import { buildAggregateFeedUrl } from '../../services/calendarService';

interface Option {
  id: number;
  name: string;
}

interface Props {
  /** The live tokens this person holds; a feed needs one. */
  tokens: Array<{ id: number; label: string; revokedAt: string | null }>;
  departments: Option[];
  roles: Option[];
}

/** Parses a multi-select's selected options into ids. */
const selectedIds = (select: HTMLSelectElement): number[] =>
  Array.from(select.selectedOptions).map((option) => Number(option.value));

const AggregateFeedBuilder: React.FC<Props> = ({ tokens, departments, roles }) => {
  const live = tokens.filter((token) => token.revokedAt === null);

  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [roleIds, setRoleIds] = useState<number[]>([]);
  const [pastDays, setPastDays] = useState(7);
  const [futureDays, setFutureDays] = useState(30);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The raw token value is shown once, at creation, and never stored — so this
  // cannot build a URL from a token the person already saved elsewhere. They
  // paste it back in, which is the honest consequence of not keeping it.
  const [token, setToken] = useState('');

  const handleBuild = (event: React.FormEvent) => {
    event.preventDefault();
    setCopied(false);
    if (!token.trim()) {
      setError('Paste one of your feed tokens — only you have the value.');
      setUrl(null);
      return;
    }
    setError(null);
    setUrl(
      buildAggregateFeedUrl(token.trim(), {
        departmentId: departmentIds,
        roleId: roleIds,
        pastDays,
        futureDays,
      })
    );
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError('Failed to copy — select the URL and copy it manually.');
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h5 className="mb-0">Filtered team calendar</h5>
      </div>
      <div className="card-body">
        <p className="text-muted small">
          A calendar of who is on duty, filtered by department or role, reaching back as well as
          forward. It shows only what you are already allowed to see — the range of the feed
          follows your permissions as they change, so it narrows by itself if they do.
        </p>

        {live.length === 0 && (
          <div className="alert alert-warning py-2" role="note">
            Create a feed URL above first — a filtered calendar needs one of your tokens.
          </div>
        )}

        {error && (
          <div className="alert alert-danger py-2" role="alert">
            {error}
          </div>
        )}

        <form className="row g-3" onSubmit={handleBuild}>
          <div className="col-md-6">
            <label className="form-label" htmlFor="agg-token">
              Your feed token
            </label>
            <input
              id="agg-token"
              className="form-control"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste the token from a feed URL you saved"
            />
            <div className="form-text">
              Only the digest is stored, so the app cannot fill this in for you.
            </div>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="agg-departments">
              Departments
            </label>
            <select
              id="agg-departments"
              className="form-select"
              multiple
              size={4}
              value={departmentIds.map(String)}
              onChange={(e) => setDepartmentIds(selectedIds(e.target))}
            >
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="agg-roles">
              Roles
            </label>
            <select
              id="agg-roles"
              className="form-select"
              multiple
              size={4}
              value={roleIds.map(String)}
              onChange={(e) => setRoleIds(selectedIds(e.target))}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="agg-past">
              Days of history
            </label>
            <input
              id="agg-past"
              type="number"
              min={0}
              max={365}
              className="form-control"
              value={pastDays}
              onChange={(e) => setPastDays(Number(e.target.value))}
            />
          </div>

          <div className="col-md-3">
            <label className="form-label" htmlFor="agg-future">
              Days ahead
            </label>
            <input
              id="agg-future"
              type="number"
              min={1}
              max={365}
              className="form-control"
              value={futureDays}
              onChange={(e) => setFutureDays(Number(e.target.value))}
            />
          </div>

          <div className="col-12">
            <button type="submit" className="btn btn-outline-primary">
              Build the URL
            </button>
          </div>
        </form>

        {url && (
          <div className="mt-3">
            <label className="form-label" htmlFor="agg-url">
              Filtered calendar URL
            </label>
            <div className="input-group">
              <input id="agg-url" className="form-control" readOnly value={url} />
              <button type="button" className="btn btn-outline-secondary" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy URL'}
              </button>
            </div>
            <div className="form-text">
              Subscribe to this in any calendar client. Revoking the token above stops this and
              every other view built from it, at once.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AggregateFeedBuilder;
