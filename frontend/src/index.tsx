/**
 * Main entry point for the Staff Scheduler React application.
 * Sets up routing and renders the root <App /> tree.
 *
 * @author Luca Ostinelli
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// Bootstrap is linked rather than imported, as two URLs, because the build
// must follow the writing direction (#845) — see i18n/bootstrapStylesheet.ts.
import bootstrapLtrHref from 'bootstrap/dist/css/bootstrap.min.css?url';
import bootstrapRtlHref from 'bootstrap/dist/css/bootstrap.rtl.min.css?url';
import 'bootstrap-icons/font/bootstrap-icons.css';

import './index.css';

import i18n, { isRtl } from './i18n';
import { applyBootstrapDirection, configureBootstrapStylesheets } from './i18n/bootstrapStylesheet';
import App from './App';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

const render = () =>
  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );

// The first render waits for Bootstrap so the app never paints unstyled; the
// timeout bounds that wait if the stylesheet neither loads nor errors, since
// an unstyled app is better than none. DirectionSync swaps the build on
// every later locale change.
const STYLESHEET_WAIT_MS = 3000;
configureBootstrapStylesheets({ ltr: bootstrapLtrHref, rtl: bootstrapRtlHref });
void Promise.race([
  applyBootstrapDirection(isRtl(i18n.language) ? 'rtl' : 'ltr'),
  new Promise((resolve) => setTimeout(resolve, STYLESHEET_WAIT_MS)),
]).then(render);

// PWA service worker registration (F05). Only in production builds; in
// development the SW would interfere with hot reload.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => undefined);
  });
}
