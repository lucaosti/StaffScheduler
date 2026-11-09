/**
 * Operation coverage: which mounted operations the simulation reached.
 *
 * The operation list is `backend/openapi/openapi.json`, not a list kept here.
 * The generator (scripts/generate-openapi.ts) already fails when a mounted
 * route has no spec entry, so the spec
 * is the one authoritative inventory of the API surface; a second list in
 * this harness would drift from it the first time a route was added.
 *
 * Every response an actor receives is attributed to the spec operation whose
 * path template matches the request, so the report can say, per operation,
 * whether it was reached and whether it ever succeeded. "Reached" means a
 * route handler (or its middleware chain) answered: the catch-all 404 the
 * app returns for an unmounted path is not a reach, so a typo in an actor's
 * URL can never count as coverage.
 *
 * Rejected: counting coverage from the application side (Express route
 * matching or the Prometheus histogram). Both see only what the server
 * matched, so they cannot tell an operation that was never attempted from
 * one an actor called with a wrong path; attributing on the client side,
 * against the spec, catches both.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

interface Operation {
  key: string; // "GET /time-off/{id}"
  method: string;
  template: string;
  regex: RegExp;
  /** Literal characters in the template: the most specific match wins. */
  specificity: number;
}

export interface OperationStats {
  key: string;
  calls: number;
  successes: number;
  /** Status code → count, for the report. */
  statuses: Record<number, number>;
}

/** Message of the app's catch-all handler (`app.ts`): no route matched. */
const UNMOUNTED_MESSAGE = 'Endpoint not found';

function compile(template: string): RegExp {
  // `{id}` matches one path segment; `.ics`/`.vcf` suffixes stay literal.
  const pattern = template
    .split(/(\{[^}]+\})/)
    .map((part) => (part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${pattern}$`);
}

export class CoverageRecorder {
  private readonly operations: Operation[] = [];
  private readonly stats = new Map<string, OperationStats>();
  private readonly unmatched = new Map<string, number>();

  constructor(specPath = path.join(__dirname, '..', '..', 'openapi', 'openapi.json')) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    for (const [template, item] of Object.entries(spec.paths)) {
      for (const method of METHODS) {
        if (!item[method]) continue;
        const key = `${method.toUpperCase()} ${template}`;
        this.operations.push({
          key,
          method: method.toUpperCase(),
          template,
          regex: compile(template),
          specificity: template.replace(/\{[^}]+\}/g, '').length,
        });
        this.stats.set(key, { key, calls: 0, successes: 0, statuses: {} });
      }
    }
  }

  /** Spec operation key for a request, or null when no template matches. */
  resolve(method: string, apiPath: string): string | null {
    let best: Operation | null = null;
    for (const op of this.operations) {
      if (op.method !== method || !op.regex.test(apiPath)) continue;
      if (!best || op.specificity > best.specificity) best = op;
    }
    return best ? best.key : null;
  }

  record(method: string, apiPath: string, status: number, errorMessage: string | undefined): void {
    if (status === 404 && errorMessage === UNMOUNTED_MESSAGE) {
      const key = `${method} ${apiPath}`;
      this.unmatched.set(key, (this.unmatched.get(key) ?? 0) + 1);
      return;
    }
    const key = this.resolve(method, apiPath);
    if (!key) {
      const raw = `${method} ${apiPath}`;
      this.unmatched.set(raw, (this.unmatched.get(raw) ?? 0) + 1);
      return;
    }
    const entry = this.stats.get(key)!;
    entry.calls++;
    // 3xx counts: the SSO login leg's whole job is to redirect to the IdP.
    if (status >= 200 && status < 400) entry.successes++;
    entry.statuses[status] = (entry.statuses[status] ?? 0) + 1;
  }

  all(): OperationStats[] {
    return [...this.stats.values()];
  }

  /** Requests that reached no mounted route: always a harness bug. */
  unmatchedRequests(): Array<[string, number]> {
    return [...this.unmatched.entries()];
  }
}

/**
 * Operations a run reaches but cannot complete successfully, each with the
 * reason. Anything reached but never successful and NOT listed here fails the
 * run, as does anything not reached at all — so the list is the complete,
 * reviewed set of exceptions, not a filter.
 */
export const NEVER_SUCCEEDS: Record<string, string> = {
  'GET /auth/sso/{id}/callback':
    'needs an authorization code signed by a real identity provider; the run proves a forged one is refused',
  'POST /auth/login/challenge':
    'only email/SMS methods issue a login challenge, and neither is deliverable without EMAIL_* or an SMS gateway',
  'POST /auth/2fa/challenge': 'same as /auth/login/challenge: TOTP has no server-issued challenge',
};

export interface CoverageSummary {
  total: number;
  reached: number;
  succeeded: number;
  unreached: string[];
  reachedNeverSucceeded: Array<[string, string]>;
}

export function summarize(recorder: CoverageRecorder): CoverageSummary {
  const all = recorder.all();
  const unreached = all.filter((s) => s.calls === 0).map((s) => s.key);
  const failedOnly = all
    .filter((s) => s.calls > 0 && s.successes === 0)
    .map((s): [string, string] => [s.key, JSON.stringify(s.statuses)]);
  return {
    total: all.length,
    reached: all.length - unreached.length,
    succeeded: all.filter((s) => s.successes > 0).length,
    unreached,
    reachedNeverSucceeded: failedOnly,
  };
}
