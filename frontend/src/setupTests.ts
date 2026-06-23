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
