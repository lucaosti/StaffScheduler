/**
 * CalendarSection — iCal feed management for the Settings page.
 *
 * Lets users generate and copy their personal calendar feed URL, rotate
 * the token, and read per-client instructions for minimising the refresh
 * interval so schedule changes appear as quickly as the client allows.
 *
 * @author Luca Ostinelli
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getOrCreateCalendarToken,
  rotateCalendarToken,
  buildFeedUrl,
} from '../../services/calendarService';

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
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const feedUrl = token ? buildFeedUrl(token) : null;

  const loadToken = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getOrCreateCalendarToken();
      setToken(data.token);
    } catch (err) {
      setError((err as Error).message || 'Failed to load calendar token.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadToken();
  }, [loadToken]);

  const handleCopy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard.');
    }
  };

  const handleRotate = async () => {
    if (!window.confirm(
      'Rotating the token invalidates the current URL. Any calendar subscriptions using the old URL will stop working until you re-subscribe with the new URL. Continue?'
    )) return;
    setRotating(true);
    setError(null);
    try {
      const data = await rotateCalendarToken();
      setToken(data.token);
    } catch (err) {
      setError((err as Error).message || 'Failed to rotate token.');
    } finally {
      setRotating(false);
    }
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

            {loading ? (
              <div className="d-flex align-items-center gap-2 text-muted">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                Loading…
              </div>
            ) : feedUrl ? (
              <>
                <label htmlFor="feed-url" className="form-label fw-semibold">Your feed URL</label>
                <div className="input-group mb-3">
                  <input
                    id="feed-url"
                    type="text"
                    className="form-control font-monospace"
                    value={feedUrl}
                    readOnly
                    aria-label="Calendar feed URL"
                  />
                  <button
                    className={`btn ${copied ? 'btn-success' : 'btn-outline-secondary'}`}
                    type="button"
                    onClick={handleCopy}
                    aria-label="Copy feed URL to clipboard"
                  >
                    <i className={`bi ${copied ? 'bi-check-lg' : 'bi-clipboard'} me-1`} aria-hidden="true"></i>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>

                <div className="alert alert-info d-flex align-items-start gap-2 mb-3" role="note">
                  <i className="bi bi-info-circle-fill flex-shrink-0 mt-1" aria-hidden="true"></i>
                  <div>
                    <strong>How to get the fastest updates:</strong> after subscribing, open
                    the calendar settings in your app and set the refresh interval to the
                    shortest value it allows (see the per-client guide below). The server
                    sends an <code>ETag</code> header so clients that support it skip
                    re-downloading the feed when nothing has changed.
                  </div>
                </div>

                <button
                  className="btn btn-outline-danger btn-sm"
                  type="button"
                  onClick={handleRotate}
                  disabled={rotating}
                >
                  {rotating ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                      Rotating…
                    </>
                  ) : (
                    <>
                      <i className="bi bi-arrow-repeat me-1" aria-hidden="true"></i>
                      Rotate token
                    </>
                  )}
                </button>
                <p className="text-muted small mt-2 mb-0">
                  Rotating the token generates a new URL and invalidates the old one.
                  You will need to re-subscribe in any calendar app using the old URL.
                </p>
              </>
            ) : null}
          </div>
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
