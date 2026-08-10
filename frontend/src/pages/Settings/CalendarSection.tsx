/**
 * CalendarSection — iCal feed management for the Settings page.
 *
 * SEVERAL NAMED TOKENS, each revocable on its own. There used to be one per
 * person, and "rotate" overwrote it: adding a second device silently broke the
 * first, which is the opposite of what a calendar subscription is for — set up
 * once, expected to keep working until deliberately stopped.
 *
 * WHY THE URL IS SHOWN ONLY FOR A TOKEN JUST CREATED. Only the digest is
 * stored, so the raw value exists exactly once, in the response that created
 * it. The page says so rather than offering a "show" button that could not
 * work: a caller able to redisplay it would mean the secret was kept, which is
 * the whole thing hashing avoids.
 *
 * WHY REVOKED TOKENS STAY IN THE LIST. A feed that vanished would be
 * indistinguishable from one that was never created — and "did I already revoke
 * the lost phone?" is the question this screen exists to answer.
 *
 * @author Luca Ostinelli
 */

import React, { useState } from 'react';
import AggregateFeedBuilder from './AggregateFeedBuilder';
import { useDepartmentsQuery } from '../../hooks/useDepartments';
import { useRolesAndPermissionsQuery } from '../../hooks/useRbac';
import { useCalendarTokensQuery, useCalendarTokenMutations } from '../../hooks/useCalendarTokens';
import { CalendarToken, buildFeedUrl } from '../../services/calendarService';
import { useSettingsSectionSave } from '../../hooks/useSettingsSectionSave';

const CLIENT_INSTRUCTIONS = [
  {
    name: 'Google Calendar',
    icon: 'bi-google',
    steps: [
      'Open Google Calendar on the web.',
      'Click the "+" next to "Other calendars" → "From URL".',
      'Paste your feed URL and click "Add calendar".',
    ],
    refreshNote:
      'Google Calendar refreshes subscribed calendars roughly every 12–24 hours. This interval cannot be shortened from the user side — it is enforced by Google\'s servers.',
  },
  {
    name: 'Apple Calendar (macOS / iOS)',
    icon: 'bi-apple',
    steps: [
      'macOS: File → New Calendar Subscription → paste the URL → click Subscribe.',
      'iOS: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar → paste the URL.',
      'In the subscription options, set "Auto-refresh" to "Every 5 minutes" for the fastest supported interval.',
    ],
    refreshNote:
      'Apple Calendar supports a minimum refresh of 5 minutes when set to "Every 5 minutes" in the subscription settings.',
  },
  {
    name: 'Outlook (desktop / Microsoft 365)',
    icon: 'bi-microsoft',
    steps: [
      'Open Outlook → Calendar view.',
      'Home → Open Calendar → From Internet → paste the URL → click OK.',
      'Right-click the new calendar → Calendar Properties → Update Limit → set to the shortest allowed interval.',
    ],
    refreshNote:
      'Outlook desktop refreshes every 30 minutes by default; the minimum configurable interval is typically 15 minutes. Outlook.com (web) updates approximately every 24 hours and the interval cannot be changed.',
  },
  {
    name: 'Thunderbird (Lightning / Calendar)',
    icon: 'bi-envelope',
    steps: [
      'Calendar tab → New Calendar → On the Network → iCalendar (ICS) → paste the URL.',
      'In the calendar properties, set "Refresh calendar every" to 1 minute for the minimum interval.',
    ],
    refreshNote:
      'Thunderbird with the built-in calendar supports a minimum refresh of 1 minute.',
  },
];

