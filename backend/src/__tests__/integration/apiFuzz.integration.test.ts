/**
 * Schema-driven API contract fuzzing on every operation (#908), against the
 * real app, a real MySQL seeded with the demo dataset, and a real Redis.
 *
 * For every operation in `openapi/openapi.json` the suite sends seeded
 * requests of three classes — valid, boundary, malformed (see
 * helpers/apiFuzz.ts) — as two real sessions: the demo Administrator and a
 * low-privilege demo employee. Each request is judged valid or invalid by the
 * Zod schema the route actually enforces, and every response is held to:
 *
 *   - no 5xx the spec does not document;
 *   - the envelope: JSON `{ success: true, data }` on 2xx, the `ApiError`
 *     shape (`error.code`, `error.message`) on every error;
 *   - the documented response schema, where the spec declares one;
 *   - a status the spec documents for the operation;
 *   - an invalid request is never accepted (no 2xx);
 *   - a valid request is never refused with an undocumented 400;
 *   - no error body carries a stack trace, SQL or a driver error.
 *
 * WHY IT COLLECTS INSTEAD OF STOPPING. A first failure says little about a
 * contract of 318 operations; the summary of every distinct failure signature
 * (operation + oracle + status) is the useful output, and each signature
 * carries the smallest request that produced it, with the seed.
 *
 * WHY AN ALLOWLIST AND NOT A SKIP. The suite lands while defects it found are
 * still open (the epic's rule: a suite that exposes a known defect narrows its
 * assertion with a reference to the open issue, and is never skipped). Each
 * known signature is listed below against its issue. Anything not listed fails
 * the run; in the default configuration a listed signature that no longer
 * fires fails it too, so an entry is removed in the same PR as its fix and the
 * list can only shrink.
 *
 * RUNNING A CAMPAIGN. The default (one request per class, operation and
 * actor, seed 908) is what the `integration` gate runs. Larger runs:
 *
 *   TEST_SEED=<n>            another deterministic stream (default 908)
 *   FUZZ_ITERATIONS=<n>      requests per class, operation and actor (default 1)
 *   FUZZ_OPERATIONS=<regex>  only operations whose "METHOD /path" matches
 *   FUZZ_REPORT=<file>       also write every failure, as JSON, to this file
 *
 * e.g. inside `./scripts/verify-in-docker.sh shell`:
 *   cd backend && TEST_SEED=42 FUZZ_ITERATIONS=20 FUZZ_REPORT=/tmp/fuzz.json \
 *     npm run test:integration -- apiFuzz
 *
 * A non-default run reports allowlisted signatures without requiring each to
 * fire, since a different stream need not reach the same defects.
 *
 * @author Luca Ostinelli
 */

// Env must be set before `../../config` is first required, so app modules are
// loaded lazily inside beforeAll (static imports would hoist above this).
const FUZZ_DB = process.env.FUZZ_DB_NAME || 'staff_scheduler_fuzz';
process.env.DB_NAME = FUZZ_DB;
process.env.NODE_ENV = 'test';
// Real Redis, unlike api.integration.test.ts: shared caches, the SSE fan-out
// and the optimization queue are part of the surface being fuzzed, and with
// Redis off `/schedules/{id}/generate` would run the solver inline instead.
process.env.REDIS_ENABLED = 'true';

import * as fs from 'fs';
import * as path from 'path';
import mysql from 'mysql2/promise';
import request from 'supertest';
import type { Express } from 'express';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ZodType } from 'zod';
import { migrationUpSql } from '../helpers/schema';
import { baseSeed, createRng } from '../helpers/scheduleGenerator';
import {
  type CaseClass,
  type GenContext,
  type JsonSchema,
  type Rng,
  type ValueSource,
  findLeak,
  generate,
  malformedPathId,
  mutateBody,
  mutateQuery,
  preview,
  queryValue,
  toQueryString,
} from '../helpers/apiFuzz';
import { scanRoutes, type FoundOp } from '../../../scripts/generate-openapi';

const SEED = baseSeed(908);
const ITERATIONS = Number(process.env.FUZZ_ITERATIONS || 1);
const OPERATION_FILTER = process.env.FUZZ_OPERATIONS ? new RegExp(process.env.FUZZ_OPERATIONS) : undefined;
/** The CI configuration: the only one in which every allowlist entry must still fire. */
const DEFAULT_RUN = !process.env.TEST_SEED && !process.env.FUZZ_ITERATIONS && !OPERATION_FILTER;

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const ADMIN = { name: 'admin', email: 'admin@demo.staffscheduler.local', password: 'demo1234' };
const EMPLOYEE = { name: 'employee', email: 'emp01@demo.staffscheduler.local', password: 'demo1234' };
type Actor = typeof ADMIN;

/*
 * Operations not fuzzed, each with the reason. Kept to what cannot be driven
 * as a request/response exchange at all.
 */
const EXCLUDED: Record<string, string> = {
  'GET /events/stream': 'server-sent events: the response never ends, so there is no status-and-body to judge',
};

// Known failure signatures: KNOWN_FAILURES, at the end of this file.

// ── Spec ────────────────────────────────────────────────────────────────────

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'openapi', 'openapi.json'), 'utf8')
) as { paths: Record<string, Record<string, any>>; components: Record<string, Record<string, any>> };

