/**
 * @staff-scheduler/shared — the single source of truth for the API contract.
 *
 * Why a dedicated workspace package: the backend validated requests with Zod
 * while the frontend re-declared the same shapes by hand in its own types
 * file, so every contract change had to be made twice and nothing detected
 * drift. Putting the Zod schemas (and, over time, the domain types derived
 * from them) in one package both sides import makes divergence a compile
 * error instead of a production surprise, and gives the OpenAPI generator a
 * single place to read the contract from.
 *
 * Layout: `schemas.ts` holds the request/param schemas exactly as the
 * backend's validation middleware consumes them. Domain types migrate here
 * gradually — each one moves when a feature touches it, never in a big-bang
 * rename — so the package is always the truth for what it exports.
 */

export * from './schemas';
