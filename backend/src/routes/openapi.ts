/**
 * OpenAPI / Swagger UI route (F17).
 *
 * Serves the OpenAPI 3.1 document and a Swagger UI page that loads it. The spec
 * lives at `backend/openapi/openapi.json`; its request bodies are GENERATED from
 * the shared Zod schemas (`npm run openapi:generate`, CI fails on drift) and only
 * the curated prose — summaries and response descriptions — is edited by hand.
 *
 * WHY THE ASSETS ARE SERVED LOCALLY: this page used to pull Swagger UI from the
 * public unpkg CDN, which forced a per-route CSP override allowing an external
 * script origin plus `'unsafe-inline'` — on an endpoint that is unauthenticated
 * and reachable in production. That meant an unauthenticated visitor executed
 * third-party JavaScript on the application's own origin, with no Subresource
 * Integrity, so a compromise of that package version (or of the CDN) would have
 * run arbitrary code in our security context.
 *
 * Serving `swagger-ui-dist` from our own origin removes all three problems at
 * once: no external origin, no CDN trust, and — because the bootstrap script is
 * a served file rather than an inline `<script>` — no `'unsafe-inline'` either.
 * The page therefore runs under the strict global helmet CSP (`script-src
 * 'self'`) with no override whatsoever.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';
import express, { Router, Request, Response } from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { logger } from '../config/logger';

const SPEC_PATH = path.join(__dirname, '..', '..', 'openapi', 'openapi.json');

/**
 * Swagger UI bootstrap, served as a file (not inlined) so the page needs no
 * `'unsafe-inline'` relaxation of the CSP.
 */
const SWAGGER_INIT_JS = `window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '../openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    layout: 'BaseLayout',
  });
};`;

/**
 * Asset URLs are relative to `/docs`, so the page works under every prefix the
 * router is mounted on (`/api/docs` and `/api/v1/docs`) without knowing its own.
 */
const swaggerHtml = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Staff Scheduler API</title>
  <link rel="stylesheet" href="docs-assets/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="docs-assets/swagger-ui-bundle.js"></script>
  <script src="docs-assets/swagger-init.js"></script>
</body>
</html>`;

let cachedSpec: unknown | null = null;

const loadSpec = (): unknown => {
  if (cachedSpec) return cachedSpec;
  try {
    const raw = fs.readFileSync(SPEC_PATH, 'utf8');
    cachedSpec = JSON.parse(raw);
    return cachedSpec;
  } catch (err) {
    logger.error(`Failed to load OpenAPI spec from ${SPEC_PATH}`, err);
    return { openapi: '3.1.0', info: { title: 'Staff Scheduler API', version: '0.0.0' }, paths: {} };
  }
};

export const createOpenApiRouter = (): Router => {
  const router = Router();

  router.get('/openapi.json', (_req: Request, res: Response) => {
    res.json(loadSpec());
  });

  // The bootstrap script must be declared before the static handler so it is not
  // shadowed by a same-named file inside the package.
  router.get('/docs-assets/swagger-init.js', (_req: Request, res: Response) => {
    res.type('application/javascript').send(SWAGGER_INIT_JS);
  });

  // Swagger UI's own CSS/JS, served from our origin. `index: false` keeps the
  // package's bundled index.html (which points at petstore) unreachable.
  router.use('/docs-assets', express.static(getAbsoluteFSPath(), { index: false }));

  // No CSP override: every asset is same-origin and no script is inline, so the
  // strict global policy applies here too.
  router.get('/docs', (_req: Request, res: Response) => {
    res.type('text/html').send(swaggerHtml());
  });

  return router;
};