const pointerGet = (pointer: string): any =>
  pointer
    .replace(/^#\//, '')
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((node: any, seg) => (node == null ? undefined : node[seg]), spec);

const deref = (schema: JsonSchema): JsonSchema => {
  let s = schema;
  for (let i = 0; s && typeof s.$ref === 'string' && i < 10; i += 1) s = pointerGet(s.$ref);
  return s ?? {};
};

interface Param {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  schema: JsonSchema;
}

interface Operation {
  key: string;
  method: string;
  path: string;
  op: any;
  params: Param[];
  bodySchema?: JsonSchema;
  found?: FoundOp;
  bodyZod?: ZodType;
  queryZod?: ZodType;
  authenticated: boolean;
}

const ajv = new Ajv2020({ strict: false, allErrors: false, validateFormats: true });
addFormats(ajv);
ajv.addSchema(spec as object, 'openapi');
const validateApiError: ValidateFunction = ajv.getSchema('openapi#/components/schemas/ApiError')!;

/** The documented JSON schema of one response, compiled once, or null when the spec declares none. */
const responseValidators = new Map<string, ValidateFunction | null>();
const responseValidator = (o: Operation, status: number): ValidateFunction | null => {
  const id = `${o.key} ${status}`;
  if (responseValidators.has(id)) return responseValidators.get(id)!;
  const resp = o.op.responses?.[String(status)];
  const base = resp?.$ref ?? `#/paths/${o.path.replace(/~/g, '~0').replace(/\//g, '~1')}/${o.method}/responses/${status}`;
  const pointer = `${base}/content/application~1json/schema`;
  // Ajv resolves the fragment as a URI, so `{id}` must be percent-encoded.
  const uriFragment = pointer.replace(/^#/, '').split('/').map(encodeURIComponent).join('/');
  const validator = resp && pointerGet(pointer) ? ajv.getSchema(`openapi#${uriFragment}`) ?? null : null;
  responseValidators.set(id, validator);
  return validator;
};

// ── Fixture value source ────────────────────────────────────────────────────

/** Collection path (the path before an `{id}`) → table holding its rows. */
const COLLECTION_TABLES: Record<string, string> = {
  '/approval-workflows': 'approval_workflows',
  '/assignments': 'shift_assignments',
  '/attendance': 'attendance_records',
  '/audit-logs': 'audit_logs',
  '/auth/sso': 'sso_providers',
  '/calendar/department': 'departments',
  '/calendar/tokens': 'user_calendar_tokens',
  '/change-requests': 'change_requests',
  '/cost-plans': 'cost_plans',
  '/delegations': 'delegations',
  '/departments': 'departments',
  '/directory/users': 'users',
  '/employee-pairings': 'employee_pairings',
  '/employees': 'users',
  '/employment-contracts': 'employment_contracts',
  '/i18n/overrides/admin': 'translation_overrides',
  '/integrations/payroll/export': 'payroll_export_jobs',
  '/notifications': 'notifications',
  '/on-call/periods': 'on_call_periods',
  '/org/loans': 'employee_loans',
  '/org/units': 'org_units',
  '/pending-approvals': 'pending_approvals',
  '/policies': 'policies',
  '/policies/exceptions': 'policy_exception_requests',
  '/responsibility-rules': 'responsibility_rules',
  '/roles': 'roles',
  '/schedules': 'schedules',
  '/shift-swap': 'shift_swap_requests',
  '/shift-swap/open': 'shift_swap_offers',
  '/shifts': 'shifts',
  '/shifts/templates': 'shift_templates',
  '/skills': 'skills',
  '/sso/providers': 'sso_providers',
  '/time-off': 'time_off_requests',
  '/users': 'users',
  '/webhooks': 'webhook_subscriptions',
};

/** Field-name fragment → table, checked in order (most specific first). */
const NAME_TABLES: Array<[RegExp, string]> = [
  // `approverRoleId` names a role, not a user: only a name ENDING in "user"
  // is a user here; person-ish prefixes are the fallback at the bottom.
  [/user$/, 'users'],
  [/orgunit|unit$/, 'org_units'],
  [/department|dept/, 'departments'],
  [/schedule/, 'schedules'],
  [/template/, 'shift_templates'],
  [/assignment/, 'shift_assignments'],
  [/swap|offer/, 'shift_swap_requests'],
  [/shift/, 'shifts'],
  [/role/, 'roles'],
  [/skill/, 'skills'],
  [/exception/, 'policy_exception_requests'],
  [/polic/, 'policies'],
  [/workflow/, 'approval_workflows'],
  [/step/, 'approval_steps'],
  [/period/, 'on_call_periods'],
  [/geofence/, 'department_geofences'],
  [/kiosk/, 'kiosk_devices'],
  [/proposal/, 'schedule_replan_proposals'],
  [/contract/, 'employment_contracts'],
  [/provider/, 'sso_providers'],
  [/webhook|subscription/, 'webhook_subscriptions'],
  [/loan/, 'employee_loans'],
  [/pairing/, 'employee_pairings'],
  [/plan/, 'cost_plans'],
  [/notification/, 'notifications'],
  [/attendance|record/, 'attendance_records'],
  [/approval/, 'pending_approvals'],
  [/rule/, 'responsibility_rules'],
  [/request/, 'change_requests'],
  [/entity|delegat|employee|manager|approver|requester|proposer|target|member|partner|claimant|owner|user/, 'users'],
];

const tableForName = (name: string): string | undefined => {
  const n = name.toLowerCase().replace(/ids?$/, '');
  return NAME_TABLES.find(([re]) => re.test(n))?.[1];
};

class Fixtures implements ValueSource {
  readonly ids = new Map<string, number[]>();
  readonly created = new Map<string, number[]>();
  readonly strings = new Map<string, string[]>();
  /** Rows a mutating request must never target: the two sessions and their roles. */
  readonly protectedIds = new Map<string, Set<number>>();

  idFor(name: string, rng: Rng): number | undefined {
    const table = tableForName(name);
    const pool = table ? this.ids.get(table) : undefined;
    return pool?.length ? rng.pick(pool) : undefined;
  }

  stringFor(name: string, rng: Rng): string | undefined {
    const n = name.toLowerCase();
    const pick = (key: string) => {
      const pool = this.strings.get(key);
      return pool?.length ? rng.pick(pool) : undefined;
    };
    if (/permission(code)?s?$/.test(n)) return pick('permission');
    if (/^(organization(name)?|org)$/.test(n)) return pick('organization');
    if (/changetype$/.test(n)) return pick('changeType');
    if (/^(module(code)?)$/.test(n)) return pick('module');
    if (/^fieldkey$/.test(n)) return pick('fieldKey');
    return undefined;
  }
}

// ── Case construction ───────────────────────────────────────────────────────

interface Case {
  actor: string;
  cls: CaseClass;
  iteration: number;
  seed: number;
  url: string;
  body?: unknown;
  raw?: string;
  mutation?: string;
  verdict: 'valid' | 'invalid' | 'unknown';
  verdictReason?: string;
}

/** FNV-1a: a per-case seed from the case's identity, so one case replays alone. */
const caseSeed = (...parts: Array<string | number>): number => {
  let h = 0x811c9dc5 ^ SEED;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

const isIntegerParam = (p: Param) => {
  const t = deref(p.schema).type;
  return t === 'integer' || t === 'number';
};

const pathValue = (o: Operation, p: Param, fx: Fixtures, rng: Rng, chosen: Record<string, string>): string => {
  const at = o.path.indexOf(`{${p.name}}`);
  const collection = o.path.slice(0, at).replace(/\/$/, '');
  if (isIntegerParam(p)) {
    const table = COLLECTION_TABLES[collection] ?? tableForName(p.name) ?? (collection.endsWith('geofences') ? 'department_geofences' : undefined);
    const mutating = MUTATING.has(o.method);
    const created = fx.created.get(collection) ?? [];
    // A mutating request prefers a row the fuzzer itself created, so deletes
    // eat fuzz data rather than the seeded rows later operations read.
    if (mutating && created.length && rng.chance(o.method === 'delete' ? 0.9 : 0.6)) return String(rng.pick(created));
    const guard = table ? fx.protectedIds.get(table) : undefined;
    const pool = (table ? fx.ids.get(table) ?? [] : []).filter((id) => !(mutating && guard?.has(id)));
    return String(pool.length ? rng.pick(pool) : rng.int(1, 50));
  }
  const fromStrings = (key: string) => {
    const pool = fx.strings.get(key);
    return pool?.length ? rng.pick(pool) : undefined;
  };
  if (o.path.startsWith('/settings/{category}')) {
    if (p.name === 'category') {
      const pair = fromStrings('setting') ?? 'general/app_name';
      const [category, key] = pair.split('/');
      chosen.key = key;
      return category;
    }
    if (p.name === 'key' && chosen.key) return chosen.key;
  }
  if (o.path.startsWith('/settings/category')) return (fromStrings('setting') ?? 'general/x').split('/')[0];
  if (o.path.startsWith('/policies/presets')) return fromStrings('preset') ?? 'eu-wtd';
  if (o.path.startsWith('/modules') && p.name === 'code') return fromStrings('module') ?? 'scheduling';
  if (p.name === 'org') return fromStrings('organization') ?? 'Demo Org';
  if (p.name === 'type' || p.name === 'changeType') return fromStrings('changeType') ?? 'shift_swap';
  if (o.path.startsWith('/directory') && p.name === 'key') return fromStrings('fieldKey') ?? 'badge';
  const s = deref(p.schema);
  if (Array.isArray(s.enum)) return String(rng.pick(s.enum));
  return `fuzz${rng.int(0, 9999)}`;
};

const genContext = (rng: Rng, fx: Fixtures, mode: 'valid' | 'boundary'): GenContext => ({ rng, source: fx, deref, mode });

const zodAccepts = (schema: ZodType | undefined, value: unknown): boolean | undefined =>
  schema ? schema.safeParse(value).success : undefined;

const buildCase = (o: Operation, actor: Actor, cls: CaseClass, iteration: number, fx: Fixtures): Case | undefined => {
  const seed = caseSeed(o.key, actor.name, cls, iteration);
  const rng = createRng(seed);
  const ctx = genContext(rng, fx, cls === 'boundary' ? 'boundary' : 'valid');
  const chosen: Record<string, string> = {};
  const pathParams = o.params.filter((p) => p.in === 'path');
  const queryParams = o.params.filter((p) => p.in === 'query');

  const pathValues: Record<string, string> = {};
  for (const p of pathParams) pathValues[p.name] = pathValue(o, p, fx, rng, chosen);

  const query: Record<string, string | string[]> = {};
  for (const p of queryParams) {
    if (p.required || rng.chance(cls === 'boundary' ? 0.8 : 0.5)) query[p.name] = queryValue(generate(p.schema, p.name, ctx));
  }
  let body = o.bodySchema ? generate(o.bodySchema, 'body', ctx) : undefined;
  let raw: string | undefined;
  let mutation: string | undefined;

  if (cls === 'malformed') {
    // Only an input the route actually validates can be malformed; an
    // operation with none has nothing to break.
    const targets: string[] = [];
    if (o.bodySchema && o.bodyZod) targets.push('body', 'body');
    if (queryParams.length && o.queryZod) targets.push('query');
    const intPath = pathParams.filter(isIntegerParam);
    if (intPath.length) targets.push('path');
    if (!targets.length) return undefined;
    const target = rng.pick(targets);
    if (target === 'body') {
      const m = mutateBody(o.bodySchema!, body, genContext(rng, fx, 'valid'));
      body = m.value;
      raw = m.raw;
      mutation = m.label;
    } else if (target === 'query') {
      const m = mutateQuery(queryParams, query, genContext(rng, fx, 'valid'));
      for (const k of Object.keys(query)) delete query[k];
      Object.assign(query, m.value as Record<string, string | string[]>);
      mutation = m.label;
    } else {
      const p = rng.pick(intPath);
      pathValues[p.name] = malformedPathId(rng);
      mutation = `malformed path parameter '${p.name}'`;
    }
  }
  // A body that is not a plain object travels as raw JSON text, so supertest
  // does not reinterpret a string root as a form body.
  if (raw === undefined && body !== undefined && (body === null || typeof body !== 'object')) raw = JSON.stringify(body);

  // ── Judge ──
  const reasons: string[] = [];
  let verdict: Case['verdict'] = 'valid';
  for (const p of pathParams.filter(isIntegerParam)) {
    const v = pathValues[p.name];
    if (!/^[1-9]\d*$/.test(v) || Number(v) > Number.MAX_SAFE_INTEGER) {
      verdict = 'invalid';
      reasons.push(`path ${p.name}`);
    }
  }
  if (o.bodySchema) {
    let parsed: unknown = body;
    let syntaxOk = true;
    if (raw !== undefined) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        syntaxOk = false;
      }
    }
    // express.json() is strict: a primitive or null root never reaches the
    // route, so it is invalid whatever the schema would say about it.
    const strictRoot = raw === undefined || (parsed !== null && typeof parsed === 'object');
    const ok = syntaxOk && strictRoot ? zodAccepts(o.bodyZod, parsed ?? {}) : false;
    if (ok === false) {
      verdict = 'invalid';
      reasons.push('body');
    } else if (ok === undefined && verdict === 'valid') verdict = 'unknown';
  }
  if (queryParams.length) {
    const ok = zodAccepts(o.queryZod, query);
    if (ok === false) {
      verdict = 'invalid';
      reasons.push('query');
    } else if (ok === undefined && verdict === 'valid') verdict = 'unknown';
  }

  const url = o.path.replace(/\{(\w+)\}/g, (_m, name) => encodeURIComponent(pathValues[name]).replace(/%25/g, '%')) + toQueryString(query);
  return { actor: actor.name, cls, iteration, seed, url, body, raw, mutation, verdict, verdictReason: reasons.join(', ') || undefined };
};

// ── Oracles ─────────────────────────────────────────────────────────────────

interface Failure {
  signature: string;
  oracle: string;
  operation: string;
  status: number;
  detail: string;
  case: Case;
  response: string;
}

const documents = (o: Operation, status: number): boolean => {
  const r = o.op.responses ?? {};
  return String(status) in r || `${String(status)[0]}XX` in r || 'default' in r;
};

const judgeResponse = (o: Operation, c: Case, res: request.Response): Array<Omit<Failure, 'case' | 'response' | 'operation' | 'signature'>> => {
  const out: Array<Omit<Failure, 'case' | 'response' | 'operation' | 'signature'>> = [];
  const status = res.status;
  const add = (oracle: string, detail: string) => out.push({ oracle, status, detail });
  const contentType = String(res.headers['content-type'] ?? '');
  const isJson = /application\/json/.test(contentType);
  const text = isJson ? JSON.stringify(res.body) : res.text ?? '';
  const documented = documents(o, status);

  if (status >= 500 && !documented) add('5xx', `${res.body?.error?.code ?? ''} — logged: ${loggedErrors.join(' | ').slice(0, 300) || 'nothing'}`);
  if (status >= 400) {
    if (!isJson) add('error-not-json', `content-type "${contentType}"`);
    else if (!validateApiError(res.body)) add('error-envelope', ajv.errorsText(validateApiError.errors));
    const leak = findLeak(text);
    if (leak) add('leak', leak);
  }
  if (status >= 200 && status < 300 && isJson) {
    const body = res.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || body.success !== true || !('data' in body)) {
      add('success-envelope', `2xx body without { success: true, data }`);
    }
  }
  if (status >= 200 && status < 300 && c.verdict === 'invalid') add('malformed-accepted', `invalid ${c.verdictReason} accepted`);
  if (status === 400 && c.verdict === 'valid' && !documented) add('valid-rejected', `${res.body?.error?.code ?? ''}: ${res.body?.error?.message ?? ''}`);
  if (isJson && documented) {
    const validator = responseValidator(o, status);
    if (validator && !validator(res.body)) add('response-schema', ajv.errorsText(validator.errors).slice(0, 300));
  }
  // An undocumented status is reported on its own only when nothing more
  // specific already explains the response.
  if (!documented && !out.some((f) => ['5xx', 'valid-rejected'].includes(f.oracle))) {
    add('undocumented-status', `${res.body?.error?.code ?? ''}`.trim());
  }
  return out;
};

