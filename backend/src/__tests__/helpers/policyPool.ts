/**
 * A fake pool for route tests whose services are mocked but whose routes carry
 * `accessScope` guards: those guards read the row's org units and owner
 * through `AccessPolicy`, which is the one query left on the pool.
 *
 * `row(owner, units)` sets what the next resolutions return; `missing()` makes
 * the row not exist. Call them inside each test — `restoreMocks` clears
 * implementations between tests.
 *
 * @author Luca Ostinelli
 */

export const policyPool = () => {
  const execute = jest.fn();
  return {
    pool: { execute } as never,
    execute,
    row: (owner: number | null, units: Array<number | null> = [null]) =>
      execute.mockResolvedValue([units.map((unit) => ({ unit, owner })), null]),
    missing: () => execute.mockResolvedValue([[], null]),
  };
};
