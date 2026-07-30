/**
 * Which org units a person may see people in.
 *
 * Extracted because the timeline and the aggregate calendar feed ask the same
 * question, and two copies of a disclosure rule diverge asymmetrically: the
 * over-permissive copy publishes people's movements to someone who should not
 * have them, and nothing fails or logs when it does.
 *
 * The case that matters is the `…read_all` one. It lifts the MEMBERSHIP bound
 * and must not lift the role scope, or a manager scoped to one ward sees every
 * other ward's people — an exception to how every other permission in this
 * system narrows, and one nobody would expect to find.
 *
 * @author Luca Ostinelli
 */

import { resolveVisibleOrgUnits } from '../services/orgScope';

export {};

const getUserOrgUnitSubtreeIds = jest.fn();
const rbac = { getUserOrgUnitSubtreeIds } as never;

const input = (over: Record<string, unknown> = {}) => ({
  userId: 1,
  permissions: ['timeline.read'],
  allowedOrgUnitIds: null,
  allPermission: 'timeline.read_all',
  ...over,
}) as Parameters<typeof resolveVisibleOrgUnits>[1];

beforeEach(() => {
  jest.clearAllMocks();
  getUserOrgUnitSubtreeIds.mockResolvedValue([3, 4]);
});

describe('without the read_all code', () => {
  it('is the subtree of the units the person belongs to', async () => {
    expect(await resolveVisibleOrgUnits(rbac, input())).toEqual([3, 4]);
    expect(getUserOrgUnitSubtreeIds).toHaveBeenCalledWith(1);
  });

  it('intersects that with the role scope', async () => {
    const result = await resolveVisibleOrgUnits(rbac, input({ allowedOrgUnitIds: [4, 5] }));
    expect(result).toEqual([4]);
  });

  it('yields an empty array — not null — when the two do not overlap', async () => {
    // Empty means "sees nobody" and null means "unrestricted"; a caller that
    // conflated them would turn a total restriction into no restriction.
    const result = await resolveVisibleOrgUnits(rbac, input({ allowedOrgUnitIds: [9] }));
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it('sees nobody when they belong to nothing', async () => {
    getUserOrgUnitSubtreeIds.mockResolvedValue([]);
    expect(await resolveVisibleOrgUnits(rbac, input())).toEqual([]);
  });
});

describe('with the read_all code', () => {
  it('lifts the membership bound entirely', async () => {
    const result = await resolveVisibleOrgUnits(
      rbac,
      input({ permissions: ['timeline.read_all'], allowedOrgUnitIds: null })
    );

    // A planner is not limited to the ward they happen to belong to.
    expect(result).toBeNull();
    expect(getUserOrgUnitSubtreeIds).not.toHaveBeenCalled();
  });

  it('does NOT lift the role scope', async () => {
    const result = await resolveVisibleOrgUnits(
      rbac,
      input({ permissions: ['timeline.read_all'], allowedOrgUnitIds: [9] })
    );

    // The whole reason this function exists in one place.
    expect(result).toEqual([9]);
  });
});

describe('the all-permission is a parameter', () => {
  it('so a second feature can bound the same way with its own code', async () => {
    const result = await resolveVisibleOrgUnits(
      rbac,
      input({ permissions: ['report.read_all'], allPermission: 'report.read_all' })
    );
    expect(result).toBeNull();
  });

  it('and a code that merely looks similar does not lift anything', async () => {
    const result = await resolveVisibleOrgUnits(
      rbac,
      input({ permissions: ['timeline.read'], allPermission: 'timeline.read_all' })
    );
    expect(result).toEqual([3, 4]);
  });
});
