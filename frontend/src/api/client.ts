/**
 * Typed API client — a thin, contract-checked layer over `fetch`.
 *
 * Why this exists: the hand-written service modules each rebuilt the same
 * fetch call by hand, so a path typo, a wrong HTTP method, or a request body
 * that no longer matched the backend contract compiled cleanly and only broke
 * at runtime. This client is generated-types-driven: the `paths` interface in
 * `./schema.ts` is produced from `backend/openapi/openapi.json` (itself
 * generated from the backend's shared Zod schemas — see
 * `backend/scripts/generate-openapi.ts`), so a call that names a
 * non-existent path, uses a method the endpoint does not support, or sends a
 * body that violates the schema is a compile error.
 *
 * Why a bespoke wrapper instead of `openapi-fetch`: the project's runtime
 * error contract is "throw `ApiError` (carrying HTTP status + backend error
 * code) on any non-2xx", consumed everywhere via `handleResponse`.
 * `openapi-fetch` returns `{ data, error }` instead of throwing, which would
 * force every caller and every existing test to change. Preserving the throw
 * contract keeps this a drop-in replacement for the hand-written services and
 * lets adoption proceed one service at a time.
 *
 * What is and isn't typed: request bodies, path parameters and query strings
 * are strongly typed from the spec. Response *payloads* are intentionally
 * returned as `ApiResponse<T>` with the caller supplying `T`, because the
 * OpenAPI responses are curated prose that mostly do not type the `data`
 * field. Typing responses end-to-end is a separate, larger step (it needs the
 * response schemas generated too) and is tracked as its own issue rather than
 * faked here.
 */

import type { paths } from './schema';
import { API_BASE_URL, getAuthHeaders, handleResponse } from '../services/apiUtils';
import type { ApiResponse } from '../types';

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Paths that define the given HTTP method. */
type PathsWithMethod<M extends HttpMethod> = {
  [P in keyof paths]: M extends keyof paths[P] ? P : never;
}[keyof paths];

/** The operation object for a (path, method) pair, when it exists. */
type Operation<P extends keyof paths, M extends HttpMethod> = M extends keyof paths[P]
  ? paths[P][M]
  : never;

/**
 * The JSON request body a (path, method) accepts. Resolves to `undefined`
 * when the operation declares no body, and to `Body | undefined` when the
 * body is optional — so callers of body-less endpoints pass nothing.
 */
type RequestBody<P extends keyof paths, M extends HttpMethod> = Operation<P, M> extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : Operation<P, M> extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B | undefined
    : undefined;

/** Path-parameter object for a (path, method), or `undefined` when none. */
type PathParams<P extends keyof paths, M extends HttpMethod> = Operation<P, M> extends {
  parameters: { path: infer PP };
}
  ? PP
  : undefined;

/** Query-parameter object for a (path, method), or `undefined` when none. */
type QueryParams<P extends keyof paths, M extends HttpMethod> = Operation<P, M> extends {
  parameters: { query?: infer QP };
}
  ? QP
  : undefined;

/**
 * Per-request options. Each field is present only when the operation needs
 * it: `params` for path templates like `/employees/{id}`, `query` for query
 * strings. `undefined` extends nothing, so body-less/param-less calls omit
 * them entirely and TypeScript still enforces the ones that are required.
 */
type RequestOptions<P extends keyof paths, M extends HttpMethod> =
  (PathParams<P, M> extends undefined ? { params?: undefined } : { params: PathParams<P, M> }) &
    (QueryParams<P, M> extends undefined
      ? { query?: undefined }
      : { query?: QueryParams<P, M> });

/** Substitutes `{name}` placeholders in a path template with param values. */
const buildPath = (path: string, params?: Record<string, unknown>): string =>
  params ? path.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(String(params[key]))) : path;

/** Serializes a query object, skipping null/undefined, into `?a=1&b=2`. */
const buildQuery = (query?: Record<string, unknown>): string => {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

const request = async <T>(
  method: HttpMethod,
  path: string,
  options?: { params?: Record<string, unknown>; query?: Record<string, unknown>; body?: unknown }
): Promise<ApiResponse<T>> => {
  const url = `${API_BASE_URL}${buildPath(path, options?.params)}${buildQuery(options?.query)}`;
  const init: RequestInit = {
    method: method.toUpperCase(),
    ...getAuthHeaders(),
  };
  if (options?.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url, init);
  return handleResponse<T>(response);
};

/**
 * The typed client. `T` is the response `data` type the caller expects (see
 * the module note on why responses are not auto-typed). Path, method, body
 * and params are all checked against the generated contract.
 */
export const apiClient = {
  get: <T, P extends PathsWithMethod<'get'>>(path: P, options?: RequestOptions<P, 'get'>) =>
    request<T>('get', path as string, options as never),

  post: <T, P extends PathsWithMethod<'post'>>(
    path: P,
    body: RequestBody<P, 'post'>,
    options?: RequestOptions<P, 'post'>
  ) => request<T>('post', path as string, { ...(options as object), body } as never),

  put: <T, P extends PathsWithMethod<'put'>>(
    path: P,
    body: RequestBody<P, 'put'>,
    options?: RequestOptions<P, 'put'>
  ) => request<T>('put', path as string, { ...(options as object), body } as never),

  patch: <T, P extends PathsWithMethod<'patch'>>(
    path: P,
    body: RequestBody<P, 'patch'>,
    options?: RequestOptions<P, 'patch'>
  ) => request<T>('patch', path as string, { ...(options as object), body } as never),

  delete: <T, P extends PathsWithMethod<'delete'>>(path: P, options?: RequestOptions<P, 'delete'>) =>
    request<T>('delete', path as string, options as never),
};
