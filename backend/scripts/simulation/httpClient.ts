/**
 * HTTP client for simulation actors: one instance is one person's browser.
 *
 * Each client keeps its own cookie jar and presents nothing but what the
 * server set — the `token` access cookie and the path-scoped `refresh_token`
 * cookie, sent only to paths beneath the cookie's path, exactly as a browser
 * does. That is the point of driving the simulation through HTTP: a session
 * is obtained by the real login, renewed by the real refresh rotation, and
 * ended by the real logout, so every actor exercises the cookie contract the
 * SPA depends on.
 *
 * Rejected: minting a JWT in the harness and sending it as a Bearer header
 * (what this module's predecessor did). It skipped the cookie issuance, the
 * refresh-token rotation and its path scoping — precisely the parts that had
 * broken in production before (#319: the refresh cookie never reached
 * `/api/v1/auth/refresh`).
 *
 * When the access token is rejected (401 `INVALID_TOKEN`/`MISSING_TOKEN`)
 * and the jar holds a refresh cookie, the client refreshes once and retries
 * the request, as the SPA's `AuthContext` does; a long run therefore survives
 * the 15-minute access-token lifetime without the harness knowing about it.
 *
 * Every response is returned as data, never thrown, so actors can assert on
 * 401/403/404/409 exactly like a client would, and every response is
 * reported to the shared CoverageRecorder.
 *
 * `clientIp` is sent as `X-Forwarded-For` (the simulation trusts one proxy
 * hop — see simEnv.ts) so the login limiter, keyed by client IP, sees each
 * person on their own device rather than ten thousand logins from one
 * address.
 *
 * @author Luca Ostinelli
 */

import { CoverageRecorder } from './coverage';

export interface HttpResult<T = unknown> {
  status: number;
  body: {
    success: boolean;
    data?: T;
    message?: string;
    error?: { code: string; message: string; details?: unknown };
  };
  /** Raw body for non-JSON responses (CSV, XLSX, iCalendar, vCard, SSE). */
  text?: string;
  contentType: string;
  headers: Headers;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Abort after the response headers arrive (server-sent event streams). */
  headersOnly?: boolean;
  /** Skip the automatic refresh-and-retry (used by the auth calls themselves). */
  noRefresh?: boolean;
}

export interface Cookie {
  value: string;
  path: string;
}

/** One request/response pair, kept for defect evidence in the log. */
export interface Exchange {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
}

export class HttpClient {
  private readonly cookies = new Map<string, Cookie>();
  /** Number of automatic refreshes performed (verified by the harness). */
  refreshes = 0;
  last: Exchange | null = null;

  constructor(
    private readonly origin: string,
    private readonly prefix: string,
    private readonly recorder: CoverageRecorder | null,
    private readonly clientIp: string
  ) {}

  hasCookie(name: string): boolean {
    return this.cookies.has(name);
  }

  /** Drops one cookie — what a browser does when its max-age runs out. */
  dropCookie(name: string): void {
    this.cookies.delete(name);
  }

  /** A copy of the jar, so a test can replay credentials the server revoked. */
  snapshotCookies(): Map<string, Cookie> {
    return new Map(this.cookies);
  }

  restoreCookies(snapshot: Map<string, Cookie>): void {
    this.cookies.clear();
    for (const [name, cookie] of snapshot) this.cookies.set(name, cookie);
  }

