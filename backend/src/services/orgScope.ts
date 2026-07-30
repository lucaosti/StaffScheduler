/**
 * Which org units a person may see PEOPLE in.
 *
 * WHY THIS IS ONE FUNCTION. The timeline answered this question inline, and the
 * aggregate calendar feed asks exactly the same one — who may see when a named
 * colleague is at work. Two copies of a disclosure rule is how they come to
 * differ, and the direction they differ in is not symmetric: an over-permissive
 * copy publishes people's movements to someone who should not have them, and
 * nothing fails or logs when it does.
 *
 * THE RULE, AND THE PART THAT IS EASY TO GET WRONG. Two permissions bound the
 * answer and they bound DIFFERENT things:
 *
 *  - the role scope (`allowedOrgUnitIds`, NULL meaning unrestricted) always
 *    binds;
 *  - the `…read_all` code lifts only the MEMBERSHIP bound — a planner is not
 *    limited to the ward they happen to belong to.
 *
 * It must NOT also lift the role scope, or a manager scoped to one ward would
 * see every other ward's people. Every other permission in this system narrows
 * that way, and an exception here would be one nobody expects to find.
 *
 * WHY THE FEED RESOLVES IT PER REQUEST. A calendar feed authenticates with a
 * token in a URL, so the URL is the credential and it lives for as long as the
 * subscription does. Baking the scope into it at creation time would mean a feed
 * made while someone managed a ward kept publishing that ward after they
 * stopped. The scope is therefore recomputed from the token's owner on every
 * fetch, which is the only way a feed can narrow when its owner's authority
 * does.
 *
 * @author Luca Ostinelli
 */

import { RbacService } from './RbacService';

export interface OrgScopeInput {
  userId: number;
  /** The caller's effective permission codes. */
  permissions: string[];
  /** Org-unit scope carried by their roles; null means unrestricted. */
  allowedOrgUnitIds: number[] | null;
  /** The code that lifts the membership bound, e.g. `timeline.read_all`. */
  allPermission: string;
}

/**
 * The org units whose people the caller may see, or null for unrestricted.
 *
 * An EMPTY array is meaningful and different from null: it means the caller has
 * a scope that resolves to nothing, so they see nobody. Callers must not treat
 * it as "no filter".
 */
export const resolveVisibleOrgUnits = async (
  rbac: RbacService,
  input: OrgScopeInput
): Promise<number[] | null> => {
  const scoped = input.allowedOrgUnitIds ?? null;

  if (input.permissions.includes(input.allPermission)) {
    return scoped;
  }

  // The subtree of each unit the person belongs to: someone in a ward sees the
  // ward and anything organised beneath it, intersected with their role scope
  // when they have one.
  const own = await rbac.getUserOrgUnitSubtreeIds(input.userId);
  return scoped === null ? own : own.filter((id) => scoped.includes(id));
};
