/**
 * Web Push toggle — Settings → Personal (#310).
 *
 * Deliberately separate from the "Push Notifications" checkbox above it in
 * PreferencesSection: that checkbox is a stored preference ("do I want push
 * notifications sent to me at all") persisted server-side, while this is the
 * actual browser mechanics ("is THIS device/browser currently subscribed to
 * receive them") — a person can want push and still need to press this
 * button once per device, and the two states can legitimately disagree
 * (preference on, this browser never subscribed; or vice versa after
 * clearing site data). Conflating them into one checkbox would hide that
 * per-device step behind a control that looks like a pure preference.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import { usePushNotifications } from '../../hooks/usePushNotifications';

const WebPushToggle: React.FC = () => {
  const { state, error, busy, serverEnabled, subscribe, unsubscribe } = usePushNotifications();

  if (state === 'unsupported') {
    return null; // No Push API support (older browser, or a context that disallows it) — nothing to offer.
  }

  if (state === 'checking') {
    return null; // Avoids a flash of the wrong toggle state while the browser is asked.
  }

  return (
    <div className="mt-3">
      <h6 className="mb-2">Browser Push Notifications</h6>
      {!serverEnabled ? (
        <p className="text-muted small mb-0">
          Push notifications are not configured for this deployment.
        </p>
      ) : (
        <>
          <div className="form-check form-switch">
            <input
              className="form-check-input"
              type="checkbox"
              role="switch"
              id="webPushToggle"
              checked={state === 'subscribed'}
              disabled={busy}
              onChange={(e) => (e.target.checked ? subscribe() : unsubscribe())}
            />
            <label className="form-check-label" htmlFor="webPushToggle">
              Enable notifications on this device
            </label>
          </div>
          {error && (
            <div className="alert alert-danger mt-2 py-2 small" role="alert">
              {error}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default WebPushToggle;
