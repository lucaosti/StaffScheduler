/**
 * Demo banner.
 *
 * Renders a sticky, dismissible banner at the top of the application when
 * the backend reports `mode === 'demo'` via `/api/system/info`. Dismissal is
 * persisted only for the current session (sessionStorage), so the banner
 * reappears on a hard reload — that's intentional: the user must be reminded
 * the data is throwaway.
 *
 * Renders nothing in non-demo modes, so it is safe to mount unconditionally
 * in `App.tsx`.
 *
 * @author Luca Ostinelli
 */

import React, { useEffect, useState } from 'react';
import { getSystemInfo, RuntimeMode } from '../services/systemService';

const SESSION_KEY = 'demoBannerDismissed';

const DemoBanner: React.FC = () => {
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(
    typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY) === '1'
  );

  useEffect(() => {
    let cancelled = false;
    getSystemInfo()
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) setMode(res.data.mode);
      })
      .catch(() => {
        // Swallow: a failed system-info call should never break the UI.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (mode !== 'demo' || dismissed) return null;

  const handleDismiss = (): void => {
    window.sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  };

  return (
    <div
      role="alert"
      aria-label="Demo environment notice"
      className="alert alert-warning d-flex align-items-center justify-content-between mb-0"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1080,
        borderRadius: 0,
        borderLeft: 0,
        borderRight: 0,
      }}
    >
      <div>
        <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
        <strong>Demo environment.</strong> Data may be reset at any time. Do not enter real
        personal information.
      </div>
      <button
        type="button"
        className="btn-close"
        aria-label="Dismiss demo banner"
        onClick={handleDismiss}
      ></button>
    </div>
  );
};

export default DemoBanner;
