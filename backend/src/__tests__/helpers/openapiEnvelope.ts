/**
 * Response-envelope contract helper for the integration suite.
 *
 * Compiles the shared `ApiError` schema from the published OpenAPI spec once,
 * so integration tests can assert that a real error response coming back from
 * a live endpoint actually conforms to the documented `{ success:false,
 * error:{ code, message } }` shape — not merely that the test's own
 * expectations happen to match. This is the "spec validated against real
 * endpoint responses" half of the contract: the request side is covered by
 * the generator and `openapi.contract.test.ts`; this closes the loop on what
 * the API sends back.
 *
 * Success responses are asserted structurally (`success:true` + a `data`
 * field) rather than against a generated schema, because the spec's 2xx
 * responses are curated prose that deliberately do not type the `data`
 * payload — typing responses end-to-end is tracked as its own issue.
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'openapi', 'openapi.json'), 'utf8')
) as { components: { schemas: Record<string, unknown> } };

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

const validateApiError: ValidateFunction = ajv.compile(spec.components.schemas.ApiError as object);

/** Asserts an error response body matches the documented ApiError envelope. */
export const expectErrorEnvelope = (body: unknown): void => {
  if (!validateApiError(body)) {
    throw new Error(
      `error response does not match the OpenAPI ApiError contract: ${ajv.errorsText(validateApiError.errors)}\n${JSON.stringify(body)}`
    );
  }
};

/** Asserts a success response body carries the documented `{ success:true, data }` envelope. */
export const expectSuccessEnvelope = (body: unknown): void => {
  if (typeof body !== 'object' || body === null) {
    throw new Error(`success response is not an object: ${JSON.stringify(body)}`);
  }
  const record = body as Record<string, unknown>;
  if (record.success !== true) {
    throw new Error(`success response missing success:true: ${JSON.stringify(body)}`);
  }
  if (!('data' in record)) {
    throw new Error(`success response missing data field: ${JSON.stringify(body)}`);
  }
};
