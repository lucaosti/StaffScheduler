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
 * are generated, and curated `description` text on them is preserved. Curated prose (summaries, descriptions, response documentation)
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
      if (!body && !query) continue;
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
        source: `${file} ${variable}.${method}('${routePath}')`,
      });
    }
  }
  return found;
};

const main = (): void => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  const ops = scanRoutes();

  const errors: string[] = [];
  const generatedFor = new Set<string>();

  const generatedQueryFor = new Set<string>();

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
        const jsonSchema = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;
        delete jsonSchema.$schema; // OpenAPI 3.1 sets the dialect document-wide.
        operation.requestBody = {
          required: true,
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
          .filter((prm) => prm.in !== 'query');
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

  type SpecOperation = { requestBody?: unknown; parameters?: Array<{ in?: string }> };
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
      const hasQueryParams = (operation?.parameters ?? []).some((prm) => prm?.in === 'query');
      if (hasQueryParams && !generatedQueryFor.has(`${method} ${specPath}`)) {
        errors.push(
          `spec documents query parameters for '${method} ${specPath}' but no route validates them — remove them from the spec or add validateQuery`
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error(`openapi generation failed with ${errors.length} contract mismatch(es):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }

  fs.writeFileSync(SPEC_PATH, JSON.stringify(spec, null, 2) + '\n');
  console.log(
    `openapi.json regenerated: ${generatedFor.size} request bodies and ` +
      `${generatedQueryFor.size} query contracts from shared Zod schemas`
  );
};

main();
