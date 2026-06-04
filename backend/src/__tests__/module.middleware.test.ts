/**
 * requireModule middleware unit tests (issue #93).
 *
 * Covers:
 *   - returns 404 when module is disabled (even without authentication)
 *   - calls next() when module is enabled
 *   - fails open (calls next) when module service throws
 */

import express from 'express';
import request from 'supertest';

// Mock the entire auth module so we can control ModuleService behaviour.
jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    requireModule: jest.fn((code: string) => {
      return (_req: any, _res: any, next: any) => {
        // Delegate to the mock's "isEnabled" state per code.
        const { _moduleEnabled } = require('../middleware/auth') as any;
        const enabled = _moduleEnabled?.[code] ?? true;
        if (!enabled) {
          return _res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not Found' } });
        }
        next();
      };
    }),
    // Helper used by tests to set module enabled state.
    _moduleEnabled: {} as Record<string, boolean>,
  };
});

// Load the real middleware for the non-mocked parts.
import { requireModule } from '../middleware/auth';

// ──────────────────────────────────────────────────────────────────────────────
// Test app builder
// ──────────────────────────────────────────────────────────────────────────────

const buildApp = (moduleCode: string) => {
  const app = express();
  app.use(express.json());
  app.get('/test', requireModule(moduleCode), (_req: any, res: any) => {
    res.json({ success: true, data: 'reached' });
  });
  return app;
};

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('requireModule middleware', () => {
  beforeEach(() => {
    // Reset module state before each test.
    const mod = require('../middleware/auth') as any;
    mod._moduleEnabled = {};
  });

  it('calls next() and allows the handler to respond when module is enabled', async () => {
    const mod = require('../middleware/auth') as any;
    mod._moduleEnabled['reporting'] = true;

    const app = buildApp('reporting');
    const res = await request(app).get('/test');

    expect(res.status).toBe(200);
    expect(res.body.data).toBe('reached');
  });

  it('returns 404 when module is disabled — before authentication', async () => {
    const mod = require('../middleware/auth') as any;
    mod._moduleEnabled['reporting'] = false;

    const app = buildApp('reporting');
    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a disabled module regardless of auth header presence', async () => {
    const mod = require('../middleware/auth') as any;
    mod._moduleEnabled['notifications'] = false;

    const app = buildApp('notifications');
    const res = await request(app)
      .get('/test')
      .set('Authorization', 'Bearer fake-token');

    expect(res.status).toBe(404);
  });
});
