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
  paths: Record<string, Record<string, { parameters?: Array<{ name: string; in: string }> }>>;
};

const documentedQuery = (endpoint: string): Set<string> => {
  const op = spec.paths[endpoint]?.get;
  if (!op) throw new Error(`spec has no GET ${endpoint}`);
  return new Set((op.parameters ?? []).filter((p) => p.in === 'query').map((p) => p.name));
};

/**
 * Each service's filter interface and the endpoint it queries. Adding a
 * service with a `*Filters` type means adding it here; the coverage assertion
 * below fails if one is forgotten.
 */
const SERVICES: Array<{ file: string; interfaceName: string; endpoint: string }> = [
  { file: 'shiftService.ts', interfaceName: 'ShiftFilters', endpoint: '/shifts' },
  { file: 'employeeService.ts', interfaceName: 'EmployeeFilters', endpoint: '/employees' },
  { file: 'attendanceService.ts', interfaceName: 'AttendanceFilters', endpoint: '/attendance' },
  { file: 'auditLogService.ts', interfaceName: 'AuditLogFilters', endpoint: '/audit-logs' },
];

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
  { file: 'employeeService.ts', interfaceName: 'CreateEmployeeData', method: 'post', endpoint: '/employees' },
  { file: 'shiftService.ts', interfaceName: 'CreateShiftData', method: 'post', endpoint: '/shifts' },
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

describe('frontend request payloads match the published body contract', () => {
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
  it('covers every service that declares a filter interface', () => {
    const withFilters = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('Service.ts'))
      .filter((f) => /interface \w*Filters \{/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(withFilters.sort()).toEqual(SERVICES.map((s) => s.file).sort());
  });

  it.each(SERVICES)('$file sends only parameters $endpoint documents', ({ file, interfaceName, endpoint }) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const documented = documentedQuery(endpoint);
    const phantom = declaredKeys(source, interfaceName).filter((key) => !documented.has(key));
    expect(phantom).toEqual([]);
  });
});
