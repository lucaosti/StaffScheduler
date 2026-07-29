#!/usr/bin/env ts-node

/**
 * OpenAPI request-body generator — Zod is the single source of truth.
 *
 * What it does: rewrites every `requestBody` JSON schema — and every `query`
 * parameter — in `backend/openapi/openapi.json` from the Zod schemas each
 * route actually validates with, and fails loudly on any mismatch between the
 * spec and the code.
 *
 * Query parameters were added here after six endpoints were found documenting
 * filters their handlers never read: bodies were generated and drift-checked,
 * parameters were curated prose that nothing verified, so they drifted. Path
 * parameters stay hand-written (they are structural, and `validateParams`
 * schemas carry no descriptions worth publishing); only `in: 'query'` entries
 * are generated, and curated `description` text on them is preserved.
 *
 * The query check runs in BOTH directions, because each catches a defect the
 * other cannot:
 *
 *   - spec documents a query parameter with no `validateQuery` behind it →
 *     the API promises a filter nothing parses (the original defect);
 *   - a handler reads `req.query` with no `validateQuery` on its route →
 *     the API accepts a filter the spec never mentions, so the generated
 *     client cannot offer it and the value reaches the service unvalidated.
 *
 * Together they make the query contract complete: nothing documented is
 * unparsed, and nothing parsed is undocumented.
 *
 * Both directions resolve `$ref` parameters before classifying them. A `$ref`
 * object has no `in` key, so testing `prm.in === 'query'` treats a referenced
 * query parameter as though it were not one — and referenced parameters are
 * the only ones NOT derived from Zod, so they are exactly the ones that need
 * checking. That blind spot let `components.parameters.limitQuery` publish a
 * `limit` filter on six operations no schema accepts, and a duplicate `page`
 * on four, through a generator that reported success. A reusable parameter no
 * operation references now fails too, so the pattern cannot come back.
 *
 * `components.schemas` for the shared domain entities are generated too. They
 * were hand-written and nothing compared them against the types, so they had
 * drifted into describing an older model — `User.role`, a field the API has
 * never sent and which rendered as `undefined` in the UI until it was removed;
 * `Permission.category`/`key` instead of `code`/`resource`/`action`;
 * `Role.isBuiltin` instead of `isSystem`. Entities not yet declared in
 * `domain.ts` keep their hand-written component and are listed on stdout, so
 * the remaining gap is stated rather than silently tolerated. Curated prose (summaries, descriptions, response documentation)
 * stays hand-written in the spec file; the machine-checkable part — what the
 * API accepts — is generated.
 *
 * Why derive the route→schema mapping from the route sources instead of a
 * hand-kept table: a table is one more thing that silently drifts. The
 * router files already declare, per endpoint, which schema `validateBody`
 * enforces; scanning them (with import-alias resolution) means adding or
 * changing an endpoint updates the spec mapping automatically, and the
 * bidirectional check below turns every remaining inconsistency into a CI
 * failure instead of stale documentation:
 *
 *   - an operation documented with a body but with no `validateBody` in code
 *     fails (spec documents something the API does not enforce);
 *   - a `validateBody` in code with no documented operation fails (the API
 *     accepts something the spec does not document).
 *
 * Why `z.toJSONSchema`: Zod 4 emits JSON Schema draft 2020-12 natively,
 * which is exactly what OpenAPI 3.1 embeds — no third-party bridge library
 * to track, `io: 'input'` documents the accepted (pre-transform) shape.
 *
 * Usage: `npm run openapi:generate` (backend workspace). CI regenerates and
 * fails on `git diff` so the committed spec can never drift from the code.
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import * as sharedSchemas from '@staff-scheduler/shared';

const BACKEND = path.join(__dirname, '..');
const SPEC_PATH = path.join(BACKEND, 'openapi', 'openapi.json');

/**
 * Router-variable → mount-prefix table, mirroring src/app.ts. Kept explicit
 * (rather than parsing app.ts) because mounts change rarely and reviewing a
 * ten-line table is easier than trusting a second parser; the bidirectional
 * check still catches any omission the moment a mounted route validates a
 * body.
 *
 * `router` is the conventional variable name; rbac.ts exposes two routers
 * with distinct mounts, listed by their variable names.
 */