// ── Suite ───────────────────────────────────────────────────────────────────

let admin: mysql.Connection;
let app: Express;
let teardown: () => Promise<void>;
const fx = new Fixtures();
const cookies = new Map<string, string>();
const loggedErrors: string[] = [];
const failures: Failure[] = [];
const signatures = new Map<string, Failure & { count: number }>();
const stats = { requests: 0, relogins: 0, byVerdict: { valid: 0, invalid: 0, unknown: 0 } as Record<string, number>, operations: 0, skippedMalformed: 0 };
let operations: Operation[] = [];

const login = async (actor: Actor): Promise<void> => {
  const res = await request(app).post('/api/v1/auth/login').send({ email: actor.email, password: actor.password });
  if (res.status !== 200) throw new Error(`login as ${actor.email} failed: ${res.status} ${preview(res.body)}`);
  const setCookie = res.headers['set-cookie'] as unknown as string[] | string;
  cookies.set(
    actor.name,
    (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(';')[0]).join('; ')
  );
};

const loadFixtures = async (): Promise<void> => {
  const tables = new Set([...Object.values(COLLECTION_TABLES), ...NAME_TABLES.map(([, t]) => t), 'calendar_tokens']);
  for (const table of tables) {
    try {
      const [rows] = await admin.query<mysql.RowDataPacket[]>(`SELECT id FROM \`${table}\` ORDER BY id LIMIT 200`);
      fx.ids.set(table, rows.map((r) => Number(r.id)));
    } catch {
      fx.ids.set(table, []);
    }
  }
  if (!fx.ids.get('user_calendar_tokens')?.length) fx.ids.set('user_calendar_tokens', fx.ids.get('calendar_tokens') ?? []);
  const strings = async (key: string, sql: string) => {
    try {
      const [rows] = await admin.query<mysql.RowDataPacket[]>(sql);
      fx.strings.set(key, rows.map((r) => String(r.v)).filter(Boolean));
    } catch {
      fx.strings.set(key, []);
    }
  };
  await strings('permission', 'SELECT code AS v FROM permissions ORDER BY id');
  await strings('organization', 'SELECT DISTINCT organization_name AS v FROM users WHERE organization_name IS NOT NULL');
  await strings('changeType', 'SELECT DISTINCT change_type AS v FROM approval_matrix');
  await strings('module', 'SELECT code AS v FROM modules ORDER BY id');
  await strings('fieldKey', 'SELECT DISTINCT field_key AS v FROM user_custom_fields');
  await strings('setting', "SELECT CONCAT(category, '/', `key`) AS v FROM system_settings ORDER BY id");

  const [people] = await admin.query<mysql.RowDataPacket[]>('SELECT id FROM users WHERE email IN (?, ?)', [ADMIN.email, EMPLOYEE.email]);
  const userIds = people.map((r) => Number(r.id));
  fx.protectedIds.set('users', new Set(userIds));
  const [roles] = await admin.query<mysql.RowDataPacket[]>('SELECT DISTINCT role_id FROM user_roles WHERE user_id IN (?)', [userIds]);
  fx.protectedIds.set('roles', new Set(roles.map((r) => Number(r.role_id))));
};

