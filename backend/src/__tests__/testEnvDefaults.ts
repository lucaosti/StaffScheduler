/**
 * The env-var default guard `setup.ts` applies, before `dotenv` loads `.env`.
 *
 * Extracted into its own module, with NO side effects beyond the env-var
 * write itself, so it can be re-required freely from a running test via
 * `jest.isolateModules`. `setup.ts` itself cannot: it also registers a
 * top-level `beforeEach` and `expect.extend`, and Jest Circus refuses to
 * register a hook once test execution has started ("Hooks cannot be defined
 * inside tests"), throwing the instant a re-required `setup.ts` reaches its
 * own `beforeEach(...)` call from inside a running `it()`. Module isolation
 * only sandboxes the `require` cache — it does not sandbox the real, shared
 * Jest Circus globals `beforeEach`/`describe`/`it` that `setup.ts` calls, so
 * there was no way to exercise the guard through the file that actually
 * carries it. This function is the guard, with nothing else attached.
 *
 * @author Luca Ostinelli
 */
export function applyTestEnvDefault(key: string, fallback: string): void {
  if (process.env[key] === undefined) process.env[key] = fallback;
}
