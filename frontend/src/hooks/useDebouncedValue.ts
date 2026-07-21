/**
 * Debounce a rapidly-changing value (e.g. a search box) so downstream effects —
 * here, the query key that triggers a server fetch — only react after the value
 * settles.
 *
 * WHY: server-side search must not fire a request on every keystroke. Previously
 * each page wired its own setTimeout/clearTimeout ref dance inside a useEffect.
 * Debouncing the *value* instead, and feeding the debounced value into a
 * TanStack Query key, moves the "when to refetch" decision entirely into the
 * cache layer: same key → served from cache, new key → one fetch. The component
 * no longer manages timers or loading flags by hand.
 *
 * @author Luca Ostinelli
 */

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
