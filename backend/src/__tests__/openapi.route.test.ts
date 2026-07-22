/**
 * OpenAPI route tests (F17).
 */

import express from 'express';
import request from 'supertest';
import { createOpenApiRouter } from '../routes/openapi';

const buildApp = (): express.Express => {
  const app = express();
  app.use('/api', createOpenApiRouter());
  return app;
};

describe('GET /api/openapi.json', () => {
  it('serves a valid OpenAPI 3 document with paths and bearer security', async () => {
    const res = await request(buildApp()).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('Staff Scheduler API');
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(5);
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });
});

describe('GET /api/docs', () => {
  it('serves a Swagger UI HTML page whose assets are all same-origin', async () => {
    const res = await request(buildApp()).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('docs-assets/swagger-ui-bundle.js');
    expect(res.text).toContain('docs-assets/swagger-ui.css');
  });

  it('loads nothing from a third-party CDN and inlines no script', async () => {
    const res = await request(buildApp()).get('/api/docs');
    // The page previously pulled Swagger UI from unpkg, which forced a relaxed
    // CSP on an unauthenticated endpoint. Both must stay gone.
    expect(res.text).not.toMatch(/unpkg\.com|cdn\.jsdelivr|cdnjs/);
    // The only <script> tags are src= references — no inline bootstrap.
    const inlineScript = /<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?<\/script>/.test(res.text);
    expect(inlineScript).toBe(false);
  });

  it('does not relax the Content-Security-Policy for this route', async () => {
    const res = await request(buildApp()).get('/api/docs');
    const csp = res.headers['content-security-policy'] ?? '';
    expect(csp).not.toMatch(/unpkg\.com/);
    expect(csp).not.toMatch(/unsafe-inline/);
  });

  it('serves the bootstrap script and the Swagger UI assets from our origin', async () => {
    const app = buildApp();

    const init = await request(app).get('/api/docs-assets/swagger-init.js');
    expect(init.status).toBe(200);
    expect(init.headers['content-type']).toMatch(/javascript/);
    expect(init.text).toContain('SwaggerUIBundle');
    expect(init.text).toContain("url: '../openapi.json'");

    const css = await request(app).get('/api/docs-assets/swagger-ui.css');
    expect(css.status).toBe(200);
  });
});
