/**
 * The Bootstrap build follows the writing direction (#845) — including when
 * the direction changes again before the previous switch finished loading.
 */

import { applyBootstrapDirection, configureBootstrapStylesheets } from './bootstrapStylesheet';

const links = () =>
  Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((l) =>
    l.getAttribute('href')
  );
const linkFor = (href: string) =>
  document.head.querySelector<HTMLLinkElement>(`link[href="${href}"]`)!;
/** jsdom fetches no stylesheet, so a test says when one has "loaded". */
const load = (href: string) => linkFor(href).dispatchEvent(new Event('load'));

beforeEach(() => {
  document.head.innerHTML = '';
  configureBootstrapStylesheets({ ltr: '/ltr.css', rtl: '/rtl.css' });
});

describe('applyBootstrapDirection', () => {
  it('replaces the old build only once the new one has loaded', async () => {
    const first = applyBootstrapDirection('ltr');
    load('/ltr.css');
    await first;

    const second = applyBootstrapDirection('rtl');
    expect(links()).toEqual(['/ltr.css', '/rtl.css']);
    load('/rtl.css');
    await second;

    expect(links()).toEqual(['/rtl.css']);
  });

  /**
   * Review of #845: ar → en while the RTL sheet was still loading ended with
   * dir="ltr" and only the RTL build in the page — the LTR request saw the
   * old LTR link and returned, then the RTL load removed it.
   */
  it('a newer direction cancels a switch still loading', async () => {
    const first = applyBootstrapDirection('ltr');
    load('/ltr.css');
    await first;

    void applyBootstrapDirection('rtl'); // still loading…
    const back = applyBootstrapDirection('ltr');
    await back;

    expect(links()).toEqual(['/ltr.css']);
  });

  it('a repeated request while loading shares the pending switch', async () => {
    const first = applyBootstrapDirection('ltr');
    load('/ltr.css');
    await first;

    const a = applyBootstrapDirection('rtl');
    const b = applyBootstrapDirection('rtl');
    expect(links()).toEqual(['/ltr.css', '/rtl.css']);
    load('/rtl.css');
    await Promise.all([a, b]);

    expect(links()).toEqual(['/rtl.css']);
  });
});
