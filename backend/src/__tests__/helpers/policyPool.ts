/**
 * A fake pool for route tests whose services are mocked but whose routes carry
 * `accessScope` guards: those guards read the row's org units and owner
 * through `AccessPolicy`, which is the one query left on the pool.
 *
 * `row(owner, units)` makes every id asked about resolve to that owner and
 * those units; `missing()` makes no row exist. Call them inside each test —
 * `restoreMocks` clears implementations between tests.
 *
 * @author Luca Ostinelli
 */

export const policyPool = () => {
  const execute = jest.fn();
  return {
    pool: { execute } as never,
    execute,
    row: (owner: number | null, units: Array<number | null> = [null]) =>
      execute.mockImplementation(async (_sql: string, ids: number[]) => [
        ids.flatMap((id) => units.map((unit) => ({ id, unit, owner }))),
        null,
      ]),
    missing: () => execute.mockResolvedValue([[], null]),
  };
};
