/**
 * Shared state of one simulation run: the actors and their sessions, the
 * coverage recorder, and the three ways an actor's response is judged.
 *
 * Every actor is a person with their own HttpClient (cookie jar). What a
 * person may do is read from the API, not assumed: after login each actor
 * calls `GET /auth/verify` and keeps the `permissions` and
 * `allowedOrgUnitIds` it returns. Actors decide whether an attempt should
 * succeed from that profile, so a change to the authorization model (a new
 * route-level permission, a narrower scope) changes what the simulation
 * expects instead of breaking it.
 *
 * The three judgements:
 *   - `expectOk`     — the action is one the actor is entitled to and that
 *                      the data makes valid; any non-2xx is a finding.
 *   - `outcome`      — a business decision the server may legitimately refuse
 *                      (a swap that breaks the rest rule, an overlapping
 *                      time-off); 2xx and 4xx are both outcomes, 5xx is a
 *                      finding.
 *   - `expectDenied` — the actor is NOT entitled (another unit, a missing
 *                      permission); 403/404 is the only correct answer and a
 *                      2xx is a security finding. The 404-versus-403 choice
 *                      belongs to the application (out-of-scope reads answer
 *                      404 so they do not confirm existence), so both pass.
 *
 * A finding carries everything needed to replay it: seed, actor, request,
 * response. Verification adds the database evidence.
 *
 * @author Luca Ostinelli
 */

import { Pool } from 'mysql2/promise';
import { CoverageRecorder } from './coverage';
import { HttpClient, HttpResult } from './httpClient';
import { MegaLog } from './megaLog';

export type ActorKind = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'KIOSK';

export interface Actor {
  kind: ActorKind;
  userId: number;
  email: string;
  client: HttpClient;
  /** From `GET /auth/verify` — what the server says this person may do. */
  permissions: Set<string>;
  /** `null` means unscoped (company-wide); otherwise the reachable units. */
  allowedOrgUnitIds: number[] | null;
  /** The person's own unit and department in the simulated structure. */
  orgUnitId: number | null;
  departmentId: number | null;
}

export interface Finding {
  kind: 'server_error' | 'unexpected_failure' | 'scope_leak' | 'verification';
  seed: number;
  actor: string;
  operation: string;
  request: string;
  status: number;
  response: string;
  note: string;
}

export interface SimDepartment {
  name: string;
  departmentId: number;
  orgUnitId: number;
  head: Actor;
  employees: Actor[];
}

export class World {
  readonly findings: Finding[] = [];
  readonly recorder = new CoverageRecorder();
  departments: SimDepartment[] = [];
  admin!: Actor;
  private ipCounter = 0;

  constructor(
    readonly pool: Pool,
    readonly log: MegaLog,
    readonly seed: number,
    readonly origin: string,
    readonly prefix = '/api/v1'
  ) {}

  /** A new browser profile on its own (deterministic, private-range) address. */
  newClient(): HttpClient {
    const n = ++this.ipCounter;
    const ip = `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
    return new HttpClient(this.origin, this.prefix, this.recorder, ip);
  }

  label(actor: Actor): string {
    return `${actor.kind}#${actor.userId}`;
  }

  can(actor: Actor, permission: string): boolean {
    return actor.permissions.has(permission);
  }

  /** Whether `orgUnitId` is inside the actor's reach as the server reported it. */
  reaches(actor: Actor, orgUnitId: number): boolean {
    return actor.allowedOrgUnitIds === null || actor.allowedOrgUnitIds.includes(orgUnitId);
  }

  private finding(kind: Finding['kind'], actor: Actor, res: HttpResult, what: string, note: string): void {
    const last = actor.client.last;
    const f: Finding = {
      kind,
      seed: this.seed,
      actor: this.label(actor),
      operation: last ? `${last.method} ${last.path}` : what,
      request: last?.requestBody === undefined ? '' : JSON.stringify(last.requestBody).slice(0, 400),
      status: res.status,
      response: JSON.stringify(last?.responseBody ?? res.body).slice(0, 600),
      note: `${what}: ${note}`,
    };
    this.findings.push(f);
    this.log.verify(false, `${f.kind} ${f.operation} by ${f.actor}`, `${f.note} — status ${f.status}, request ${f.request}, response ${f.response}`);
  }

  /** Records a verification failure discovered from the database. */
  dbFinding(subject: string, detail: string): void {
    this.findings.push({
      kind: 'verification',
      seed: this.seed,
      actor: '-',
      operation: subject,
      request: '',
      status: 0,
      response: '',
      note: detail,
    });
    this.log.verify(false, subject, detail);
  }

  expectOk<T>(actor: Actor, res: HttpResult<T>, what: string): res is HttpResult<T> & { body: { data: T } } {
    const ok = res.status >= 200 && res.status < 300;
    if (ok) {
      this.log.count('http.expected_ok');
    } else {
      this.finding(res.status >= 500 ? 'server_error' : 'unexpected_failure', actor, res, what, 'expected success');
    }
    return ok;
  }

  outcome<T>(actor: Actor, res: HttpResult<T>, what: string): boolean {
    if (res.status >= 500) {
      this.finding('server_error', actor, res, what, 'server error on a business action');
      return false;
    }
    const ok = res.status >= 200 && res.status < 300;
    this.log.count(ok ? `outcome.${what}.accepted` : `outcome.${what}.refused.${res.status}`);
    if (!ok) {
      this.log.actor(actor.kind, actor.userId, `${what} refused ${res.status} ${res.body.error?.code ?? ''}: ${res.body.error?.message ?? ''}`);
    }
    return ok;
  }

  expectDenied(actor: Actor, res: HttpResult, what: string): void {
    if (res.status === 403 || res.status === 404) {
      this.log.count('scope.denied');
      this.log.verify(true, `scope ${what} by ${this.label(actor)}`, `denied with ${res.status}`);
    } else if (res.status >= 200 && res.status < 300) {
      this.finding('scope_leak', actor, res, what, 'an out-of-scope or unauthorized attempt succeeded');
    } else if (res.status >= 500) {
      this.finding('server_error', actor, res, what, 'server error on an unauthorized attempt');
    } else {
      // Refused, but by validation or a business rule rather than by
      // authorization: not a leak, but worth seeing in the log.
      this.log.count(`scope.refused_other.${res.status}`);
      this.log.actor(actor.kind, actor.userId, `${what}: refused with ${res.status} ${res.body.error?.code ?? ''} (not 403/404)`);
    }
  }

  allEmployees(): Actor[] {
    return this.departments.flatMap((d) => d.employees);
  }

  heads(): Actor[] {
    return this.departments.map((d) => d.head);
  }

  departmentOf(actor: Actor): SimDepartment {
    const dept = this.departments.find((d) => d.departmentId === actor.departmentId);
    if (!dept) throw new Error(`${this.label(actor)} has no simulated department`);
    return dept;
  }
}
