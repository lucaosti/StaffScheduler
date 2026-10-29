// Refuses to build the mobile app unless REACT_APP_API_URL is an absolute
// http(s) URL. The frontend's API base defaults to the relative `/api/v1`,
// which is right for the web SPA (its own server or the dev proxy answers
// there) and wrong inside a Capacitor WebView, where a relative path resolves
// against the app's bundled asset server: every call would 404 and the app
// would look as if the backend were down. The variable is baked in at build
// time (see frontend/vite.config.ts), so the build is the last point at which
// the mistake can be caught.
//
// A build-time check rather than a runtime fallback in the frontend: there is
// no URL the app could sensibly fall back to, and a built bundle that cannot
// reach any backend should never reach a device. Defaulting the mobile build
// to some fixed host was rejected for the same reason: it would compile and
// then silently talk to the wrong server.
import { fileURLToPath } from 'node:url';

/** Why `value` is unusable as the mobile API base, or null when it is fine. */
export function apiUrlProblem(value) {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return 'REACT_APP_API_URL is not set.';
  }
  let protocol;
  try {
    ({ protocol } = new URL(trimmed));
  } catch {
    protocol = null;
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    return `REACT_APP_API_URL must be an absolute http(s) URL, got "${trimmed}".`;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problem = apiUrlProblem(process.env.REACT_APP_API_URL);
  if (problem) {
    console.error(
      `${problem}\nThe mobile app cannot use the relative web default: set it to the backend's ` +
        'full API base, e.g. REACT_APP_API_URL=https://api.example.com/api/v1 npm run build'
    );
    process.exit(1);
  }
}