const ROUTE_MOUNTS: Array<{ file: string; variable: string; prefix: string }> = [
  { file: 'auth.ts', variable: 'router', prefix: '/auth' },
  { file: 'twoFactor.ts', variable: 'router', prefix: '/auth/2fa' },
  { file: 'users.ts', variable: 'router', prefix: '/users' },
  { file: 'dashboard.ts', variable: 'router', prefix: '/dashboard' },
  { file: 'employees.ts', variable: 'router', prefix: '/employees' },
  { file: 'departments.ts', variable: 'router', prefix: '/departments' },
  { file: 'shifts.ts', variable: 'router', prefix: '/shifts' },
  { file: 'schedules.ts', variable: 'router', prefix: '/schedules' },
  { file: 'assignments.ts', variable: 'router', prefix: '/assignments' },
  { file: 'settings.ts', variable: 'router', prefix: '/settings' },
  { file: 'system.ts', variable: 'router', prefix: '/system' },
  { file: 'timeOff.ts', variable: 'router', prefix: '/time-off' },
  { file: 'attendance.ts', variable: 'router', prefix: '/attendance' },
  { file: 'shiftSwap.ts', variable: 'router', prefix: '/shift-swap' },
  { file: 'preferences.ts', variable: 'router', prefix: '/preferences' },
  { file: 'employmentContracts.ts', variable: 'router', prefix: '/employment-contracts' },
  { file: 'employeePairings.ts', variable: 'router', prefix: '/employee-pairings' },
  { file: 'timeline.ts', variable: 'router', prefix: '/timeline' },
  { file: 'skills.ts', variable: 'router', prefix: '/skills' },
  { file: 'auditLogs.ts', variable: 'router', prefix: '/audit-logs' },
  { file: 'calendar.ts', variable: 'router', prefix: '/calendar' },
  { file: 'onCall.ts', variable: 'router', prefix: '/on-call' },
  { file: 'directory.ts', variable: 'router', prefix: '/directory' },
  { file: 'skillGap.ts', variable: 'router', prefix: '/skill-gap' },
  { file: 'reports.ts', variable: 'router', prefix: '/reports' },
  { file: 'notifications.ts', variable: 'router', prefix: '/notifications' },
  { file: 'bulkImport.ts', variable: 'router', prefix: '/import' },
  { file: 'events.ts', variable: 'router', prefix: '/events' },
  { file: 'org.ts', variable: 'router', prefix: '/org' },
  { file: 'policies.ts', variable: 'router', prefix: '/policies' },
  { file: 'rbac.ts', variable: 'roles', prefix: '/roles' },
  { file: 'rbac.ts', variable: 'permissions', prefix: '/permissions' },
  { file: 'delegations.ts', variable: 'router', prefix: '/delegations' },
  { file: 'approvalWorkflows.ts', variable: 'router', prefix: '/approval-workflows' },
  { file: 'modules.ts', variable: 'router', prefix: '/modules' },
  { file: 'responsibilityRules.ts', variable: 'router', prefix: '/responsibility-rules' },
  { file: 'changeRequests.ts', variable: 'router', prefix: '/change-requests' },
  { file: 'pendingApprovals.ts', variable: 'router', prefix: '/pending-approvals' },
];

interface FoundOp {
  method: string;
  specPath: string;
  /** Schema enforced by validateBody, if any. */
  schemaName?: string;
  /** Schema enforced by validateQuery, if any. */
  querySchemaName?: string;
  /** Query keys the handler reads straight off `req.query`. */
  rawQueryReads: string[];
  source: string;
}

/** Resolves `import { a as b } from '../schemas'` aliases to export names. */
const parseSchemaAliases = (source: string): Map<string, string> => {
  const aliases = new Map<string, string>();
  const importBlock = source.match(/import \{([\s\S]*?)\} from '\.\.\/schemas';/);
  if (!importBlock) return aliases;
  for (const entry of importBlock[1].split(',')) {
    const parts = entry.trim().split(/\s+as\s+/);
    if (parts[0]) aliases.set((parts[1] ?? parts[0]).trim(), parts[0].trim());
  }
  return aliases;
};

