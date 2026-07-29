/**
 * The internal-navigation guard.
 *
 * The case this exists for is the backslash: `/\evil.com` is a path to the
 * router and a host to the browser, which is the bypass react-router's open
 * redirect advisory describes. A test suite that only checked `http://` would
 * pass against a guard that misses precisely the thing it was written for.
 *
 * @author Luca Ostinelli
 */

import { isInternalPath, internalPathOr, SAFE_FALLBACK } from './internalPath';

describe('isInternalPath', () => {
  it.each([['/dashboard'], ['/schedules/12'], ['/a?b=c'], ['/a#b'], ['/']])(
    'accepts the internal path %s',
    (path) => {
      expect(isInternalPath(path)).toBe(true);
    }
  );

  describe('rejects what leaves the origin', () => {
    it('rejects a backslash authority, the bypass this exists for', () => {
      // A path to the router; a host to the browser.
      expect(isInternalPath('/\\evil.com')).toBe(false);
    });

    it('rejects a backslash later in the path', () => {
      // Browsers normalise a backslash to a slash, so one after a harmless
      // segment can still form an authority.
      expect(isInternalPath('/a/\\evil.com')).toBe(false);
    });

    it('rejects a protocol-relative URL', () => {
      expect(isInternalPath('//evil.com')).toBe(false);
    });

    it.each([['http://evil.com'], ['https://evil.com'], ['javascript:alert(1)'], ['data:text/html,x']])(
      'rejects the absolute target %s',
      (target) => {
        // Out by construction: a scheme cannot precede the first character,
        // and the first character must be a slash.
        expect(isInternalPath(target)).toBe(false);
      }
    );

    it('rejects a bare relative path', () => {
      // Not an attack, but not something this app ever produces either, and
      // accepting it would mean the rule is "not obviously external" rather
      // than "definitely internal".
      expect(isInternalPath('dashboard')).toBe(false);
    });
  });

  it.each([[''], [null], [undefined], [42], [{}]])('rejects the non-path %s', (value) => {
    expect(isInternalPath(value)).toBe(false);
  });
});

describe('internalPathOr', () => {
  it('passes an internal path through', () => {
    expect(internalPathOr('/schedules/3')).toBe('/schedules/3');
  });

  it('substitutes the fallback for anything else', () => {
    expect(internalPathOr('//evil.com')).toBe(SAFE_FALLBACK);
    expect(internalPathOr(undefined)).toBe(SAFE_FALLBACK);
  });

  it('accepts a caller-chosen fallback', () => {
    expect(internalPathOr('https://evil.com', '/login')).toBe('/login');
  });
});
