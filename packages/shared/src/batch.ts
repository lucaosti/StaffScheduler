/**
 * The per-row result envelope batch endpoints return (#316).
 *
 * Not Zod-derived like the rest of this package: it describes a RESPONSE
 * shape, and per the OpenAPI generation convention (see
 * `backend/scripts/generate-openapi.ts`), response bodies are curated prose,
 * not generated from schemas — there is nothing here for a request validator
 * to check. Declaring it once and importing it on both sides is still the
 * point: without it, each batch route would invent its own shape for "one
 * outcome per input row," and a caller integrating against one endpoint would
 * have to learn a second shape for the next.
 */

export interface BatchRowError {
  code: string;
  message: string;
}

export interface BatchRowResult<T> {
  /** Position of this row in the request array — the caller's only way to correlate a failure back to its input, since rows carry no id of their own before creation. */
  index: number;
  success: boolean;
  data?: T;
  error?: BatchRowError;
}

export interface BatchResult<T> {
  results: BatchRowResult<T>[];
  succeeded: number;
  failed: number;
}