  private cookieHeader(fullPath: string): string | undefined {
    const pairs: string[] = [];
    for (const [name, cookie] of this.cookies) {
      const scope = cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`;
      if (cookie.path === '/' || fullPath === cookie.path || fullPath.startsWith(scope)) {
        pairs.push(`${name}=${cookie.value}`);
      }
    }
    return pairs.length ? pairs.join('; ') : undefined;
  }

  private storeCookies(headers: Headers, requestPath: string): void {
    for (const raw of headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      let cookiePath = requestPath.slice(0, requestPath.lastIndexOf('/')) || '/';
      let expired = value === '';
      for (const attr of attrs) {
        const [k, v = ''] = attr.split('=');
        const key = k.toLowerCase();
        if (key === 'path') cookiePath = v;
        if (key === 'max-age' && Number(v) <= 0) expired = true;
        if (key === 'expires' && new Date(v).getTime() <= Date.now()) expired = true;
      }
      // A cookie is identified by name AND path; the app only ever sets one
      // path per name, so name alone is enough here.
      if (expired) {
        const existing = this.cookies.get(name);
        if (!existing || existing.path === cookiePath) this.cookies.delete(name);
      } else {
        this.cookies.set(name, { value, path: cookiePath });
      }
    }
  }

  async request<T = unknown>(method: string, apiPath: string, body?: unknown, options: RequestOptions = {}): Promise<HttpResult<T>> {
    const result = await this.send<T>(method, apiPath, body, options);
    if (
      result.status === 401 &&
      !options.noRefresh &&
      (result.body.error?.code === 'INVALID_TOKEN' || result.body.error?.code === 'MISSING_TOKEN') &&
      this.cookies.has('refresh_token')
    ) {
      const refreshed = await this.send('POST', '/auth/refresh', {}, { noRefresh: true });
      if (refreshed.status === 200) {
        this.refreshes++;
        return this.send<T>(method, apiPath, body, options);
      }
    }
    return result;
  }

  private async send<T>(method: string, apiPath: string, body: unknown, options: RequestOptions): Promise<HttpResult<T>> {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined) search.set(k, String(v));
    }
    const qs = search.toString();
    const fullPath = `${this.prefix}${apiPath}`;
    const headers: Record<string, string> = { 'X-Forwarded-For': this.clientIp, ...(options.headers ?? {}) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader(fullPath);
    if (cookie) headers.Cookie = cookie;

    const controller = new AbortController();
    const res = await fetch(`${this.origin}${fullPath}${qs ? `?${qs}` : ''}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      redirect: 'manual',
    });
    this.storeCookies(res.headers, fullPath);

    const contentType = res.headers.get('content-type') ?? '';
    let parsed: HttpResult<T>['body'];
    let text: string | undefined;
    if (options.headersOnly) {
      controller.abort();
      parsed = { success: res.ok };
    } else if (contentType.includes('application/json')) {
      parsed = (await res.json()) as HttpResult<T>['body'];
    } else {
      text = await res.text();
      parsed = { success: res.ok };
    }
    this.recorder?.record(method, apiPath, res.status, parsed.error?.message);
    this.last = { method, path: `${apiPath}${qs ? `?${qs}` : ''}`, requestBody: body, status: res.status, responseBody: text !== undefined ? text.slice(0, 300) : parsed };
    return { status: res.status, body: parsed, text, contentType, headers: res.headers };
  }

  get<T = unknown>(apiPath: string, query?: RequestOptions['query'], options: RequestOptions = {}): Promise<HttpResult<T>> {
    return this.request<T>('GET', apiPath, undefined, { ...options, query });
  }
  post<T = unknown>(apiPath: string, body: unknown = {}, options: RequestOptions = {}): Promise<HttpResult<T>> {
    return this.request<T>('POST', apiPath, body, options);
  }
  put<T = unknown>(apiPath: string, body: unknown = {}, options: RequestOptions = {}): Promise<HttpResult<T>> {
    return this.request<T>('PUT', apiPath, body, options);
  }
  patch<T = unknown>(apiPath: string, body: unknown = {}, options: RequestOptions = {}): Promise<HttpResult<T>> {
    return this.request<T>('PATCH', apiPath, body, options);
  }
  delete<T = unknown>(apiPath: string, body?: unknown, options: RequestOptions = {}): Promise<HttpResult<T>> {
    return this.request<T>('DELETE', apiPath, body, options);
  }
}