const presetCodes = async (): Promise<void> => {
  const res = await request(app).get('/api/v1/policies/presets').set('Cookie', cookies.get('admin')!);
  const codes = Array.isArray(res.body?.data) ? res.body.data.map((p: { code?: string }) => p.code).filter(Boolean) : [];
  fx.strings.set('preset', codes);
};

const collectOperations = (): Operation[] => {
  const zod = require('../../schemas') as Record<string, ZodType>;
  const found = new Map(scanRoutes().map((f) => [`${f.method.toUpperCase()} ${f.specPath}`, f]));
  const ops: Operation[] = [];
  for (const [p, item] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      const key = `${method.toUpperCase()} ${p}`;
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((x: any) => deref(x) as Param);
      const f = found.get(key);
      ops.push({
        key,
        method,
        path: p,
        op,
        params,
        bodySchema: op.requestBody?.content?.['application/json']?.schema,
        found: f,
        bodyZod: f?.schemaName ? zod[f.schemaName] : undefined,
        queryZod: f?.querySchemaName ? zod[f.querySchemaName] : undefined,
        authenticated: !(Array.isArray(op.security) && op.security.length === 0),
      });
    }
  }
  /*
   * Reads first, then creates, updates, actions on a row and deletes; last the
   * operations that change the sessions or the platform itself (auth, modules,
   * settings), so disabling a module or revoking a token cannot blind every
   * operation after it.
   */
  const phase = (o: Operation): number => {
    const disruptive = /^\/(auth|modules)(\/|$)/.test(o.path) || (o.method !== 'get' && /^\/(settings|employee-field-policies)/.test(o.path));
    if (disruptive) return o.path === '/auth/refresh/logout' ? 11 : 10;
    if (o.method === 'get') return 0;
    if (o.method === 'post' && !o.path.includes('{')) return 1;
    if (o.method === 'put' || o.method === 'patch') return 2;
    if (o.method === 'post') return 3;
    return 4;
  };
  return ops
    .map((o, i) => ({ o, i }))
    .sort((a, b) => phase(a.o) - phase(b.o) || a.i - b.i)
    .map(({ o }) => o);
};

const send = async (o: Operation, c: Case, actor: Actor): Promise<request.Response> => {
  const once = () => {
    let r = (request(app) as any)[o.method](`/api/v1${c.url}`).timeout({ deadline: 60_000 });
    if (o.authenticated) r = r.set('Cookie', cookies.get(actor.name)!);
    if (c.raw !== undefined) r = r.set('Content-Type', 'application/json').send(c.raw);
    else if (c.body !== undefined) r = r.send(c.body);
    return r as Promise<request.Response>;
  };
  loggedErrors.length = 0;
  let res = await once();
  // A fuzzed request may legitimately end the session (logout, a password
  // change, a revoked delegation): sign in again and resend once, so one
  // operation cannot turn every later one into a 401.
  if (o.authenticated && res.status === 401 && ['MISSING_TOKEN', 'INVALID_TOKEN', 'TOKEN_REVOKED', 'USER_NOT_FOUND'].includes(res.body?.error?.code)) {
    stats.relogins += 1;
    await login(actor);
    res = await once();
  }
  return res;
};

