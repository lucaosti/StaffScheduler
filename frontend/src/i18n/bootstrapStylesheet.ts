/**
 * Loads the Bootstrap build that matches the document's writing direction.
 *
 * WHY TWO BUILDS (#845). `dir="rtl"` alone does not mirror Bootstrap: its LTR
 * build defines the spacing and alignment utilities as physical properties
 * (`.ms-2` is `margin-left`, `.text-start` is `text-align: left`). Bootstrap
 * ships `bootstrap.rtl.min.css` — the same rules with the sides swapped — for
 * exactly this, and an Arabic page must have that one loaded instead.
 * Rewriting every utility use in the app onto logical CSS properties was
 * rejected: it would fork Bootstrap's class vocabulary for one locale, and
 * every new page would have to remember it.
 *
 * WHY A `<link>` RATHER THAN AN `import`. A CSS `import` is bundled for good;
 * it cannot be unloaded when the locale changes. Both builds are therefore
 * imported as URLs in `index.tsx` and handed over with
 * `configureBootstrapStylesheets`, and the matching one is attached here. A
 * switch keeps the old sheet until the new one has loaded, so the page never
 * renders unstyled in between. The link is the first stylesheet in `<head>`,
 * so the app's own CSS (`index.css`) still overrides Bootstrap.
 *
 * Until configured (unit tests, which render no real stylesheet) this does
 * nothing.
 *
 * @author Luca Ostinelli
 */

type Direction = 'ltr' | 'rtl';

const LINK_ATTRIBUTE = 'data-bootstrap-stylesheet';

let hrefs: Record<Direction, string> | null = null;

/** Registers the URLs of both builds; `index.tsx` does this once at startup. */
export const configureBootstrapStylesheets = (urls: Record<Direction, string>): void => {
  hrefs = urls;
};

/**
 * Attaches the build for `dir`, resolving once it has loaded (or failed —
 * a failed stylesheet must not keep the app from rendering).
 */
export const applyBootstrapDirection = (dir: Direction): Promise<void> => {
  if (!hrefs || typeof document === 'undefined') return Promise.resolve();
  const href = hrefs[dir];
  const current = document.head.querySelectorAll<HTMLLinkElement>(`link[${LINK_ATTRIBUTE}]`);
  if (Array.from(current).some((link) => link.getAttribute('href') === href)) return Promise.resolve();

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(LINK_ATTRIBUTE, dir);
  return new Promise((resolve) => {
    const settle = () => {
      current.forEach((old) => old.remove());
      resolve();
    };
    link.addEventListener('load', settle, { once: true });
    link.addEventListener('error', settle, { once: true });
    if (current.length > 0) current[current.length - 1].after(link);
    else document.head.prepend(link);
  });
};
