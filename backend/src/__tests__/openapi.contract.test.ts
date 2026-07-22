/**
 * OpenAPI contract tests.
 *
 * These guard the boundary between the published contract
 * (`openapi/openapi.json`, whose request bodies are generated from the shared
 * Zod schemas) and the code that must honour it. They run in the normal Jest
 * suite — no database — so every push exercises them, and they catch three
 * distinct failure modes the generator alone cannot:
 *
 *  1. A request-body schema in the spec that is not valid JSON Schema
 *     draft-2020-12 (a generation bug, a bad hand-edit, or a Zod construct
 *     that emits something Ajv rejects). Every documented body is compiled
 *     with Ajv here, so an unusable schema fails loudly instead of silently
 *     shipping to consumers of the spec.
 *  2. Drift between the spec's declared required/optional fields and the Zod
 *     schemas the routes actually validate with: representative payloads are
 *     validated against the compiled spec schema, asserting that a valid body
 *     passes and a body missing a required field is rejected — exactly the
 *     decision the runtime validation makes.
 *  3. Structural regressions in the error envelope: the shared error-response
 *     components must keep the `{ code, message }` shape the whole frontend
 *     (`handleResponse`) and the typed client depend on.
 *
 * Ajv 8's 2020 build is used because OpenAPI 3.1 embeds JSON Schema
 * draft-2020-12; the draft-07 Ajv already present transitively cannot parse
 * the `$defs`/`prefixItems`/`const` constructs Zod 4 emits.
 */

import * as fs from 'fs';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import * as sharedSchemas from '@staff-scheduler/shared';

interface JsonObject {
  [key: string]: unknown;
}

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'openapi', 'openapi.json'), 'utf8')
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        requestBody?: { content?: { 'application/json'?: { schema?: JsonObject } } };
        parameters?: Array<{ name: string; in: string; schema?: JsonObject; required?: boolean }>;
      }
    >
  >;
  components?: { responses?: Record<string, JsonObject>; schemas?: Record<string, JsonObject> };
};

/** Resolves a local `#/components/...` $ref one hop; returns the node itself otherwise. */
const resolveRef = (node: unknown): JsonObject => {
  if (node && typeof node === 'object' && '$ref' in node) {
    const ref = (node as { $ref: string }).$ref.replace('#/', '').split('/');
    let cur: unknown = spec;
    for (const part of ref) cur = (cur as JsonObject)?.[part];
    return cur as JsonObject;
  }
  return node as JsonObject;
};

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);

/** Every (method, path) that documents a JSON request body, with its schema. */
const bodySchemas: Array<{ id: string; schema: JsonObject }> = [];
for (const [routePath, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    const schema = op.requestBody?.content?.['application/json']?.schema;
    if (schema) bodySchemas.push({ id: `${method.toUpperCase()} ${routePath}`, schema });
  }
}

describe('OpenAPI request bodies are valid JSON Schema', () => {
  it('documents at least the known request-bearing endpoints', () => {
    // Sanity floor: if the spec suddenly lost its bodies (e.g. a generation
    // step wrote an empty file), this fails instead of the suite passing
    // vacuously with zero schemas to compile.
    expect(bodySchemas.length).toBeGreaterThan(50);
  });

  it.each(bodySchemas.map((b) => [b.id, b.schema] as const))(
    '%s compiles under draft-2020-12',
    (_id, schema) => {
      expect(() => ajv.compile(schema)).not.toThrow();
    }
  );
});

