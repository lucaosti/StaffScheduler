/**
 * Session lifecycle for simulation actors, through the real endpoints only.
 *
 *   login   — `POST /auth/login`; the server sets the `token` and the
 *             path-scoped `refresh_token` cookies in the actor's jar.
 *   refresh — `POST /auth/refresh`; the jar presents the refresh cookie only
 *             because the request path lies beneath the cookie's path, so a
 *             successful refresh is itself a check of the cookie scoping.
 *   profile — `GET /auth/verify`; the actor's permissions and org-unit reach
 *             as the server computed them, which is what actors base their
 *             expectations on (see world.ts).
 *   logout  — `POST /auth/refresh/logout`; afterwards the old refresh token
 *             must be dead, which `endSession` checks by replaying it.
 *
 * Nothing here signs a token or reads the JWT secret: an actor holds exactly
 * what a browser would.
 *
 * @author Luca Ostinelli
 */

import { Actor, ActorKind, World } from './world';

interface VerifiedUser {
  id: number;
  permissions?: string[];
  allowedOrgUnitIds?: number[] | null;
}

/** Logs `email` in with a new browser profile and loads its profile. Throws
 *  on failure: an actor that cannot log in means the setup is broken. */
export async function login(
  world: World,
  kind: ActorKind,
  email: string,
  password: string,
  placement: { orgUnitId: number | null; departmentId: number | null } = { orgUnitId: null, departmentId: null },
  twoFactorCode?: string
): Promise<Actor> {
  const client = world.newClient();
  const body: Record<string, string> = { email, password };
  if (twoFactorCode) body.code = twoFactorCode;
  const res = await client.post<{ user: { id: number } }>('/auth/login', body, { noRefresh: true });
  if (res.status !== 200 || !res.body.data?.user?.id) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  if (!client.hasCookie('token') || !client.hasCookie('refresh_token')) {
    throw new Error(`login for ${email} did not set both session cookies`);
  }
  const actor: Actor = {
    kind,
    userId: res.body.data.user.id,
    email,
    client,
    permissions: new Set(),
    allowedOrgUnitIds: null,
    orgUnitId: placement.orgUnitId,
    departmentId: placement.departmentId,
  };
  await loadProfile(world, actor);
  return actor;
}

/** Re-reads permissions and reach — after a delegation or role change. */
export async function loadProfile(world: World, actor: Actor): Promise<void> {
  const res = await actor.client.get<VerifiedUser>('/auth/verify');
  if (!world.expectOk(actor, res, 'auth.verify')) return;
  actor.permissions = new Set(res.body.data.permissions ?? []);
  actor.allowedOrgUnitIds = res.body.data.allowedOrgUnitIds ?? null;
}

/** One explicit rotation, as the SPA performs on mount. */
export async function refresh(world: World, actor: Actor): Promise<void> {
  const res = await actor.client.post('/auth/refresh', {}, { noRefresh: true });
  world.expectOk(actor, res, 'auth.refresh');
}

/**
 * The access cookie expires (its max-age equals the token lifetime, so the
 * browser simply drops it): the next call must recover through one automatic
 * refresh and succeed. A run shorter than the token lifetime would otherwise
 * never take this path.
 */
export async function expireAccessToken(world: World, actor: Actor): Promise<void> {
  const before = actor.client.refreshes;
  actor.client.dropCookie('token');
  const res = await actor.client.get('/auth/verify');
  if (res.status === 200 && actor.client.refreshes === before + 1) {
    world.log.verify(true, `expired access token of ${world.label(actor)}`, 'recovered by one automatic refresh');
  } else {
    world.dbFinding(`expired access token of ${world.label(actor)}`, `status ${res.status}, refreshes ${actor.client.refreshes - before}`);
  }
}

/**
 * Logs out and proves the session is gone. The server clears the cookies, so
 * a plain retry would fail trivially; instead the pre-logout jar is replayed
 * — the stolen-cookie case — and both the old refresh token (its family is
 * revoked) and the old access token (its JTI is blacklisted) must be refused.
 */
export async function endSession(world: World, actor: Actor): Promise<void> {
  const before = actor.client.snapshotCookies();
  const res = await actor.client.post('/auth/refresh/logout', {}, { noRefresh: true });
  if (!world.expectOk(actor, res, 'auth.logout')) return;
  if (actor.client.hasCookie('refresh_token')) {
    world.dbFinding(`logout of ${world.label(actor)}`, 'the refresh cookie was not cleared');
  }
  actor.client.restoreCookies(before);
  const replayedAccess = await actor.client.get('/auth/verify', undefined, { noRefresh: true });
  const replayedRefresh = await actor.client.post('/auth/refresh', {}, { noRefresh: true });
  actor.client.restoreCookies(new Map());
  if (replayedAccess.status === 200) {
    world.dbFinding(`logout of ${world.label(actor)}`, 'the access token still authenticates after logout');
  } else if (replayedRefresh.status === 200) {
    world.dbFinding(`logout of ${world.label(actor)}`, 'the refresh token still rotates after logout');
  } else {
    world.log.verify(
      true,
      `logout of ${world.label(actor)}`,
      `replayed access token ${replayedAccess.status}, replayed refresh token ${replayedRefresh.status}`
    );
  }
}
