/**
 * OpenTelemetry bootstrap — imported FIRST by the process entrypoint.
 *
 * Auto-instrumentation patches `http`, `express` and `mysql2` when they are
 * required, so tracing must start before any of them load. Importing this module
 * as the very first line of index.ts guarantees that ordering: its top-level
 * `initTracing()` runs before the entrypoint's other imports pull in the
 * instrumented libraries. When tracing is disabled (the default), this is a
 * cheap no-op.
 *
 * @author Luca Ostinelli
 */

import { initTracing } from './tracing';

initTracing();