describe('request bodies enforce their documented contract', () => {
  const validate = (routePath: string, method: string) => {
    const schema = spec.paths[routePath]?.[method]?.requestBody?.content?.['application/json']?.schema;
    if (!schema) throw new Error(`no request body documented for ${method} ${routePath}`);
    return ajv.compile(schema);
  };

  it('POST /schedules accepts a well-formed body and rejects a missing required field', () => {
    const check = validate('/schedules', 'post');
    expect(
      check({ name: 'July', startDate: '2026-07-01', endDate: '2026-07-31', departmentId: 3 })
    ).toBe(true);
    // departmentId is required — omitting it must fail, matching the route's
    // Zod validation.
    expect(check({ name: 'July', startDate: '2026-07-01', endDate: '2026-07-31' })).toBe(false);
    // Malformed date pattern must fail.
    expect(check({ name: 'July', startDate: 'yesterday', endDate: '2026-07-31', departmentId: 3 })).toBe(
      false
    );
  });

  it('POST /auth/login requires email and password', () => {
    const check = validate('/auth/login', 'post');
    expect(check({ email: 'a@b.com', password: 'secret' })).toBe(true);
    expect(check({ email: 'a@b.com' })).toBe(false);
  });

  it('POST /employees requires the core identity fields', () => {
    const check = validate('/employees', 'post');
    expect(
      check({ email: 'a@b.com', password: 'secret12', firstName: 'A', lastName: 'B' })
    ).toBe(true);
    expect(check({ email: 'a@b.com', password: 'secret12', firstName: 'A' })).toBe(false);
  });
});

/**
 * Every documented query parameter must be backed by a `validateQuery` schema.
 *
 * This is the regression guard for the defect that motivated the mechanism:
 * `parameters` used to be hand-curated prose that nothing compared against the
 * code, so six endpoints published filters their handlers never read — a caller
 * narrowing by `userId` or `isActive` silently received everything. The
 * generator now derives them and refuses to run on a mismatch; this test makes
 * the same guarantee visible in the normal suite, where a developer sees it.
 */
