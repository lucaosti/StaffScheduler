/**
 * Jest setup, picked up automatically for every suite.
 *
 * Two jobs, both of which exist because the tests run under jsdom rather than
 * in a browser or in plain Node:
 *
 *  - pulls in `@testing-library/jest-dom` so `toBeInTheDocument` and friends
 *    are available everywhere without each suite importing it;
 *  - polyfills `TextEncoder`/`TextDecoder` and `fetch` from `undici`. MSW v2 is
 *    built on the Web `Request`/`Response`/`fetch` APIs, and jsdom ships none
 *    of them. Without the polyfill the failure is a confusing `ReferenceError`
 *    inside MSW rather than anything pointing at the environment.
 *
 * @author Luca Ostinelli
 */

import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

// The app's runtime default API base is the relative '/api/v1' (proxied by
// Vite in dev and nginx in production). Node's fetch rejects relative URLs,
// so unit tests pin an absolute base that the MSW handlers register against.
process.env.REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api/v1';

// The assignment targets are typed `unknown` on purpose: Node's util
// TextEncoder/TextDecoder signatures drift between @types/node versions
// (label vs encoding parameter, AllowSharedBufferSource inputs), and under
// the hoisted workspace install the exact version is resolved once for the
// whole repo. Runtime-wise the polyfill is correct either way; pinning the
// declared shape would just re-break on the next types bump.
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  (globalThis as { TextEncoder?: unknown }).TextEncoder = TextEncoder;
}
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  (globalThis as { TextDecoder?: unknown }).TextDecoder = TextDecoder;
}

// MSW v2 requires real Web API globals (fetch, Request, Response, Headers,
// ReadableStream). These are injected into the jsdom window by jest.environment.js,
// which captures Node.js 18+ built-ins before jsdom setup.

// `BroadcastChannel` is referenced by MSW v2 internals but is not
// available in jsdom yet. A no-op stub is enough for unit tests.
if (typeof (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel === 'undefined') {
  class BroadcastChannelStub {
    postMessage(): void {
      /* no-op */
    }
    close(): void {
      /* no-op */
    }
    addEventListener(): void {
      /* no-op */
    }
    removeEventListener(): void {
      /* no-op */
    }
    dispatchEvent(): boolean {
      return true;
    }
  }
  (globalThis as unknown as { BroadcastChannel: typeof BroadcastChannelStub }).BroadcastChannel =
    BroadcastChannelStub;
}