const record = (o: Operation, c: Case, res: request.Response | undefined, found: Array<Omit<Failure, 'case' | 'response' | 'operation' | 'signature'>>) => {
  for (const f of found) {
    const signature = `${o.key} | ${f.oracle} | ${f.status}`;
    const failure: Failure = {
      ...f,
      signature,
      operation: o.key,
      case: c,
      response: res ? `${res.status} ${preview(res.headers['content-type'] && /json/.test(String(res.headers['content-type'])) ? res.body : res.text, 400)}` : 'no response',
    };
    failures.push(failure);
    const existing = signatures.get(signature);
    // Keep the smallest reproducing request per signature.
    const size = (x: Failure) => (x.case.raw ?? JSON.stringify(x.case.body) ?? '').length + x.case.url.length;
    if (!existing) signatures.set(signature, { ...failure, count: 1 });
    else {
      existing.count += 1;
      if (size(failure) < size(existing)) signatures.set(signature, { ...failure, count: existing.count });
    }
  }
};

const harvest = (o: Operation, res: request.Response) => {
  if (o.method !== 'post' || o.path.includes('{') || res.status < 200 || res.status >= 300) return;
  const id = res.body?.data?.id;
  if (Number.isInteger(id)) fx.created.set(o.path, [...(fx.created.get(o.path) ?? []), id]);
};

const formatCase = (f: Failure & { count?: number }) =>
  [
    `  ${f.signature}${f.count ? `  (x${f.count})` : ''}${KNOWN_FAILURES[f.signature] ? `  [known: #${KNOWN_FAILURES[f.signature]}]` : ''}`,
    `    oracle detail: ${f.detail}`,
    `    replay: TEST_SEED=${SEED} FUZZ_OPERATIONS='^${f.operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$'  (case seed ${f.case.seed}, ${f.case.actor}, ${f.case.cls}, iteration ${f.case.iteration})`,
    `    request: ${f.operation.split(' ')[0]} /api/v1${f.case.url}${f.case.mutation ? `  [${f.case.mutation}]` : ''}  verdict=${f.case.verdict}`,
    `    body: ${f.case.raw !== undefined ? preview(f.case.raw) : preview(f.case.body)}`,
    `    response: ${f.response}`,
  ].join('\n');

beforeAll(async () => {
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL must point at a reachable Redis for the fuzzing suite');
  admin = await mysql.createConnection({ ...DB, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${FUZZ_DB}\``);
  await admin.query(`CREATE DATABASE \`${FUZZ_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`USE \`${FUZZ_DB}\``);
  await admin.query(migrationUpSql());

  // The demo dataset gives every operation real rows to point at: schedules
  // in each status, pending requests, an org tree, delegations, tokens.
  const { seedDemo } = require('../../../scripts/seed-demo') as typeof import('../../../scripts/seed-demo');
  await seedDemo();

  const { database } = require('../../config/database');
  const { buildApp } = require('../../app');
  app = buildApp(database.getPool(), { silent: true });
  // The 500 body is deliberately generic (#895); the cause is in the log.
  // Capture what the app logs at error level so a 5xx entry in the report
  // names its driver error instead of sending the reader to rerun with logs.
  const { logger } = require('../../config/logger') as typeof import('../../config/logger');
  const originalError = logger.error.bind(logger);
  (logger as unknown as { error: (...args: unknown[]) => unknown }).error = (...args: unknown[]) => {
    loggedErrors.push(
      args
        .map((a) => (a instanceof Error ? `${(a as Error & { code?: string }).code ?? a.name}: ${a.message}` : typeof a === 'string' ? a : preview(a, 200)))
        .join(' ')
    );
    return (originalError as (...a: unknown[]) => unknown)(...args);
  };
  const { closeRedis } = require('../../config/redis') as typeof import('../../config/redis');
  const queue = require('../../services/OptimizationQueue') as typeof import('../../services/OptimizationQueue');
  teardown = async () => {
    await queue.getOptimizationQueue()?.obliterate({ force: true });
    await queue.closeOptimizationQueue();
    await closeRedis();
    await database.close();
  };

  await login(ADMIN);
  await login(EMPLOYEE);
  await loadFixtures();
  await presetCodes();
  operations = collectOperations();
}, 180_000);

afterAll(async () => {
  if (teardown) await teardown();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS \`${FUZZ_DB}\``);
    await admin.end();
  }
}, 60_000);

describe(`API contract fuzzing (seed ${SEED}, ${ITERATIONS} per class)`, () => {
  it('finds every operation of the spec', () => {
    // 318 when this suite landed; the floor guards against the spec failing
    // to load or the loop silently reaching only part of it.
    expect(operations.length).toBeGreaterThanOrEqual(300);
    const unmapped = operations.filter((o) => (o.bodySchema && !o.bodyZod) || (o.params.some((p) => p.in === 'query') && !o.queryZod));
    // Operations whose spec inputs have no Zod schema behind them cannot be
    // judged; they still face every response oracle. Listed, not failed.
    if (unmapped.length) process.stdout.write(`fuzz: ${unmapped.length} operation(s) without a Zod schema to judge inputs: ${unmapped.map((o) => o.key).join(', ')}\n`);
  });

  it('holds every response to the contract', async () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      for (const o of operations) {
        if (EXCLUDED[o.key] || (OPERATION_FILTER && !OPERATION_FILTER.test(o.key))) continue;
        if (iteration === 0) stats.operations += 1;
        // The employee first: its requests are mostly refused, so they leave
        // the rows the administrator's requests then act on.
        for (const actor of [EMPLOYEE, ADMIN]) {
          for (const cls of ['valid', 'boundary', 'malformed'] as CaseClass[]) {
            const c = buildCase(o, actor, cls, iteration, fx);
            if (!c) {
              stats.skippedMalformed += 1;
              continue;
            }
            stats.requests += 1;
            stats.byVerdict[c.verdict] += 1;
            let res: request.Response | undefined;
            try {
              res = await send(o, c, actor);
            } catch (err) {
              record(o, c, undefined, [{ oracle: 'no-response', status: 0, detail: (err as Error).message }]);
              continue;
            }
            harvest(o, res);
            record(o, c, res, judgeResponse(o, c, res));
          }
        }
      }
    }

    const all = [...signatures.values()].sort((a, b) => a.signature.localeCompare(b.signature));
    const unexpected = all.filter((f) => !KNOWN_FAILURES[f.signature]);
    const stale = DEFAULT_RUN ? Object.keys(KNOWN_FAILURES).filter((s) => !signatures.has(s)) : [];

    const lines = [
      `\nAPI fuzz campaign: seed ${SEED}, ${ITERATIONS} iteration(s), ${stats.operations} operations, ${stats.requests} requests`,
      `  verdicts: ${JSON.stringify(stats.byVerdict)}; re-logins: ${stats.relogins}; malformed cases skipped (no validated input): ${stats.skippedMalformed}`,
      `  ${failures.length} failing responses in ${all.length} distinct signatures (${all.length - unexpected.length} known, ${unexpected.length} new)`,
      '',
      // In the CI configuration the known entries would be a thousand lines of
      // unchanged log on every green run; a campaign prints all of them.
      ...(DEFAULT_RUN ? unexpected : all).map(formatCase),
    ];
    if (stale.length) lines.push('', 'Allowlisted signatures that no longer fire (remove them):', ...stale.map((s) => `  ${s}  [#${KNOWN_FAILURES[s]}]`));
    process.stdout.write(lines.join('\n') + '\n');
    if (process.env.FUZZ_REPORT) {
      fs.writeFileSync(process.env.FUZZ_REPORT, JSON.stringify({ seed: SEED, iterations: ITERATIONS, stats, signatures: all }, null, 2));
    }

    expect({ unexpected: unexpected.map((f) => f.signature), stale }).toEqual({ unexpected: [], stale: [] });
  }, 3_600_000);
});

