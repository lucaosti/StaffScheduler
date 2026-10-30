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
import { API_BASE_URL, ApiError, getAuthHeaders, handleResponse } from '../services/apiUtils';
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
      : { query?: QueryParams<P, M> }) & {
      /**
       * Extra headers merged on top of the default authenticated request
       * headers. Not part of the generated contract (headers aren't a Zod
       * concern) — the one current use is the auth service sending
       * `X-Client-Type: mobile` on login/refresh from inside Capacitor.
       */
      headers?: Record<string, string>;
    };

/**
 * Substitutes `{name}` placeholders in a path template with param values.
 *
 * A `NaN` param is refused rather than serialised. Every path parameter in the
 * contract is a positive integer (`idParam` and friends are `positiveInt`), and
 * services coerce with `Number(id)` because React Router hands route params over
 * as strings. When that coercion fails — a non-numeric id reaching the service —
 * `String(NaN)` produces the literal `"NaN"`, so the client would send
 * `/shifts/NaN` and the caller would get a puzzling 400 from the server about a
 * path parameter they believed they had supplied. Failing here names the actual
 * mistake at the actual call site. Same reasoning as refusing an over-large
 * audit export instead of truncating it: a wrong request that looks plausible is
 * worse than a loud error.
 */
const buildPath = (path: string, params?: Record<string, unknown>): string =>
  params
    ? path.replace(/\{(\w+)\}/g, (_, key) => {
        const value = params[key];
        if (typeof value === 'number' && Number.isNaN(value)) {
          throw new TypeError(
            `path parameter '${key}' for '${path}' is NaN — the contract requires a positive integer`
          );
        }
        return encodeURIComponent(String(value));
      })
    : path;

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

/*
 * SESSION RECOVERY (#842). An access token can expire however carefully the
 * proactive refresh in AuthContext is timed: a laptop wakes from sleep, a
 * background tab's timer is throttled, `JWT_EXPIRES_IN` is shorter than the
 * timer. Without a reactive path every request then failed with 401 until the
 * user reloaded. So a 401 that says the access token is missing, invalid or
 * revoked triggers one refresh and one retry of the request.
 *
 * The refresher is registered by `services/authService` rather than imported
 * here, because authService is itself built on this client — the import would
 * be a cycle. It is the single-flight, cross-tab-locked `refreshToken`, so N
 * concurrent 401s cost one `/auth/refresh`, never N rotations racing each
 * other into the family-revocation path.
 *
 * The auth endpoints are exempt: a failed login or refresh is an answer, not
 * an expired session, and `/auth/verify` is the bootstrap probe AuthContext
 * already follows with an explicit refresh. When the refresh itself fails the
 * session is over; the listeners (AuthContext) are told so the UI signs out
 * instead of leaving the user on a page whose every request fails.
 */
const SESSION_ERROR_CODES = new Set(['INVALID_TOKEN', 'MISSING_TOKEN', 'TOKEN_REVOKED']);
const NO_RECOVERY_PATHS = ['/auth/login', '/auth/refresh', '/auth/verify'];

let refreshSession: (() => Promise<unknown>) | null = null;
const sessionExpiredListeners = new Set<() => void>();

/** Registers the refresh the client runs on an expired session (authService does, once). */
export const setSessionRefresher = (refresher: () => Promise<unknown>): void => {
  refreshSession = refresher;
};

/** Subscribes to "the session ended and could not be refreshed"; returns the unsubscribe. */
export const onSessionExpired = (listener: () => void): (() => void) => {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
};

const isExpiredSession = (error: unknown, path: string): boolean =>
  error instanceof ApiError &&
  error.status === 401 &&
  SESSION_ERROR_CODES.has(error.code ?? '') &&
  !NO_RECOVERY_PATHS.some((prefix) => path.startsWith(prefix));

const send = async <T>(
  method: HttpMethod,
  url: string,
  body: unknown,
  headers?: Record<string, string>
): Promise<ApiResponse<T>> => {
  // Rebuilt per attempt: on the native platform the retry must carry the
  // bearer token the refresh just cached, not the expired one.
  const init: RequestInit = { method: method.toUpperCase(), ...getAuthHeaders(headers) };
  if (body !== undefined) init.body = JSON.stringify(body);
  return handleResponse<T>(await fetch(url, init));
};

const request = async <T>(
  method: HttpMethod,
  path: string,
  options?: {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<ApiResponse<T>> => {
  const url = `${API_BASE_URL}${buildPath(path, options?.params)}${buildQuery(options?.query)}`;
  try {
    return await send<T>(method, url, options?.body, options?.headers);
  } catch (error) {
    if (!refreshSession || !isExpiredSession(error, path)) throw error;
    try {
      await refreshSession();
    } catch {
      sessionExpiredListeners.forEach((listener) => listener());
      throw error;
    }
    // Exactly one retry: a 401 after a successful refresh is a real refusal,
    // and looping on it would rotate the refresh token on every request.
    return send<T>(method, url, options?.body, options?.headers);
  }
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

  /**
   * DELETE, optionally with a body.
   *
   * A body on DELETE is unusual, but two endpoints in this contract declare
   * one: revoking a delegation and removing a scoped role both carry an audit
   * `justification`. That belongs in the body rather than a query string,
   * which would put a free-text reason into access logs — so the client has to
   * support it, and omitting support would have meant either a hand-built
   * fetch surviving here or the justification being silently dropped.
   *
   * The body is typed from the contract like the other verbs, and stays
   * optional: most DELETE operations declare none, and `RequestBody` resolves
   * to `undefined` for those, so passing anything is a compile error there.
   */
  delete: <T, P extends PathsWithMethod<'delete'>>(
    path: P,
    options?: RequestOptions<P, 'delete'> & { body?: RequestBody<P, 'delete'> }
  ) => request<T>('delete', path as string, options as never),
};
