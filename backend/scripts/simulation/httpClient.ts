/**
 * Thin HTTP client for the simulation harness's HTTP actor layer.
 *
 * Wraps Node's built-in `fetch` (no new dependency — Node >=18 per
 * package.json engines) against the real Express app started in-process by
 * `index.ts` (`buildApp(pool, {silent:true})` + `app.listen(0)`). Every
 * response is inspected as data, never thrown, so actors can assert on
 * 401/403/404/422 exactly like a real client would.
 *
 * @author Luca Ostinelli
 */

export interface HttpResult<T = unknown> {
  status: number;
  body: {
    success: boolean;
    data?: T;
    message?: string;
    error?: { code: string; message: string };
  };
}

export class HttpClient {
  private token: string | null = null;

  constructor(private readonly baseUrl: string) {}

  /** Sets the bearer token used on every subsequent call from this client. */
  setToken(token: string): void {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Every route in this app returns the {success,...} envelope, including
    // errors — but treat a genuinely unparseable body (e.g. a raw 5xx from
    // something outside the app, or a non-JSON stream like calendar.ics/SSE)
    // as its own case rather than throwing.
    const contentType = res.headers.get('content-type') ?? '';
    let parsed: HttpResult<T>['body'];
    if (contentType.includes('application/json')) {
      parsed = (await res.json()) as HttpResult<T>['body'];
    } else {
      const text = await res.text();
      parsed = { success: res.ok, message: text.slice(0, 500) };
    }
    return { status: res.status, body: parsed };
  }

  get<T = unknown>(path: string): Promise<HttpResult<T>> {
    return this.request<T>('GET', path);
  }
  post<T = unknown>(path: string, body?: unknown): Promise<HttpResult<T>> {
    return this.request<T>('POST', path, body);
  }
  put<T = unknown>(path: string, body?: unknown): Promise<HttpResult<T>> {
    return this.request<T>('PUT', path, body);
  }
  patch<T = unknown>(path: string, body?: unknown): Promise<HttpResult<T>> {
    return this.request<T>('PATCH', path, body);
  }
  delete<T = unknown>(path: string): Promise<HttpResult<T>> {
    return this.request<T>('DELETE', path);
  }
}
