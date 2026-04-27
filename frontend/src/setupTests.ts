// Jest setup. CRA picks this file up automatically.
//
// - Pulls in `@testing-library/jest-dom` so `toBeInTheDocument` and
//   friends are available in every test.
// - Polyfills `TextEncoder` / `TextDecoder` and `fetch` via `undici`
//   so MSW v2 (which uses the `Request`/`Response`/`fetch` Web APIs)
//   works under jsdom.

import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  (globalThis as unknown as { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
}
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  (globalThis as unknown as { TextDecoder: typeof TextDecoder }).TextDecoder =
    TextDecoder as unknown as typeof globalThis.TextDecoder;
}

// MSW v2 needs a real `fetch` / `Request` / `Response` implementation
// even under jsdom. `undici` ships those primitives and is already a
// transitive dependency of jest in CRA, so we re-export them here.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const undici = require('undici');
  if (typeof (globalThis as { fetch?: unknown }).fetch === 'undefined') {
    (globalThis as unknown as { fetch: typeof undici.fetch }).fetch = undici.fetch;
  }
  if (typeof (globalThis as { Request?: unknown }).Request === 'undefined') {
    (globalThis as unknown as { Request: typeof undici.Request }).Request = undici.Request;
  }
  if (typeof (globalThis as { Response?: unknown }).Response === 'undefined') {
    (globalThis as unknown as { Response: typeof undici.Response }).Response = undici.Response;
  }
  if (typeof (globalThis as { Headers?: unknown }).Headers === 'undefined') {
    (globalThis as unknown as { Headers: typeof undici.Headers }).Headers = undici.Headers;
  }
} catch {
  // undici is optional; fall back to the jsdom defaults when present.
}

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
