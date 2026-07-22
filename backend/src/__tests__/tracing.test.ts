/**
 * OpenTelemetry tracing module tests.
 *
 * The heavy SDK packages are mocked so the enabled path can be exercised without
 * starting a real exporter. Verifies the env guard, that init starts the SDK
 * exactly once, request-id correlation onto the active span, and shutdown.
 */

// Makes this file a module (own scope) rather than a global script, so its
// top-level `const load` doesn't collide with the same name in other suites
// under ts-jest's shared program.
export {};

const sdkStart = jest.fn();
const sdkShutdown = jest.fn().mockResolvedValue(undefined);
const NodeSDK = jest.fn().mockImplementation(() => ({ start: sdkStart, shutdown: sdkShutdown }));

jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK }));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@opentelemetry/resources', () => ({ resourceFromAttributes: jest.fn((a) => a) }));
jest.mock('@opentelemetry/semantic-conventions', () => ({ ATTR_SERVICE_NAME: 'service.name' }));

const setAttribute = jest.fn();
const getActiveSpan = jest.fn();
jest.mock('@opentelemetry/api', () => ({ trace: { getActiveSpan: () => getActiveSpan() } }));

const load = () => {
  let mod!: typeof import('../observability/tracing');
  jest.isolateModules(() => {
    mod = require('../observability/tracing');
  });
  return mod;
};

const originalEnv = { ...process.env };
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  delete process.env.OTEL_ENABLED;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});
afterAll(() => {
  process.env = originalEnv;
});

describe('isTracingEnabled', () => {
  it('is off by default, on via OTEL_ENABLED or an OTLP endpoint', () => {
    expect(load().isTracingEnabled()).toBe(false);
    process.env.OTEL_ENABLED = 'true';
    expect(load().isTracingEnabled()).toBe(true);
    delete process.env.OTEL_ENABLED;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    expect(load().isTracingEnabled()).toBe(true);
  });
});

describe('initTracing', () => {
  it('is a no-op when disabled (SDK never constructed)', () => {
    const t = load();
    t.initTracing();
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('starts the SDK once when enabled', () => {
    process.env.OTEL_ENABLED = 'true';
    const t = load();
    t.initTracing();
    t.initTracing(); // idempotent
    expect(NodeSDK).toHaveBeenCalledTimes(1);
    expect(sdkStart).toHaveBeenCalledTimes(1);
  });
});

describe('setRequestIdOnSpan', () => {
  it('sets request.id on the active span when one exists', () => {
    getActiveSpan.mockReturnValue({ setAttribute });
    load().setRequestIdOnSpan('req-123');
    expect(setAttribute).toHaveBeenCalledWith('request.id', 'req-123');
  });

  it('does nothing when there is no active span', () => {
    getActiveSpan.mockReturnValue(undefined);
    expect(() => load().setRequestIdOnSpan('req-123')).not.toThrow();
  });
});

describe('shutdownTracing', () => {
  it('shuts the SDK down when started, and is a no-op otherwise', async () => {
    const t = load();
    await t.shutdownTracing(); // not started -> no-op
    expect(sdkShutdown).not.toHaveBeenCalled();

    process.env.OTEL_ENABLED = 'true';
    const t2 = load();
    t2.initTracing();
    await t2.shutdownTracing();
    expect(sdkShutdown).toHaveBeenCalledTimes(1);
  });

  it('swallows a shutdown failure', async () => {
    process.env.OTEL_ENABLED = 'true';
    sdkShutdown.mockRejectedValueOnce(new Error('exporter stuck'));
    const t = load();
    t.initTracing();
    await expect(t.shutdownTracing()).resolves.toBeUndefined();
  });
});

describe('otel-bootstrap', () => {
  it('calls initTracing at import', () => {
    const initTracing = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('../observability/tracing', () => ({ initTracing }));
      require('../observability/otel-bootstrap');
    });
    expect(initTracing).toHaveBeenCalledTimes(1);
  });
});
