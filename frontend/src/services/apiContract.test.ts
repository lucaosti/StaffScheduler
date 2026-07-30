/**
 * Frontend service query contracts must match the published OpenAPI spec.
 *
 * WHY THIS EXISTS: the backend now generates its query `parameters` from Zod
 * schemas and fails the build in both directions — nothing documented goes
 * unparsed, nothing parsed goes undocumented. That guard stops at the server
 * boundary, and the frontend drifted on the other side of it: `ShiftFilters`
 * declared `sortBy`/`sortOrder`/`limit` and `EmployeeFilters` declared
 * `position`/`sortBy`/`sortOrder`/`limit`, none of which those endpoints have
 * ever accepted. Since the server validates queries against a schema, unknown
 * keys are stripped, so sending them looked like a working sort and a working
 * page cap while neither did anything — `limit: 50` in particular read as a
 * bound on the employees list while the request returned every row.
 *
 * Both were found one at a time, by accident. This test checks every service
 * at once so the class closes instead of reappearing in whichever service was
 * not audited: a filter key a service can send must be a query parameter the
 * spec documents for that endpoint.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'backend', 'openapi', 'openapi.json'), 'utf8')
) as {
  paths: Record<string, Record<string, { parameters?: Array<{ name?: string; in?: string; $ref?: string }> }>>;
  components?: { parameters?: Record<string, { name?: string; in?: string }> };
};

/**
 * The set of query parameters an endpoint documents, following `$ref`s.
 *
 * Resolving the reference matters: a `$ref` entry carries only `$ref`, so the
 * plain `p.in === 'query'` test read `undefined` and skipped it. This test is
 * the client-side half of a guard whose server-side half had the identical
 * blind spot, and it is what let `limitQuery` publish a `limit` filter on six
 * endpoints that accept no such parameter. Reading the spec the way a client
 * generator does — refs resolved — is the only way this check means anything.
 */
const documentedQuery = (endpoint: string): Set<string> => {
  const op = spec.paths[endpoint]?.get;
  if (!op) throw new Error(`spec has no GET ${endpoint}`);
  const names = new Set<string>();
  for (const p of op.parameters ?? []) {
    const target = p.$ref
      ? spec.components?.parameters?.[p.$ref.replace('#/components/parameters/', '')]
      : p;
    if (!target) throw new Error(`spec references ${p.$ref}, which components.parameters does not define`);
    if (target.in === 'query' && target.name) names.add(target.name);
  }
  return names;
};

/**
 * Services whose filter interface is still hand-written and must therefore be
 * compared against the spec.
 *
 * **This list is now empty, and that is the intended end state, not an
 * oversight.** All four entries — shiftService, employeeService,
 * attendanceService, auditLogService — were converted to derive their filters
 * from `paths` (#367). A derived type cannot drift from the document it is
 * projected from, so comparing it here would assert only that TypeScript
 * indexes objects correctly.
 *
 * The list is kept rather than deleted because the machinery below is the
 * right check for the next hand-written filter type, and the coverage
 * assertion is what routes a new one into it.
 */
const SERVICES: Array<{ file: string; interfaceName: string; endpoint: string }> = [
  // `AggregateFeedFilters` cannot derive: the wire form is one comma-joined
  // string per parameter and the local form is `number[]`, so the shapes
  // genuinely differ. It is named after the published parameters so it can be
  // compared here instead — a filter the endpoint does not document fails.
  {
    file: 'calendarService.ts',
    interfaceName: 'AggregateFeedFilters',
    endpoint: '/calendar/aggregate.ics',
  },
];

/**
 * Whether a service takes its types from the generated contract.
 *
 * Derivation is the STRONGER guarantee, which is why the coverage rule accepts
 * either it or membership of SERVICES. All four services that used to be
 * compared here had drifted — twice, in two cases — and every earlier fix
 * re-copied the schema by hand, which resets the drift clock instead of
 * stopping it. What a service must not be is both hand-written and unchecked.
 */
const derivesFromContract = (source: string): boolean => /=\s*(?:NonNullable<)?\s*paths\[/.test(source);

/** Property names declared by an interface in a service source file. */
const declaredKeys = (source: string, interfaceName: string): string[] => {
  const match = source.match(new RegExp(String.raw`interface ${interfaceName} \{([\s\S]*?)\n\}`));
  if (!match) throw new Error(`interface ${interfaceName} not found`);
  const keys: string[] = [];
  const re = /^\s*(\w+)\??:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) keys.push(m[1]);
  return keys;
};

