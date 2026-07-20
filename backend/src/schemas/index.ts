/**
 * Compatibility re-export: the schemas now live in @staff-scheduler/shared
 * so the frontend and the OpenAPI generator consume the same definitions.
 *
 * Kept as a shim (rather than rewriting ~25 route imports) because the
 * import path `../schemas` is part of the backend's internal convention and
 * the indirection costs nothing at runtime; new code may import from either,
 * the package is canonical.
 */

export * from '@staff-scheduler/shared';
