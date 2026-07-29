/**
 * Is this navigation target somewhere inside this application?
 *
 * WHY THIS EXISTS. Two navigations in this app take a target that did not come
 * from the code: the post-login redirect uses the path the visitor originally
 * asked for, and a notification may carry a link. React Router carries two
 * moderate advisories, one of which is an open redirect via a BACKSLASH in a
 * `<Link>` or `useNavigate` target — a bypass of an earlier fix. A crafted
 * `/\evil.com` can be a path to the router and a host to the browser.
 *
 * WHY A GUARD RATHER THAN ONLY THE UPGRADE. The fix is in react-router 7, a
 * major with a different route API; that upgrade is worth doing on its own
 * schedule rather than as an emergency. This check removes the exposure now,
 * costs two comparisons, and remains correct after the upgrade — never
 * navigating to an unvalidated external target is right regardless of which
 * version of the router is underneath.
 *
 * WHAT COUNTS AS INTERNAL. A single leading slash, and nothing that a browser
 * could read as an authority: `//host` is protocol-relative and `/\host` is
 * the backslash bypass. A scheme of any kind is out by construction, since it
 * cannot appear before the first character.
 *
 * @author Luca Ostinelli
 */

/** Where a rejected target goes instead. */
export const SAFE_FALLBACK = '/dashboard';

export const isInternalPath = (target: unknown): target is string => {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (target[0] !== '/') return false;
  // `//host` and `/\host` both leave the origin; the second is the bypass the
  // advisory is about, and it is the one a reader would not think to reject.
  if (target[1] === '/' || target[1] === '\\') return false;
  // A backslash anywhere is never meaningful in a path this app produces, and
  // browsers normalise it to a slash — so a later one can still form an
  // authority after a segment the router considers harmless.
  return !target.includes('\\');
};

/** The target if it is internal, otherwise somewhere that certainly is. */
export const internalPathOr = (target: unknown, fallback = SAFE_FALLBACK): string =>
  isInternalPath(target) ? target : fallback;