/*
 * Known failure signatures (`METHOD /path | oracle | status`), each against the
 * open issue that tracks it. An entry is deleted in the PR that fixes it: the
 * default run fails on an entry that no longer fires, so the list only shrinks.
 * Declared last because it is long; it is read only once the tests run.
 */
const KNOWN_FAILURES: Record<string, number> = {
  // #900: expiry strings reach a DATETIME column unconverted (500 on an ISO timestamp).
  'POST /delegations | 5xx | 500': 900,
  'POST /roles/bulk-assign | 5xx | 500': 900,
  'POST /roles/users/{userId} | 5xx | 500': 900,
  // #903: spec mismatches — undocumented statuses, 2xx without `data`, response schemas that do not describe the response.
  'DELETE /approval-workflows/{id} | success-envelope | 200': 903,
  'DELETE /approval-workflows/{id} | undocumented-status | 400': 903,
  'DELETE /assignments/{id} | success-envelope | 200': 903,
  'DELETE /assignments/{id} | undocumented-status | 400': 903,
  'DELETE /calendar/tokens/{id} | success-envelope | 200': 903,
  'DELETE /calendar/tokens/{id} | undocumented-status | 400': 903,
  'DELETE /cost-plans/{id} | success-envelope | 200': 903,
  'DELETE /cost-plans/{id} | undocumented-status | 400': 903,
  'DELETE /delegations/{id} | undocumented-status | 400': 903,
  'DELETE /departments/{id} | undocumented-status | 400': 903,
  'DELETE /departments/{id}/geofences/{geofenceId} | undocumented-status | 400': 903,
  'DELETE /departments/{id}/kiosks/{kioskId} | undocumented-status | 400': 903,
  'DELETE /departments/{id}/kiosks/{kioskId} | undocumented-status | 404': 903,
  'DELETE /departments/{id}/users/{userId} | undocumented-status | 400': 903,
  'DELETE /directory/users/{id}/fields/{key} | undocumented-status | 400': 903,
  'DELETE /employee-pairings/{id} | success-envelope | 200': 903,
  'DELETE /employee-pairings/{id} | undocumented-status | 400': 903,
  'DELETE /employees/{id} | success-envelope | 200': 903,
  'DELETE /employees/{id} | undocumented-status | 400': 903,
  'DELETE /employees/{id}/skills/{skillId} | success-envelope | 200': 903,
  'DELETE /employees/{id}/skills/{skillId} | undocumented-status | 400': 903,
  'DELETE /i18n/overrides/admin/{id} | success-envelope | 200': 903,
  'DELETE /i18n/overrides/admin/{id} | undocumented-status | 400': 903,
  'DELETE /modules/{code}/org/{org} | success-envelope | 200': 903,
  'DELETE /on-call/periods/{id} | success-envelope | 200': 903,
  'DELETE /org/units/{id} | success-envelope | 200': 903,
  'DELETE /org/units/{id} | undocumented-status | 400': 903,
  'DELETE /org/units/{id}/members/{userId} | success-envelope | 200': 903,
  'DELETE /policies/{id} | success-envelope | 200': 903,
  'DELETE /policies/{id} | undocumented-status | 400': 903,
  'DELETE /policies/{id} | undocumented-status | 404': 903,
  'DELETE /responsibility-rules/{id} | success-envelope | 200': 903,
  'DELETE /responsibility-rules/{id} | undocumented-status | 400': 903,
  'DELETE /roles/{id} | success-envelope | 200': 903,
  'DELETE /roles/users/{userId}/{roleId} | success-envelope | 200': 903,
  'DELETE /roles/users/{userId}/{roleId} | undocumented-status | 400': 903,
  'DELETE /schedules/{id} | undocumented-status | 409': 903,
  'DELETE /schedules/{id}/optimization | success-envelope | 200': 903,
  'DELETE /shifts/{id} | success-envelope | 200': 903,
  'DELETE /shifts/{id} | undocumented-status | 400': 903,
  'DELETE /shifts/templates/{id} | success-envelope | 200': 903,
  'DELETE /shifts/templates/{id} | undocumented-status | 400': 903,
  'DELETE /skills/{id} | success-envelope | 200': 903,
  'DELETE /skills/{id} | undocumented-status | 400': 903,
  'DELETE /sso/providers/{id} | success-envelope | 200': 903,
  'DELETE /sso/providers/{id} | undocumented-status | 400': 903,
  'DELETE /users/{id} | success-envelope | 200': 903,
  'DELETE /users/{id} | undocumented-status | 400': 903,
  'GET /approval-workflows | undocumented-status | 403': 903,
  'GET /assignments | undocumented-status | 403': 903,
  'GET /assignments/{id} | undocumented-status | 400': 903,
  'GET /assignments/{id} | undocumented-status | 403': 903,
  'GET /assignments/{id}/swap-candidates | undocumented-status | 400': 903,
  'GET /assignments/department/{departmentId} | undocumented-status | 400': 903,
  'GET /assignments/department/{departmentId} | undocumented-status | 403': 903,
  'GET /assignments/shift/{shiftId} | undocumented-status | 403': 903,
  'GET /assignments/shift/{shiftId}/available-employees | undocumented-status | 400': 903,
  'GET /assignments/shift/{shiftId}/available-employees | undocumented-status | 403': 903,
  'GET /assignments/user/{userId} | undocumented-status | 400': 903,
  'GET /assignments/user/{userId} | undocumented-status | 403': 903,
  'GET /attendance | undocumented-status | 400': 903,
  'GET /attendance/{id} | undocumented-status | 400': 903,
  'GET /audit-logs | response-schema | 200': 903,
  'GET /audit-logs | undocumented-status | 400': 903,
  'GET /audit-logs/{id} | undocumented-status | 400': 903,
  'GET /auth/sso/{id}/login | undocumented-status | 400': 903,
  'GET /auth/sso/providers | undocumented-status | 400': 903,
  'GET /auth/verify | response-schema | 200': 903,
  'GET /calendar/aggregate.ics | undocumented-status | 400': 903,
  'GET /calendar/department/{id}.ics | undocumented-status | 400': 903,
  'GET /calendar/feed.ics | undocumented-status | 400': 903,
  'GET /change-requests | undocumented-status | 400': 903,
  'GET /change-requests/{id} | undocumented-status | 400': 903,
  'GET /cost-plans | undocumented-status | 400': 903,
  'GET /cost-plans/{id} | undocumented-status | 400': 903,
  'GET /departments | response-schema | 200': 903,
  'GET /departments | undocumented-status | 400': 903,
  'GET /departments/{id} | undocumented-status | 400': 903,
  'GET /departments/{id} | undocumented-status | 403': 903,
  'GET /departments/{id}/geofences | undocumented-status | 400': 903,
  'GET /departments/{id}/kiosks | undocumented-status | 400': 903,
  'GET /departments/{id}/stats | undocumented-status | 400': 903,
  'GET /departments/{id}/stats | undocumented-status | 403': 903,
  'GET /directory/users/{id}/vcard | undocumented-status | 403': 903,
  'GET /directory/vcard.vcf | undocumented-status | 400': 903,
  'GET /employee-pairings | undocumented-status | 400': 903,
  'GET /employee-pairings/{id} | undocumented-status | 400': 903,
  'GET /employees | undocumented-status | 400': 903,
  'GET /employees/{id} | undocumented-status | 400': 903,
  'GET /employees/{id}/skills | undocumented-status | 400': 903,
  'GET /employees/department/{departmentId} | undocumented-status | 400': 903,
  'GET /employment-contracts/{id} | undocumented-status | 400': 903,
  'GET /employment-contracts/users/{userId} | undocumented-status | 400': 903,
  'GET /integrations/payroll/export | undocumented-status | 403': 903,
  'GET /integrations/payroll/export/{id} | undocumented-status | 400': 903,
  'GET /integrations/payroll/export/{id} | undocumented-status | 403': 903,
  'GET /modules | undocumented-status | 403': 903,
  'GET /notifications | undocumented-status | 400': 903,
  'GET /on-call/periods/{id} | undocumented-status | 400': 903,
  'GET /on-call/periods/{id}/assignments | undocumented-status | 400': 903,
  'GET /org/loans | undocumented-status | 400': 903,
  'GET /org/units/{id} | response-schema | 200': 903,
  'GET /org/units/{id} | undocumented-status | 400': 903,
  'GET /org/units/{id}/members | undocumented-status | 400': 903,
  'GET /org/units/{id}/members/detailed | undocumented-status | 400': 903,
  'GET /pending-approvals | undocumented-status | 400': 903,
  'GET /pending-approvals/{id}/chain | undocumented-status | 400': 903,
  'GET /permissions | undocumented-status | 403': 903,
  'GET /policies/{id} | undocumented-status | 400': 903,
  'GET /policies/exceptions | undocumented-status | 400': 903,
  'GET /preferences/{userId} | undocumented-status | 400': 903,
  'GET /reports/attendance-anomalies | undocumented-status | 400': 903,
  'GET /reports/attendance-anomalies | undocumented-status | 403': 903,
  'GET /reports/compliance-violations-trend | undocumented-status | 400': 903,
  'GET /reports/compliance-violations-trend | undocumented-status | 403': 903,
  'GET /reports/cost-by-department | undocumented-status | 400': 903,
  'GET /reports/cost-by-department | undocumented-status | 403': 903,
  'GET /reports/fairness/{scheduleId} | undocumented-status | 400': 903,
  'GET /reports/fairness/{scheduleId} | undocumented-status | 403': 903,
  'GET /reports/hours-worked | undocumented-status | 400': 903,
  'GET /reports/hours-worked | undocumented-status | 403': 903,
  'GET /responsibility-rules | undocumented-status | 400': 903,
  'GET /responsibility-rules/{id} | undocumented-status | 400': 903,
  'GET /responsibility-rules/{id}/conflicts | undocumented-status | 400': 903,
  'GET /responsibility-rules/matrix | response-schema | 200': 903,
  'GET /roles | undocumented-status | 403': 903,
  'GET /roles/{id} | undocumented-status | 400': 903,
  'GET /roles/{id} | undocumented-status | 403': 903,
  'GET /schedules | undocumented-status | 400': 903,
  'GET /schedules/{id} | undocumented-status | 400': 903,
  'GET /schedules/{id}/predecessor-candidates | undocumented-status | 400': 903,
  'GET /schedules/{id}/replan-proposals | undocumented-status | 400': 903,
  'GET /schedules/{id}/shifts | undocumented-status | 400': 903,
  'GET /schedules/department/{departmentId} | undocumented-status | 400': 903,
  'GET /schedules/user/{userId} | undocumented-status | 400': 903,
  'GET /schedules/user/{userId} | undocumented-status | 403': 903,
  'GET /settings/{category}/{key} | undocumented-status | 403': 903,
  'GET /settings/category/{category} | undocumented-status | 403': 903,
  'GET /shift-swap | undocumented-status | 400': 903,
  'GET /shift-swap/{id} | undocumented-status | 400': 903,
  'GET /shift-swap/{id} | undocumented-status | 403': 903,
  'GET /shift-swap/open | undocumented-status | 400': 903,
  'GET /shifts | undocumented-status | 400': 903,
  'GET /shifts/department/{departmentId} | undocumented-status | 400': 903,
  'GET /shifts/schedule/{scheduleId} | undocumented-status | 400': 903,
  'GET /shifts/templates/{id} | undocumented-status | 400': 903,
  'GET /skill-gap | undocumented-status | 403': 903,
  'GET /skills/{id} | undocumented-status | 400': 903,
  'GET /sso/providers/{id} | undocumented-status | 400': 903,
  'GET /time-off | undocumented-status | 400': 903,
  'GET /time-off/{id} | undocumented-status | 400': 903,
  'GET /time-off/{id} | undocumented-status | 403': 903,
  'GET /users | response-schema | 200': 903,
  'GET /users | undocumented-status | 400': 903,
  'GET /users/{id} | undocumented-status | 400': 903,
  'GET /users/{id} | undocumented-status | 403': 903,
  'GET /webhooks | valid-rejected | 400': 903,
  'GET /webhooks/{id}/deliveries | undocumented-status | 400': 903,
  'PATCH /assignments/{id}/complete | undocumented-status | 403': 903,
  'PATCH /assignments/{id}/confirm | undocumented-status | 403': 903,
  'PATCH /assignments/{id}/decline | undocumented-status | 400': 903,
  'PATCH /assignments/{id}/decline | undocumented-status | 403': 903,
  'PATCH /schedules/{id}/archive | undocumented-status | 400': 903,
  'PATCH /schedules/{id}/archive | undocumented-status | 409': 903,
  'PATCH /schedules/{id}/publish | undocumented-status | 409': 903,
  'POST /approval-workflows | undocumented-status | 400': 903,
  'POST /approval-workflows | undocumented-status | 409': 903,
  'POST /assignments | response-schema | 201': 903,
  'POST /assignments | undocumented-status | 404': 903,
  'POST /assignments/bulk | undocumented-status | 400': 903,
  'POST /attendance/{id}/approve | undocumented-status | 400': 903,
  'POST /attendance/{id}/clock-out | undocumented-status | 400': 903,
  'POST /attendance/{id}/reject | undocumented-status | 400': 903,
  'POST /attendance/clock-in | undocumented-status | 400': 903,
  'POST /auth/2fa/challenge | undocumented-status | 400': 903,
  'POST /auth/2fa/setup | undocumented-status | 400': 903,
  'POST /auth/login/challenge | undocumented-status | 400': 903,
  'POST /auth/refresh | undocumented-status | 400': 903,
  'POST /auth/refresh/logout | success-envelope | 200': 903,
  'POST /auth/refresh/logout | undocumented-status | 400': 903,
  'POST /change-requests/{id}/apply | undocumented-status | 400': 903,
  'POST /change-requests/{id}/approve | undocumented-status | 400': 903,
  'POST /change-requests/{id}/cancel | undocumented-status | 400': 903,
  'POST /delegations | undocumented-status | 400': 903,
  'POST /delegations | undocumented-status | 403': 903,
  'POST /delegations | undocumented-status | 422': 903,
  'POST /departments/{id}/geofences | undocumented-status | 400': 903,
  'POST /departments/{id}/kiosks | undocumented-status | 400': 903,
  'POST /departments/{id}/users | undocumented-status | 201': 903,
  'POST /departments/{id}/users | undocumented-status | 400': 903,
  'POST /directory/import-vcard/preview | undocumented-status | 400': 903,
  'POST /employees/{id}/skills | success-envelope | 201': 903,
  'POST /employees/{id}/skills | undocumented-status | 400': 903,
  'POST /import/employees | undocumented-status | 400': 903,
  'POST /import/shifts | undocumented-status | 400': 903,
  'POST /integrations/payroll/export | undocumented-status | 400': 903,
  'POST /integrations/payroll/export | undocumented-status | 403': 903,
  'POST /on-call/periods | undocumented-status | 400': 903,
  'POST /on-call/periods/{id}/assign | undocumented-status | 201': 903,
  'POST /on-call/periods/{id}/assign | undocumented-status | 400': 903,
  'POST /on-call/periods/{id}/assign | undocumented-status | 403': 903,
  'POST /org/loans | undocumented-status | 400': 903,
  'POST /org/loans | undocumented-status | 409': 903,
  'POST /org/loans/{id}/approve | undocumented-status | 409': 903,
  'POST /org/loans/{id}/cancel | undocumented-status | 403': 903,
  'POST /org/loans/{id}/reject | undocumented-status | 409': 903,
  'POST /org/units | undocumented-status | 400': 903,
  'POST /org/units | undocumented-status | 404': 903,
  'POST /org/units/{id}/members | undocumented-status | 201': 903,
  'POST /policies | undocumented-status | 400': 903,
  'POST /policies/exceptions | undocumented-status | 400': 903,
  'POST /policies/exceptions | undocumented-status | 404': 903,
  'POST /policies/exceptions/{id}/approve | undocumented-status | 409': 903,
  'POST /policies/exceptions/{id}/cancel | undocumented-status | 403': 903,
  'POST /policies/exceptions/{id}/cancel | undocumented-status | 409': 903,
  'POST /policies/exceptions/{id}/reject | undocumented-status | 409': 903,
  'POST /policies/presets/{code}/apply | undocumented-status | 403': 903,
  'POST /policies/validate/assignment | undocumented-status | 400': 903,
  'POST /responsibility-rules | undocumented-status | 409': 903,
  'POST /roles | undocumented-status | 400': 903,
  'POST /schedules/{id}/duplicate | undocumented-status | 400': 903,
  'POST /schedules/{id}/generate | undocumented-status | 400': 903,
  'POST /settings/{category}/{key}/reset | success-envelope | 200': 903,
  'POST /shift-swap | undocumented-status | 409': 903,
  'POST /shift-swap/{id}/approve | undocumented-status | 409': 903,
  'POST /shift-swap/{id}/cancel | undocumented-status | 403': 903,
  'POST /shift-swap/{id}/cancel | undocumented-status | 409': 903,
  'POST /shift-swap/{id}/decline | undocumented-status | 409': 903,
  'POST /shift-swap/open/{id}/cancel | undocumented-status | 400': 903,
  'POST /shifts/templates | undocumented-status | 400': 903,
  'POST /time-off/{id}/approve | undocumented-status | 400': 903,
  'POST /time-off/{id}/cancel | undocumented-status | 403': 903,
  'POST /time-off/{id}/reject | undocumented-status | 400': 903,
  'POST /time-off/{id}/reject | undocumented-status | 409': 903,
  'POST /users | undocumented-status | 403': 903,
  'PUT /departments/{id} | undocumented-status | 400': 903,
  'PUT /departments/{id}/geofences/{geofenceId} | undocumented-status | 400': 903,
  'PUT /directory/users/{id}/fields | undocumented-status | 400': 903,
  'PUT /employee-field-policies | undocumented-status | 409': 903,
  'PUT /employees/{id} | undocumented-status | 400': 903,
  'PUT /org/units/{id} | undocumented-status | 400': 903,
  'PUT /policies/{id} | undocumented-status | 400': 903,
  'PUT /preferences/me | undocumented-status | 400': 903,
  'PUT /schedules/{id} | undocumented-status | 409': 903,
  'PUT /settings/currency | undocumented-status | 400': 903,
  'PUT /shifts/{id} | undocumented-status | 400': 903,
  'PUT /users/{id} | undocumented-status | 400': 903,
  // Found by this suite, no issue of their own yet: driver errors surfacing as 500 (INT overflow, impossible dates, CHECK/FK violations, enum truncation), non-JSON or envelope-less errors, schemas looser than the handler behind them. Re-point each entry when its issue is filed.
  'GET /assignments/shift/{shiftId} | malformed-accepted | 200': 908,
  'GET /calendar/aggregate.ics | error-not-json | 401': 908,
  'GET /calendar/department/{id}.ics | error-not-json | 401': 908,
  'GET /calendar/feed.ics | error-not-json | 401': 908,
  'GET /directory/vcard.vcf | valid-rejected | 400': 908,
  'GET /employees/department/{departmentId} | malformed-accepted | 200': 908,
  'GET /on-call/periods/{id}/assignments | malformed-accepted | 200': 908,
  'GET /org/manager-chain/{userId} | malformed-accepted | 200': 908,
  'GET /reports/hours-worked | valid-rejected | 400': 908,
  'POST /approval-workflows | 5xx | 500': 908,
  'POST /departments/{id}/kiosks | 5xx | 500': 908,
  'POST /employment-contracts/users/{userId} | 5xx | 500': 908,
  'POST /import/employees | error-envelope | 400': 908,
  'POST /import/employees | valid-rejected | 400': 908,
  'POST /import/shifts | error-envelope | 400': 908,
  'POST /import/shifts | valid-rejected | 400': 908,
  'POST /integrations/payroll/export | 5xx | 500': 908,
  'POST /org/units/{id}/members | 5xx | 500': 908,
  'POST /sso/providers | 5xx | 500': 908,
  'POST /time-off | 5xx | 500': 908,
  'PUT /assignments/{id} | 5xx | 500': 908,
  'PUT /directory/users/{id}/fields | valid-rejected | 400': 908,
  'PUT /on-call/periods/{id} | 5xx | 500': 908,
  'PUT /preferences/{userId} | 5xx | 500': 908,
  'PUT /shifts/{id} | 5xx | 500': 908,
};
