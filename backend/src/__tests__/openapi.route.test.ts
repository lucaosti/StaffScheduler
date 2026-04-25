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
  it('serves a Swagger UI HTML page that points at /api/openapi.json', async () => {
    const res = await request(buildApp()).get('/api/docs');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain("url: '/api/openapi.json'");
    expect(res.text).toContain('SwaggerUIBundle');
  });
});
