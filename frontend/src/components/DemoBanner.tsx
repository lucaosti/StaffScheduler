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

import React, { useEffect, useRef, useState } from 'react';
import { getSystemInfo, RuntimeMode } from '../services/systemService';

const SESSION_KEY = 'demoBannerDismissed';
const BANNER_HEIGHT_VAR = '--demo-banner-height';

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

  const visible = mode === 'demo' && !dismissed;

  // Publish the banner's height so the fixed shell (sidebar, sticky header)
  // can start below it — see "Stacking order" in index.css (#892). Measured
  // rather than assumed because the text wraps to two or three lines on a
  // narrow screen; a ResizeObserver keeps it right as it does.
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bannerRef.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(BANNER_HEIGHT_VAR, `${el.offsetHeight}px`);
    publish();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publish);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const handleDismiss = (): void => {
    window.sessionStorage.setItem(SESSION_KEY, '1');
    setDismissed(true);
  };

  // `sticky-top` is Bootstrap's sticky layer (z-index 1020): above the
  // sidebar (1000), below modal backdrops and modals (1050/1055). It used to
  // be 1080 — above the modals — and covered every modal's title and close
  // button, and the sidebar brand (#892).
  return (
    <div
      ref={bannerRef}
      role="alert"
      aria-label="Demo environment notice"
      className="alert alert-warning d-flex align-items-center justify-content-between mb-0 sticky-top"
      style={{
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
