/**
 * The env-var defaults `setup.ts` applies before `dotenv` loads `.env`.
 *
 * The property under test, for both `REDIS_ENABLED` (already relied on
 * elsewhere) and `EMAIL_USER`/`EMAIL_PASSWORD` (added for #394): `dotenv`
 * never overwrites an already-set environment variable, so these defaults
 * only do their job — keeping a developer's local `.env` from leaking real
 * credentials into a test run — if they equally never override a value
 * someone (the shell, CI, or a suite that opts in) set on purpose. A test
 * that only checked "unset becomes the default" would miss exactly the
 * regression that matters: an unconditional assignment silently blanking out
 * every suite that depends on setting these for real.
 *
 * `applyTestEnvDefault` is tested directly, via a neutral probe key rather
 * than the real `REDIS_ENABLED`/`EMAIL_USER`/`EMAIL_PASSWORD`, so this file
 * cannot itself interfere with whatever those suites depend on. See
 * `testEnvDefaults.ts` for why `setup.ts` itself cannot be re-required
 * mid-test to exercise this the more direct way.
 *
 * @author Luca Ostinelli
 */

export {};

const load = () => {
  let mod!: typeof import('./testEnvDefaults');
  jest.isolateModules(() => {
    mod = require('./testEnvDefaults');
  });
  return mod;
};

describe('applyTestEnvDefault', () => {
  const KEY = 'TEST_ENV_DEFAULT_PROBE';
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it('sets an unset variable to the given fallback', () => {
    delete process.env[KEY];
    const { applyTestEnvDefault } = load();

    applyTestEnvDefault(KEY, 'fallback-value');

    expect(process.env[KEY]).toBe('fallback-value');
  });

  it('never overrides an already-set variable', () => {
    process.env[KEY] = 'set-on-purpose';
    const { applyTestEnvDefault } = load();

    applyTestEnvDefault(KEY, 'fallback-value');

    expect(process.env[KEY]).toBe('set-on-purpose');
  });

  /**
   * `=== undefined` is the deliberate check, not a truthiness check: an
   * explicit empty string is a value someone set (or a previous call to this
   * same function already normalised to), and treating it as "unset" would
   * make the guard non-idempotent — a second call could re-widen a value the
   * first call had already narrowed.
   */
  it('treats an explicit empty string as already set, not as unset', () => {
    process.env[KEY] = '';
    const { applyTestEnvDefault } = load();

    applyTestEnvDefault(KEY, 'fallback-value');

    expect(process.env[KEY]).toBe('');
  });
});

describe('setup.ts, in this real test run', () => {
  /**
   * Not a re-execution of setup.ts (impossible mid-test — see
   * testEnvDefaults.ts's header) but a check on its EFFECT: Jest's
   * setupFilesAfterEnv always runs setup.ts once before any test in any file
   * executes, so by the time this test body runs, all three of these must
   * already be defined strings — either a real value from the environment, or
   * the default applyTestEnvDefault set. Never undefined either way.
   */
  it('has already defaulted REDIS_ENABLED, EMAIL_USER and EMAIL_PASSWORD', () => {
    expect(typeof process.env.REDIS_ENABLED).toBe('string');
    expect(typeof process.env.EMAIL_USER).toBe('string');
    expect(typeof process.env.EMAIL_PASSWORD).toBe('string');
  });
});
