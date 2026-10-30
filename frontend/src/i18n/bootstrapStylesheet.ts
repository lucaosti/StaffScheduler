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

/**
 * The switch still loading, if any. Tracked because a newer request must
 * cancel it (#845 review): ar → en while the RTL sheet loaded saw the old LTR
 * link, returned, and was then undone when the RTL load removed that link —
 * leaving dir="ltr" over the RTL build.
 */
let pending: { href: string; link: HTMLLinkElement; done: Promise<void>; finish: () => void } | null = null;

/** Registers the URLs of both builds; `index.tsx` does this once at startup. */
export const configureBootstrapStylesheets = (urls: Record<Direction, string>): void => {
  hrefs = urls;
  pending = null;
};

/**
 * Attaches the build for `dir`, resolving once it has loaded (or failed —
 * a failed stylesheet must not keep the app from rendering).
 */
export const applyBootstrapDirection = (dir: Direction): Promise<void> => {
  if (!hrefs || typeof document === 'undefined') return Promise.resolve();
  const href = hrefs[dir];
  if (pending?.href === href) return pending.done;
  if (pending) {
    // Superseded: drop the sheet still loading and release its waiters.
    pending.link.remove();
    pending.finish();
    pending = null;
  }

  const loaded = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${LINK_ATTRIBUTE}]`));
  if (loaded.some((link) => link.getAttribute('href') === href)) return Promise.resolve();

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute(LINK_ATTRIBUTE, dir);
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const entry = { href, link, done, finish };
  const settle = () => {
    if (pending !== entry) return; // superseded meanwhile
    loaded.forEach((old) => old.remove());
    pending = null;
    finish();
  };
  link.addEventListener('load', settle, { once: true });
  link.addEventListener('error', settle, { once: true });
  pending = entry;
  if (loaded.length > 0) loaded[loaded.length - 1].after(link);
  else document.head.prepend(link);
  return done;
};
