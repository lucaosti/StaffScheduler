/**
 * OpenAPI / Swagger UI route (F17).
 *
 * Serves a hand-maintained OpenAPI 3.1 document and a static Swagger UI page
 * that loads it. Spec lives at `backend/openapi/openapi.json`; the HTML page
 * pulls Swagger UI from the public CDN so we don't add a dependency.
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

  router.get('/docs', (_req: Request, res: Response) => {
    res.type('text/html').send(swaggerHtml());
  });

  return router;
};