describe('documented query parameters are backed by validateQuery', () => {
  const documented: Array<{ id: string; params: Array<{ name: string; schema?: JsonObject }> }> = [];
  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const query = (op.parameters ?? []).filter((prm) => prm.in === 'query');
      if (query.length > 0) {
        documented.push({
          id: `${method.toUpperCase()} ${routePath}`,
          params: query.map((prm) => ({ name: prm.name, schema: prm.schema })),
        });
      }
    }
  }

  /**
   * Every `*Query` schema the shared package exports, as JSON Schema. A
   * documented parameter must be a property of one of these — that is what
   * "derived from the code" means, and hand-adding a parameter to the spec
   * (the original defect) makes this fail.
   */
  const queryShapes = Object.entries(sharedSchemas as Record<string, unknown>)
    .filter(([name, value]) => name.endsWith('Query') && value instanceof z.ZodType)
    .map(([name, value]) => {
      const json = z.toJSONSchema(value as z.ZodType, { io: 'input' }) as {
        properties?: Record<string, JsonObject>;
      };
      return { name, properties: json.properties ?? {} };
    });

  it('documents query parameters on the endpoints that filter', () => {
    // Sanity floor, so an empty spec cannot make the assertions below vacuous.
    expect(documented.length).toBeGreaterThanOrEqual(20);
    expect(queryShapes.length).toBeGreaterThanOrEqual(15);
  });

  it('every documented parameter comes from a shared query schema', () => {
    const orphans: string[] = [];
    for (const { id, params } of documented) {
      for (const { name } of params) {
        const known = queryShapes.some((shape) => name in shape.properties);
        if (!known) orphans.push(`${id} -> ${name}`);
      }
    }
    expect(orphans).toEqual([]);
  });

  it('every documented parameter carries a schema, so the type is published', () => {
    const untyped = documented.flatMap(({ id, params }) =>
      params.filter((prm) => !prm.schema || Object.keys(prm.schema).length === 0).map((prm) => `${id} -> ${prm.name}`)
    );
    expect(untyped).toEqual([]);
  });

  it('no route reads req.query without a validateQuery on the same file', () => {
    // The inverse direction of the guard above. Without it the contract can
    // still lie — by omission: a handler that reads req.query raw accepts a
    // filter the spec never mentions, so the generated client cannot offer it
    // and the value reaches the service unvalidated (it used to arrive through
    // `req.query.status as never` casts). Six endpoints were in that state.
    const routesDir = path.join(__dirname, '..', 'routes');
    const offenders: string[] = [];
    for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(routesDir, file), 'utf8');
      const reads = [
        ...new Set([
          ...[...source.matchAll(/req\.query\.(\w+)/g)].map((m) => m[1]),
          ...[...source.matchAll(/req\.query\[['"](\w+)/g)].map((m) => m[1]),
        ]),
      ];
      if (reads.length > 0 && !source.includes('validateQuery(')) {
        offenders.push(`${file} -> ${reads.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('wires validateQuery at least once per endpoint that documents filters', () => {
    const routesDir = path.join(__dirname, '..', 'routes');
    const allRouteSource = fs
      .readdirSync(routesDir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(routesDir, f), 'utf8'))
      .join('\n');
    const wired = (allRouteSource.match(/validateQuery\(/g) ?? []).length;
    expect(wired).toBeGreaterThanOrEqual(documented.length);
  });
});

/**
 * The domain components must state what the shared schemas actually declare.
 *
 * They used to be hand-written with nothing comparing them against the types,
 * and had drifted into describing an older model: `User.role` (a field the API
 * has never sent — it is what made the Sidebar render `undefined` until it was
 * removed), `Permission.category`/`key` instead of `code`/`resource`/`action`,
 * `Role.isBuiltin` instead of `isSystem`. A wrong component is worse than a
 * missing one: it produces wrong types in any client generated from it.
 */
describe('domain components match the shared schemas', () => {
  const DOMAIN = {
    Permission: sharedSchemas.permissionSchema,
    Role: sharedSchemas.roleSchema,
    Shift: sharedSchemas.shiftSchema,
    Schedule: sharedSchemas.scheduleSchema,
    User: sharedSchemas.userSchema,
  } as const;

  const componentProps = (name: string): string[] =>
    Object.keys(
      ((spec.components?.schemas?.[name] as { properties?: Record<string, unknown> })?.properties) ?? {}
    ).sort();

  const schemaProps = (schema: z.ZodType): string[] =>
    Object.keys(
      (z.toJSONSchema(schema, {
        io: 'output',
        unrepresentable: 'any',
      }) as { properties?: Record<string, unknown> }).properties ?? {}
    ).sort();

  it.each(Object.keys(DOMAIN))('%s declares exactly the schema\'s fields', (name) => {
    expect(componentProps(name)).toEqual(schemaProps(DOMAIN[name as keyof typeof DOMAIN]));
  });

  it('does not publish User.role, which the API never sends', () => {
    expect(componentProps('User')).not.toContain('role');
  });

  it('publishes the real permission model rather than category/key', () => {
    expect(componentProps('Permission')).toEqual(['action', 'code', 'description', 'id', 'resource']);
  });

  it('renders timestamps as wire strings, never as an unrepresentable Date', () => {
    const date = (spec.components?.schemas?.Shift as {
      properties?: Record<string, { type?: string; format?: string; $ref?: string }>;
    })?.properties?.date;
    expect(date).toEqual({ type: 'string', format: 'date-time' });
    // A $ref here would be a local $defs, which openapi-typescript cannot resolve.
    expect(date?.$ref).toBeUndefined();
  });
});

describe('error-response envelope contract', () => {
  it.each(['Unauthorized', 'Forbidden', 'NotFound', 'ValidationError'])(
    '%s response documents the { code, message } error shape',
    (name) => {
      const component = spec.components?.responses?.[name] as
        | { content?: { 'application/json'?: { schema?: JsonObject } } }
        | undefined;
      // The response documents its schema as a $ref to the shared ApiError
      // component (DRY across every error response); resolve it, then assert
      // the { code, message } shape the frontend depends on.
      const schema = resolveRef(component?.content?.['application/json']?.schema) as {
        properties?: { error?: { properties?: Record<string, unknown> } };
      };
      const errorProps = schema?.properties?.error?.properties;
      expect(errorProps).toBeDefined();
      expect(errorProps).toHaveProperty('code');
      expect(errorProps).toHaveProperty('message');
    }
  );
});
