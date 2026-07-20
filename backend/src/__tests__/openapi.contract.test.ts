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

interface JsonObject {
  [key: string]: unknown;
}

const spec = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'openapi', 'openapi.json'), 'utf8')
) as {
  paths: Record<string, Record<string, { requestBody?: { content?: { 'application/json'?: { schema?: JsonObject } } } }>>;
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
