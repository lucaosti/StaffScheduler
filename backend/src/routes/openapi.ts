/**
 * OpenAPI / Swagger UI route (F17).
 *
 * Serves the OpenAPI 3.1 document and a static Swagger UI page that loads it.
 * The spec lives at `backend/openapi/openapi.json`; its request bodies are
 * GENERATED from the shared Zod schemas (`npm run openapi:generate`, CI fails on
 * drift) and only the curated prose — summaries and response descriptions — is
 * edited by hand. The HTML page pulls Swagger UI from the public unpkg CDN so we
 * don't add a dependency; see the scoped CSP override below.
 *
 * @author Luca Ostinelli
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router, Request, Response } from 'express';
import { logger } from '../config/logger';

const SPEC_PATH = path.join(__dirname, '..', '..', 'openapi', 'openapi.json');

const swaggerHtml = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Staff Scheduler API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/api/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        layout: 'BaseLayout',
      });
    };
  </script>
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

  // The global helmet CSP restricts scripts/styles to 'self', but the Swagger UI
  // page loads its assets from the unpkg CDN. Override the CSP for this one route
  // so the UI actually renders without blocking the required CDN resources.
  router.get('/docs', (_req: Request, res: Response) => {
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://unpkg.com 'unsafe-inline'",
        "style-src 'self' https://unpkg.com 'unsafe-inline'",
        "img-src 'self' data: https://unpkg.com",
        "connect-src 'self'",
        "font-src 'self' https://unpkg.com",
      ].join('; ')
    );
    res.type('text/html').send(swaggerHtml());
  });

  return router;
};
