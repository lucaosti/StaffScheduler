/**
 * buildApp() must wire `config.server.trustProxyHops` into Express's own
 * `trust proxy` setting — the setting that decides whether `req.ip` reflects
 * `X-Forwarded-For` (the real client, behind the documented nginx load
 * balancer) or the immediate TCP peer (the load balancer itself). Getting
 * this wrong either collapses IP-keyed rate limiting into one shared bucket
 * for every caller behind the LB (unset), or lets a directly-exposed
 * instance be tricked into trusting a header the caller controls (set
 * unconditionally). See #558.
 *
 * Asserted via Express's own `app.get('trust proxy')` introspection rather
 * than a probe route: `buildApp` mounts a catch-all 404 handler as the last
 * middleware, so any route added to the returned app after the fact would
 * never be reached — the setting itself is the correct, direct seam.
 *
 * @author Luca Ostinelli
 */

export {};

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../config/database', () => ({
  __esModule: true,
  default: { isHealthy: jest.fn().mockResolvedValue(true), getPool: jest.fn() },
  database: { isHealthy: jest.fn().mockResolvedValue(true), getPool: jest.fn() },
}));

const ENV_KEYS = ['TRUST_PROXY_HOPS', 'NODE_ENV'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const fakePool = {
  execute: jest.fn().mockResolvedValue([[], null]),
  getConnection: jest.fn(),
} as never;

/**
 * Loads config and app fresh in one isolated module registry, so the env
 * vars set here are what `config/index.ts` sees at its own import time —
 * mirroring config.test.ts's `loadConfig` helper, extended to also grab the
 * Express app `buildApp` produces from that config.
 */
const buildAppWithEnv = (env: Record<string, string>, options: { silent?: boolean } = { silent: true }) => {
  Object.assign(process.env, env);
  let app: import('express').Express | undefined;
  jest.isolateModules(() => {
    const { buildApp } = require('../app');
    app = buildApp(fakePool, options);
  });
  return app!;
};

describe('buildApp trust-proxy wiring', () => {
  it('leaves Express trusting nothing by default (no TRUST_PROXY_HOPS set)', () => {
    const app = buildAppWithEnv({});
    expect(app.get('trust proxy')).toBe(false);
  });

  it('leaves Express trusting nothing when TRUST_PROXY_HOPS=0', () => {
    const app = buildAppWithEnv({ TRUST_PROXY_HOPS: '0' });
    expect(app.get('trust proxy')).toBe(false);
  });

  it('trusts exactly one hop when TRUST_PROXY_HOPS=1', () => {
    const app = buildAppWithEnv({ TRUST_PROXY_HOPS: '1' });
    expect(app.get('trust proxy')).toBe(1);
  });

  it('trusts N hops for an arbitrary configured value', () => {
    const app = buildAppWithEnv({ TRUST_PROXY_HOPS: '3' });
    expect(app.get('trust proxy')).toBe(3);
  });
});

/**
 * The practical effect: does the global, IP-keyed rate limiter (mounted at
 * app.ts's `createRateLimiter`, only wired when NOT built with
 * `{ silent: true }`) actually charge two different clients to two different
 * buckets once trust proxy is on, and to the SAME bucket when it's off — the
 * exact defect #558 describes. Read through the `RateLimit-Remaining`
 * response header on an unauthenticated endpoint (`/api/health`) rather than
 * inspecting `req.ip` directly, so this exercises the real request pipeline
 * end to end instead of re-asserting Express's own documented trust-proxy
 * contract.
 */
describe('the global rate limiter, keyed correctly or not depending on trust proxy', () => {
  it('charges every caller to the SAME IP bucket when trust proxy is off, regardless of X-Forwarded-For', async () => {
    const request = require('supertest');
    const app = buildAppWithEnv({}, { silent: false });

    const first = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.1');
    const second = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.2');

    const firstRemaining = Number(first.headers['ratelimit-remaining']);
    const secondRemaining = Number(second.headers['ratelimit-remaining']);
    expect(secondRemaining).toBe(firstRemaining - 1);
  });

  it('charges each forwarded client to its OWN bucket when trust proxy is on', async () => {
    const request = require('supertest');
    const app = buildAppWithEnv({ TRUST_PROXY_HOPS: '1' }, { silent: false });

    const first = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.1');
    const second = await request(app).get('/api/health').set('X-Forwarded-For', '203.0.113.2');

    const firstRemaining = Number(first.headers['ratelimit-remaining']);
    const secondRemaining = Number(second.headers['ratelimit-remaining']);
    expect(secondRemaining).toBe(firstRemaining);
  });
});
