/**
 * A full-page navigation, isolated in its own module purely for testability.
 *
 * WHY THIS EXISTS AS ITS OWN FILE. `window.location` is not reconfigurable
 * in the jsdom version this project's test suite runs under (neither the
 * property itself nor its `assign` method can be redefined via
 * `Object.defineProperty` or `jest.spyOn`), so a caller that invokes
 * `window.location.assign` directly cannot be unit-tested without touching a
 * real browser. Isolating the one-line call here lets a caller's test
 * `jest.mock` this module instead and assert on the intended target without
 * fighting jsdom's navigation lockdown.
 */
export const navigateBrowser = (path: string): void => {
  window.location.assign(path);
};