const CalendarSection: React.FC = () => {
  const [label, setLabel] = useState('');
  /** The one token whose raw URL can be shown: the one just created. */
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // No success banner here — the fresh-URL reveal and the list re-rendering
  // are the confirmation; `run`'s success path is unused, only its error
  // handling is.
  const { error: actionError, setError, run } = useSettingsSectionSave();

  // The filter options for the aggregate builder. Both are ordinary cached
  // queries; a failure leaves the selects empty rather than breaking the page,
  // which is the right degradation for something that only shapes a URL.
  const departmentsQuery = useDepartmentsQuery();
  const rolesQuery = useRolesAndPermissionsQuery();

  const tokensQuery = useCalendarTokensQuery();
  const tokens: CalendarToken[] = tokensQuery.data ?? [];
  const loading = tokensQuery.isLoading;
  const error = tokensQuery.isError
    ? (tokensQuery.error as Error).message || 'Failed to load calendar tokens.'
    : actionError;
  const { create, revoke } = useCalendarTokenMutations();
  const busy = create.isPending || revoke.isPending;

  const handleCopy = async () => {
    if (!freshUrl) return;
    try {
      await navigator.clipboard.writeText(freshUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard.');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    let created: Awaited<ReturnType<typeof create.mutateAsync>> | undefined;
    const ok = await run(
      async () => { created = await create.mutateAsync(label); },
      '',
      'Failed to create token.'
    );
    if (ok && created) {
      setFreshUrl(buildFeedUrl(created.token));
      setLabel('');
    }
  };

  const handleRevoke = async (token: CalendarToken) => {
    if (
      !window.confirm(
        `Revoke "${token.label}"? Any calendar subscribed with that URL stops working immediately. Your other feeds are unaffected.`
      )
    )
      return;
    await run(() => revoke.mutateAsync(token.id), '', 'Failed to revoke token.');
  };

  return (
    <div className="row">
      <div className="col-lg-9">

        {/* Feed URL card */}
        <div className="card mb-4">
          <div className="card-header d-flex align-items-center gap-2">
            <i className="bi bi-calendar-event fs-5" aria-hidden="true"></i>
            <h5 className="mb-0">Calendar Feed</h5>
          </div>
          <div className="card-body">
            <p className="text-muted mb-3">
              Subscribe to your personal shift calendar from any app that supports iCal
              (Google Calendar, Apple Calendar, Outlook, Thunderbird, etc.).
              The feed is token-protected and updates automatically whenever your
              assignments change — no login required from the calendar app.
            </p>

            {error && (
              <div className="alert alert-danger" role="alert">
                <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
                {error}
              </div>
            )}

            {freshUrl && (
              <div className="alert alert-success" role="status">
                <p className="mb-2">
                  <strong>Copy this URL now.</strong> It contains the token, which is stored only
                  as a digest — this is the one and only time it can be shown.
                </p>
                <div className="input-group mb-2">
                  <input
                    id="feed-url"
                    type="text"
                    className="form-control font-monospace"
                    value={freshUrl}
                    readOnly
                    aria-label="Calendar feed URL"
                  />
                  <button
                    className={`btn ${copied ? 'btn-success' : 'btn-outline-secondary'}`}
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy feed URL to clipboard"
                  >
                    <i
                      className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'} me-1`}
                      aria-hidden="true"
                    ></i>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <button
                  className="btn btn-sm btn-outline-secondary"
                  type="button"
                  onClick={() => setFreshUrl(null)}
                >
                  I have saved it
                </button>
              </div>
            )}

            <div className="alert alert-info d-flex align-items-start gap-2 mb-3" role="note">
              <i className="bi bi-info-circle-fill flex-shrink-0 mt-1" aria-hidden="true"></i>
              <div>
                <strong>How to get the fastest updates:</strong> after subscribing, open the
                calendar settings in your app and set the refresh interval to the shortest value
                it allows (see the per-client guide below). The server sends an <code>ETag</code>
                header so clients that support it skip re-downloading the feed when nothing has
                changed.
              </div>
            </div>

            <form className="row g-2 align-items-end mb-3" onSubmit={handleCreate}>
              <div className="col-md-5">
                <label className="form-label" htmlFor="token-label">
                  Name this subscription
                </label>
                <input
                  id="token-label"
                  className="form-control"
                  placeholder="Phone, Work laptop…"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  required
                />
              </div>
              <div className="col-auto">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Create feed URL
                </button>
              </div>
            </form>

            {loading ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <span
                  className="spinner-border spinner-border-sm"
                  role="status"
                  aria-hidden="true"
                ></span>
                Loading…
              </div>
            ) : tokens.length === 0 ? (
              <p className="text-muted mb-0">
                No feed URLs yet. Create one above, name it after the device or app you will
                subscribe with, and you can revoke it on its own if you lose that device.
              </p>
            ) : (
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Created</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => (
                    <tr key={t.id}>
                      <td>{t.label}</td>
                      <td className="text-muted">{String(t.createdAt).slice(0, 10)}</td>
                      <td>
                        {/* Revoked rows stay: "did I already revoke the lost
                            phone?" is the question this screen answers. */}
                        {t.revokedAt ? (
                          <span className="badge bg-secondary">
                            Revoked {String(t.revokedAt).slice(0, 10)}
                          </span>
                        ) : (
                          <span className="badge bg-success">Active</span>
                        )}
                      </td>
                      <td className="text-end">
                        {!t.revokedAt && (
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => handleRevoke(t)}
                            disabled={busy}
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mb-4">
          <AggregateFeedBuilder
            tokens={tokens}
            departments={(departmentsQuery.data ?? []).map((d) => ({ id: Number(d.id), name: d.name }))}
            roles={(rolesQuery.data?.roles ?? []).map((r) => ({ id: Number(r.id), name: r.name }))}
          />
        </div>

        {/* Per-client instructions */}
        <div className="card">
          <div className="card-header">
            <h5 className="mb-0">How to subscribe — per client</h5>
          </div>
          <div className="card-body p-0">
            <div className="accordion accordion-flush" id="client-instructions">
              {CLIENT_INSTRUCTIONS.map((client, idx) => (
                <div className="accordion-item" key={client.name}>
                  <h2 className="accordion-header" id={`heading-${idx}`}>
                    <button
                      className="accordion-button collapsed"
                      type="button"
                      data-bs-toggle="collapse"
                      data-bs-target={`#collapse-${idx}`}
                      aria-expanded="false"
                      aria-controls={`collapse-${idx}`}
                    >
                      <i className={`bi ${client.icon} me-2`} aria-hidden="true"></i>
                      {client.name}
                    </button>
                  </h2>
                  <div
                    id={`collapse-${idx}`}
                    className="accordion-collapse collapse"
                    aria-labelledby={`heading-${idx}`}
                    data-bs-parent="#client-instructions"
                  >
                    <div className="accordion-body">
                      <ol className="mb-3">
                        {client.steps.map((step) => (
                          <li key={step} className="mb-1">{step}</li>
                        ))}
                      </ol>
                      <div className="alert alert-warning d-flex align-items-start gap-2 mb-0" role="note">
                        <i className="bi bi-clock-history flex-shrink-0 mt-1" aria-hidden="true"></i>
                        <span>{client.refreshNote}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

export default CalendarSection;
