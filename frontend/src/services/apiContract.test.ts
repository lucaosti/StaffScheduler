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
