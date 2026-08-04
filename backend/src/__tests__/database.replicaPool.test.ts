/**
 * createReadPool (#323) — the read-replica pool-selection seam.
 *
 * Both the config module and mysql2's createPool must be loaded fresh per
 * test since `createReadPool` reads `config.database.replicaHost` at call
 * time and the config module itself snapshots env vars at import time.
 */

export {};

jest.mock('dotenv', () => ({ config: jest.fn() }));

const ENV_KEYS = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_POOL_LIMIT', 'DB_QUEUE_LIMIT',
  'DB_REPLICA_HOST', 'DB_REPLICA_PORT', 'DB_REPLICA_NAME', 'DB_REPLICA_USER', 'DB_REPLICA_PASSWORD',
  'DB_REPLICA_POOL_LIMIT',
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const loadCreateReadPool = (
  env: Record<string, string>
): { createReadPool: typeof import('../config/database').createReadPool; mysql: { createPool: jest.Mock } } => {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  let result!: { createReadPool: typeof import('../config/database').createReadPool; mysql: { createPool: jest.Mock } };
  jest.isolateModules(() => {
    // Required INSIDE the same isolated registry as config/database.ts, so
    // both resolve the SAME mocked module instance — requiring it from the
    // outer (restored) registry after isolateModules returns would resolve a
    // second, unrelated instance of the mock factory.
    const mysql = require('mysql2/promise');
    const createReadPool = require('../config/database').createReadPool;
    result = { createReadPool, mysql };
  });
  return result;
};

describe('createReadPool', () => {
  it('returns the same pool object when no replica host is configured', () => {
    const { createReadPool } = loadCreateReadPool({});
    const primaryPool = {} as never;

    expect(createReadPool(primaryPool)).toBe(primaryPool);
  });

  it('creates a distinct pool from the replica settings when a replica host is configured', () => {
    jest.doMock('mysql2/promise', () => ({
      createPool: jest.fn(() => ({ replica: true })),
    }));
    const { createReadPool, mysql } = loadCreateReadPool({
      DB_HOST: 'primary-host', DB_PORT: '3306', DB_USER: 'primary-user',
      DB_PASSWORD: 'primary-pass', DB_NAME: 'primary-db',
      DB_REPLICA_HOST: 'replica-host', DB_REPLICA_PORT: '3307',
      DB_REPLICA_USER: 'replica-user', DB_REPLICA_PASSWORD: 'replica-pass',
      DB_REPLICA_NAME: 'replica-db', DB_REPLICA_POOL_LIMIT: '7',
    });
    const primaryPool = {} as never;

    const readPool = createReadPool(primaryPool);

    expect(readPool).not.toBe(primaryPool);
    expect(mysql.createPool).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'replica-host',
        port: 3307,
        user: 'replica-user',
        password: 'replica-pass',
        database: 'replica-db',
        connectionLimit: 7,
      })
    );
    jest.dontMock('mysql2/promise');
  });
});