const scanRoutes = (): FoundOp[] => {
  const found: FoundOp[] = [];
  for (const { file, variable, prefix } of ROUTE_MOUNTS) {
    const full = path.join(BACKEND, 'src', 'routes', file);
    const source = fs.readFileSync(full, 'utf8');
    const aliases = parseSchemaAliases(source);
    // Handler registrations span lines; the middleware segment is tempered
    // so it can never cross into the NEXT route registration — an untempered
    // lazy [\s\S]*? would otherwise stretch a route that lacks the
    // asyncHandler/async terminator over its successor and swallow that
    // route's validateBody (exactly what happened with /auth/2fa/enable
    // spanning into /disable before this guard existed).
    const re = new RegExp(
      String.raw`${variable}\.(get|post|put|patch|delete)\(\s*'([^']*)'((?:(?!${variable}\.(?:get|post|put|patch|delete)\()[\s\S])*?)(?:asyncHandler|async \()`,
      'g'
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(source))) {
      const [, method, routePath, middlewares] = m;
      const body = middlewares.match(/validateBody\((\w+)\)/);
      const query = middlewares.match(/validateQuery\((\w+)\)/);
      // The handler body reaches to the next registration (or end of file), so
      // a raw req.query read anywhere inside it belongs to this route.
      // Terminate on ANY router variable, not just this one: rbac.ts declares
      // two (`roles` and `permissions`) interleaved, and stopping only at the
      // same variable attributed one router's req.query reads to the other.
      const handlerStart = m.index + m[0].length;
      const nextRe = /\b\w+\.(?:get|post|put|patch|delete)\(\s*'/g;
      nextRe.lastIndex = handlerStart;
      const nextMatch = nextRe.exec(source);
      const handler = source.slice(handlerStart, nextMatch ? nextMatch.index : undefined);
      const rawQueryReads = [
        ...new Set([
          ...[...handler.matchAll(/req\.query\.(\w+)/g)].map((r) => r[1]),
          ...[...handler.matchAll(/req\.query\[['"](\w+)/g)].map((r) => r[1]),
        ]),
      ];
      if (!body && !query && rawQueryReads.length === 0) continue;
      const resolve = (local: string) => aliases.get(local) ?? local;
      const specPath = (prefix + (routePath === '/' ? '' : routePath)).replace(
        /:(\w+)\??/g,
        '{$1}'
      );
      found.push({
        method,
        specPath,
        schemaName: body ? resolve(body[1]) : undefined,
        querySchemaName: query ? resolve(query[1]) : undefined,
        rawQueryReads,
        source: `${file} ${variable}.${method}('${routePath}')`,
      });
    }
  }
  return found;
};

/**
 * Domain entities whose OpenAPI component is generated from the shared Zod
 * schema. Adding an entity to `domain.ts` and to this map is what moves it
 * from hand-written to derived.
 */
const DOMAIN_COMPONENTS: Record<string, z.ZodType> = {
  Permission: sharedSchemas.permissionSchema,
  Role: sharedSchemas.roleSchema,
  Shift: sharedSchemas.shiftSchema,
  Schedule: sharedSchemas.scheduleSchema,
  User: sharedSchemas.userSchema,
  Department: sharedSchemas.departmentSchema,
  Policy: sharedSchemas.policySchema,
  TimeOffRequest: sharedSchemas.timeOffRequestSchema,
  OrgUnit: sharedSchemas.orgUnitSchema,
  ShiftSwapRequest: sharedSchemas.shiftSwapRequestSchema,
  AuditLogEntry: sharedSchemas.auditLogEntrySchema,
  Assignment: sharedSchemas.shiftAssignmentSchema,
  PaginationMeta: sharedSchemas.paginationMetaSchema,
};

const main = (): void => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const ops = scanRoutes();

  const errors: string[] = [];
  const generatedFor = new Set<string>();

  const generatedQueryFor = new Set<string>();

  /**
   * The `in` of a parameter, following a `$ref` into `components.parameters`.
   *
   * Why this indirection matters: a `$ref` object carries only `$ref`, so the
   * obvious `prm.in === 'query'` test reads `undefined` and silently classifies
   * a referenced query parameter as "not a query parameter". Both checks below
   * used to do exactly that, which is how `pageQuery`/`limitQuery` published a
   * `limit` filter on six operations that no Zod schema has ever accepted — and
   * a second, duplicate `page` on four of them — while the generator reported a
   * clean run. Referenced parameters are the only ones not derived from Zod, so
   * they are precisely the ones that must be resolved rather than skipped.
   */
  const parameterIn = (prm: Record<string, unknown>): string | undefined => {
    const ref = prm.$ref;
    if (typeof ref !== 'string') return prm.in as string | undefined;
    const name = ref.replace('#/components/parameters/', '');
    const target = ((spec.components as Record<string, Record<string, Record<string, unknown>>>)
      ?.parameters ?? {})[name];
    if (!target) {
      errors.push(`spec references '${ref}', which components.parameters does not define`);
      return undefined;
    }
    return target.in as string | undefined;
  };

  const resolveSchema = (name: string, kind: string, op: FoundOp): z.ZodType | null => {
    const schema = (sharedSchemas as Record<string, unknown>)[name];
    if (!(schema instanceof z.ZodType)) {
      errors.push(`${op.source}: ${kind} schema '${name}' is not exported by @staff-scheduler/shared`);
      return null;
    }
    return schema;
  };

  for (const op of ops) {
    const pathItem = spec.paths[op.specPath];
    const operation = pathItem?.[op.method];
    if (!operation) {
      errors.push(`${op.source}: no OpenAPI operation for '${op.method} ${op.specPath}' — document the endpoint`);
      continue;
    }

    if (op.schemaName) {
      const schema = resolveSchema(op.schemaName, 'validateBody', op);
      if (schema) {
        const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown> & {
          required?: string[];
        };
        delete jsonSchema.$schema; // OpenAPI 3.1 sets the dialect document-wide.
        // A body whose properties are all optional must not itself be
        // required, or every caller is forced to send `{}` — which is what
        // happened when the free-text audit `reason`/`justification` fields
        // moved from raw req.body reads into validateBody schemas.
        const bodyRequired = (jsonSchema.required ?? []).length > 0;
        operation.requestBody = {
          required: bodyRequired,
          content: { 'application/json': { schema: jsonSchema } },
        };
        generatedFor.add(`${op.method} ${op.specPath}`);
      }
    }

    if (op.querySchemaName) {
      const schema = resolveSchema(op.querySchemaName, 'validateQuery', op);
      if (schema) {
        const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as {
          properties?: Record<string, Record<string, unknown>>;
          required?: string[];
        };
        // Curated descriptions are the one part of a parameter worth writing by
        // hand, so they survive regeneration; everything else is derived.
        const existing = new Map<string, string>(
          ((operation.parameters ?? []) as Array<Record<string, unknown>>)
            .filter((prm) => prm.in === 'query' && typeof prm.description === 'string')
            .map((prm) => [prm.name as string, prm.description as string])
        );
        const nonQuery = ((operation.parameters ?? []) as Array<Record<string, unknown>>)
          .filter((prm) => parameterIn(prm) !== 'query');
        const required = new Set(jsonSchema.required ?? []);
        const queryParams = Object.entries(jsonSchema.properties ?? {}).map(([name, propSchema]) => {
          const { description, ...rest } = propSchema as { description?: string };
          const param: Record<string, unknown> = { name, in: 'query' };
          const text = existing.get(name) ?? description;
          if (text) param.description = text;
          if (required.has(name)) param.required = true;
          param.schema = rest;
          return param;
        });
        operation.parameters = [...nonQuery, ...queryParams];
        generatedQueryFor.add(`${op.method} ${op.specPath}`);
      }
    }
  }

  for (const op of ops) {
    if (op.querySchemaName || op.rawQueryReads.length === 0) continue;
    errors.push(
      `${op.source}: reads req.query (${op.rawQueryReads.join(', ')}) with no validateQuery — ` +
        'the API accepts filters the spec never documents; declare a query schema in @staff-scheduler/shared'
    );
  }

  type SpecOperation = { requestBody?: unknown; parameters?: Array<Record<string, unknown>> };
  for (const [specPath, methods] of Object.entries(spec.paths as Record<string, Record<string, SpecOperation>>)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation?.requestBody && !generatedFor.has(`${method} ${specPath}`)) {
        errors.push(
          `spec documents a request body for '${method} ${specPath}' but no route validates one — remove it from the spec or add validateBody`
        );
      }
      // The check that would have caught the original defect: a documented
      // query parameter with no validateQuery behind it means the spec
      // promises a filter nothing parses.
      const hasQueryParams = (operation?.parameters ?? []).some((prm) => parameterIn(prm) === 'query');
      if (hasQueryParams && !generatedQueryFor.has(`${method} ${specPath}`)) {
        errors.push(
          `spec documents query parameters for '${method} ${specPath}' but no route validates them — remove them from the spec or add validateQuery`
        );
      }
    }
  }

  // A reusable parameter nothing references is a contract statement with no
  // operation behind it. `pageQuery`/`limitQuery` outlived the hand-written
  // parameters they were factored out of; keeping them around would let the
  // same phantom filter be re-attached to a future operation.
  {
    const referenced = new Set<string>();
    for (const methods of Object.values(spec.paths as Record<string, Record<string, SpecOperation>>)) {
      for (const operation of Object.values(methods)) {
        for (const prm of operation?.parameters ?? []) {
          if (typeof prm.$ref === 'string') referenced.add(prm.$ref.replace('#/components/parameters/', ''));
        }
      }
    }
    const declared = Object.keys(
      ((spec.components as Record<string, Record<string, unknown>>)?.parameters ?? {}) as Record<string, unknown>
    );
    for (const name of declared) {
      if (!referenced.has(name)) {
        errors.push(
          `components.parameters.${name} is referenced by no operation — remove it rather than leaving a reusable phantom`
        );
      }
    }
  }

  // ---- components.schemas from the shared domain schemas ----
  const components = (spec.components ??= {});
  const schemas = (components.schemas ??= {} as Record<string, unknown>);
  for (const [name, schema] of Object.entries(DOMAIN_COMPONENTS)) {
    if (!(name in schemas)) {
      errors.push(`domain schema '${name}' has no component in the spec — document the entity`);
      continue;
    }
    const jsonSchema = z.toJSONSchema(schema, {
      io: 'output',
      // `Date` has no JSON Schema form. Every occurrence here is the shared
      // `timestamp` union, whose wire representation is always a string; the
      // marker on that schema says so, and this replaces the node with it.
      unrepresentable: 'any',
      override: (ctx) => {
        const meta = (ctx.zodSchema as { meta?: () => Record<string, unknown> | undefined }).meta?.();
        if (meta?.wireFormat === 'timestamp') {
          for (const key of Object.keys(ctx.jsonSchema)) delete (ctx.jsonSchema as Record<string, unknown>)[key];
          Object.assign(ctx.jsonSchema, sharedSchemas.TIMESTAMP_JSON_SCHEMA);
        }
      },
    }) as Record<string, unknown>;
    delete jsonSchema.$schema;
    schemas[name] = jsonSchema;
  }

  // Entities still hand-written: stated, not silently tolerated, so the
  // remaining surface is visible in every generation run.
  const handWritten = Object.keys(schemas)
    .filter((name) => !(name in DOMAIN_COMPONENTS))
    .sort();

  if (errors.length > 0) {
    console.error(`openapi generation failed with ${errors.length} contract mismatch(es):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2) + '\n');
  console.log(
    `openapi.json regenerated: ${generatedFor.size} request bodies, ` +
      `${generatedQueryFor.size} query contracts and ` +
      `${Object.keys(DOMAIN_COMPONENTS).length} domain components from shared Zod schemas`
  );
  if (handWritten.length > 0) {
    console.log(
      `  still hand-written (not yet in domain.ts): ${handWritten.join(', ')}`
    );
  }
};

main();
