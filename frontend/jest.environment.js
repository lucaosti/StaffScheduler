// Custom jest environment: extends jsdom and injects Node.js 18+ Fetch API
// globals (fetch, Request, Response, Headers, ReadableStream…) so MSW v2
// and tests that construct Response objects directly work correctly.
//
// Crucially, jsdom's own FormData (which supports new FormData(htmlFormEl))
// is PRESERVED and not replaced by Node's FormData, which lacks that overload.
const JsdomEnvironment = require('jest-environment-jsdom').default;

// Capture Node.js worker-level Web API globals before jsdom setup runs.
// These exist in Node 18+ on the worker's global scope.
const nodeFetch = global.fetch;
const nodeRequest = global.Request;
const nodeResponse = global.Response;
const nodeHeaders = global.Headers;
const nodeReadableStream = global.ReadableStream;
const nodeWritableStream = global.WritableStream;
const nodeTransformStream = global.TransformStream;

class FetchAwareJsdomEnvironment extends JsdomEnvironment {
  constructor(...args) {
    super(...args);
    // Use empty custom export conditions so package.json "exports" resolves
    // via the "default" condition instead of "browser". This ensures
    // msw/node resolves to its Node.js CJS bundle (not the browser bundle).
    this.customExportConditions = [''];
  }

  async setup() {
    await super.setup();

    // After jsdom setup, this.global IS the jsdom window.
    // Inject Node.js Web API globals for MSW v2 interop.
    // Deliberately NOT injecting FormData — jsdom's FormData accepts
    // HTMLFormElement as constructor arg; Node's FormData does not.
    const win = this.global;
    if (nodeFetch && !win.fetch) win.fetch = nodeFetch;
    if (nodeRequest && !win.Request) win.Request = nodeRequest;
    if (nodeResponse && !win.Response) win.Response = nodeResponse;
    if (nodeHeaders && !win.Headers) win.Headers = nodeHeaders;
    if (nodeReadableStream && !win.ReadableStream) win.ReadableStream = nodeReadableStream;
    if (nodeWritableStream && !win.WritableStream) win.WritableStream = nodeWritableStream;
    if (nodeTransformStream && !win.TransformStream) win.TransformStream = nodeTransformStream;
  }
}

module.exports = FetchAwareJsdomEnvironment;
