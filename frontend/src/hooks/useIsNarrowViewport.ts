/**
 * Whether the viewport is currently narrower than a breakpoint — the signal a
 * page uses to swap a desktop-width grid for a compact stacked layout.
 *
 * WHY A HOOK AND NOT A CSS-ONLY MEDIA QUERY. Some layouts (a week/month
 * calendar grid, a multi-day Gantt chart) cannot be reflowed into something
 * usable at phone width by CSS alone — the number of columns itself has to
 * change, which means rendering a different tree, not just resizing the same
 * one. `matchMedia` is the DOM's own breakpoint check, so this hook is a thin
 * re-render wrapper around it rather than a second source of truth for what
 * "narrow" means.
 *
 * @author Luca Ostinelli
 */

import { useEffect, useState } from 'react';

/** Phone viewports (375px–428px) and the small tablet band just above them. */
export const MOBILE_BREAKPOINT_PX = 576;

export function useIsNarrowViewport(breakpointPx: number = MOBILE_BREAKPOINT_PX): boolean {
  const query = `(max-width: ${breakpointPx}px)`;
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isNarrow;
}
