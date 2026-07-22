/**
 * OpenTelemetry tracing.
 *
 * WHY (and why separate from metrics): metrics answer "how much / how fast" in
 * aggregate; traces answer "what happened in THIS request" — the span tree
 * across HTTP → route handler → each SQL query. Together they cover the two
 * halves of observability. Tracing lives in its own module because it must be
 * initialised BEFORE anything it instruments is required (the auto-
 * instrumentations patch `http`, `express` and `mysql2` at load time), so the
 * process entrypoint imports and calls `initTracing()` first of all.
 *
 * WHY GUARDED BY ENV: the Node SDK starts a span processor and an exporter that
 * ships spans to a collector. That is unwanted noise (and an open handle) in
 * unit tests and in deployments without a collector, so it only starts when
 * explicitly enabled — `OTEL_ENABLED=true` or an `OTEL_EXPORTER_OTLP_ENDPOINT`
 * being set. When disabled, `initTracing()` is a cheap no-op and the heavy SDK
 * packages are never even required.
 *
 * WHY REQUEST-ID CORRELATION: the app already stamps every request with an
 * `X-Request-Id` (AsyncLocalStorage, surfaced in logs). Copying that id onto the
 * active span as `request.id` lets an operator pivot from a log line or a
 * response header straight to the matching trace, and back — the whole point of
 * correlated observability.
 *
 * @author Luca Ostinelli
 */

import { trace } from '@opentelemetry/api';
import { logger } from '../config/logger';

/** The started SDK instance, kept so shutdown can flush and stop it. */
let sdk: { start: () => void; shutdown: () => Promise<void> } | null = null;

/** Tracing is on when explicitly enabled or an OTLP endpoint is configured. */
export function isTracingEnabled(): boolean {
  return (
    process.env.OTEL_ENABLED === 'true' || Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)
  );
}

/**
 * Start the OpenTelemetry Node SDK with HTTP/Express/mysql2 auto-instrumentation.
 * No-op (and requires none of the SDK) when tracing is disabled or already
 * started. The heavy modules are required lazily so a disabled deployment pays
 * nothing for them.
 */
export function initTracing(): void {
  if (!isTracingEnabled() || sdk) return;

  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'staff-scheduler-backend',
    }),
    // The exporter reads OTEL_EXPORTER_OTLP_ENDPOINT (and related env vars) itself.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is extremely noisy and rarely useful for a web API.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk!.start();
  logger.info('OpenTelemetry tracing initialised');
}

/** Flush and stop the SDK on graceful shutdown. No-op when tracing never started. */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (error) {
    logger.warn(`OpenTelemetry shutdown failed: ${error instanceof Error ? error.message : error}`);
  } finally {
    sdk = null;
  }
}

/**
 * Stamp the current request id onto the active span so traces correlate with
 * X-Request-Id and the logs. A no-op when no span is active (tracing disabled),
 * so it is always safe to call from the request pipeline.
 */
export function setRequestIdOnSpan(requestId: string): void {
  trace.getActiveSpan()?.setAttribute('request.id', requestId);
}