/**
 * The same guarantee for request payloads.
 *
 * `CreateEmployeeData` omitted `password`, which `createUserBody` requires, so
 * every employee creation from the UI was rejected with a 400 — and the type
 * hid it, because it described a request the server would never accept.
 * `CreateShiftData` had the milder form: `maxStaff` optional where the schema
 * requires it, harmless only because every caller happened to send it.
 *
 * A payload type must therefore declare no field its endpoint rejects, and
 * must mark as required everything the endpoint requires.
 */
const PAYLOADS: Array<{ file: string; interfaceName: string; method: string; endpoint: string }> = [
  // Both entries that used to live here — CreateEmployeeData and
  // CreateShiftData — are now `type X = paths[...]['requestBody'][...]`, so
  // the property this test asserted holds by construction. Kept as the guard
  // for any payload type still written by hand; the coverage assertion below
  // is what stops a new one from skipping both routes.
];

const requestBody = (method: string, endpoint: string): { props: Set<string>; required: Set<string> } => {
  const op = (spec.paths[endpoint] as Record<string, { requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, unknown>; required?: string[] } }> } }>)?.[method];
  const schema = op?.requestBody?.content?.['application/json']?.schema;
  if (!schema) throw new Error(`spec has no request body for ${method.toUpperCase()} ${endpoint}`);
  return { props: new Set(Object.keys(schema.properties ?? {})), required: new Set(schema.required ?? []) };
};

/** Property names, split by whether TypeScript marks them optional. */
const splitKeys = (source: string, interfaceName: string): { all: string[]; required: string[] } => {
  const match = source.match(new RegExp(String.raw`interface ${interfaceName} \{([\s\S]*?)\n\}`));
  if (!match) throw new Error(`interface ${interfaceName} not found`);
  const all: string[] = [];
  const required: string[] = [];
  const re = /^\s*(\w+)(\??):/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(match[1])) !== null) {
    all.push(m[1]);
    if (m[2] !== '?') required.push(m[1]);
  }
  return { all, required };
};

// `it.each([])` is a Jest error, and PAYLOADS is legitimately empty now that
// both entries derive from `paths`. Guarding keeps the machinery in place for
// the next hand-written payload rather than deleting it and rediscovering the
// need later.
const describePayloads = PAYLOADS.length > 0 ? describe : describe.skip;

describePayloads('frontend request payloads match the published body contract', () => {
  it.each(PAYLOADS)('$interfaceName declares no field $endpoint rejects', ({ file, interfaceName, method, endpoint }) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const { props } = requestBody(method, endpoint);
    const rejected = splitKeys(source, interfaceName).all.filter((k) => !props.has(k));
    expect(rejected).toEqual([]);
  });

  it.each(PAYLOADS)('$interfaceName requires everything $endpoint requires', ({ file, interfaceName, method, endpoint }) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const { required } = requestBody(method, endpoint);
    const declared = new Set(splitKeys(source, interfaceName).required);
    const optionalButRequired = Array.from(required).filter((k) => !declared.has(k)).sort();
    expect(optionalButRequired).toEqual([]);
  });
});

describe('frontend service filters match the published query contract', () => {
  /**
   * The coverage rule, and the reason this file keeps earning its place: a
   * service may satisfy the contract either by DERIVING its types from `paths`
   * or by being listed in SERVICES for comparison. Doing neither — a fresh
   * hand-written `*Filters` interface nothing checks — is how `ShiftFilters`
   * and `EmployeeFilters` drifted in the first place, so it fails here.
   */
  it('leaves no service both hand-written and unchecked', () => {
    const unchecked = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('Service.ts'))
      .filter((f) => {
        const source = fs.readFileSync(path.join(__dirname, f), 'utf8');
        return /interface \w*Filters \{/.test(source) && !derivesFromContract(source);
      })
      .filter((f) => !SERVICES.some((s) => s.file === f));
    expect(unchecked).toEqual([]);
  });

  /**
   * The counterpart of the rule above, and the reason it is not vacuous now
   * that SERVICES is empty: at least one service must actually derive. If a
   * refactor reverted every service to hand-written filters, the coverage rule
   * would still pass for any it also added to SERVICES — this asserts the
   * project did not quietly abandon derivation altogether.
   */
  it('has services deriving their types from the contract', () => {
    const deriving = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('Service.ts'))
      .filter((f) => derivesFromContract(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(deriving.length).toBeGreaterThanOrEqual(8);
  });

  const describeUnconverted = SERVICES.length > 0 ? describe : describe.skip;
  describeUnconverted('hand-written filters still under comparison', () => {
    it.each(SERVICES)('$file sends only parameters $endpoint documents', ({ file, interfaceName, endpoint }) => {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const documented = documentedQuery(endpoint);
      const phantom = declaredKeys(source, interfaceName).filter((key) => !documented.has(key));
      expect(phantom).toEqual([]);
    });
  });
});
