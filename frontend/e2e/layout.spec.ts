/**
 * Layout regressions only a real browser shows: stacking order and writing
 * direction. jsdom computes no layout, so neither can be unit-tested.
 *
 * The e2e backend runs in demo mode, so the demo banner is on screen here
 * exactly as it is for anyone trying the demo.
 *
 * @author Luca Ostinelli
 */

import { expect, test, type Locator } from '@playwright/test';
import { adminPage } from './helpers';

/** True when the topmost element at `locator`'s top-left corner belongs to it. */
const ownsItsTopEdge = (locator: Locator) =>
  locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + 8, box.top + 4);
    return hit !== null && el.contains(hit);
  });

/**
 * #892: the banner sat at z-index 1080, above Bootstrap's modals (1055) and
 * the fixed sidebar (1000), so it covered every modal's title and close
 * button and the sidebar brand.
 */
test.describe('demo banner', () => {
  test('does not cover a modal header', async ({ browser }) => {
    const page = await adminPage(browser);
    await expect(page.getByRole('alert', { name: 'Demo environment notice' })).toBeVisible();
    await page.goto('/schedule');

    await page.getByTestId('open-create-schedule').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    expect(await ownsItsTopEdge(dialog.locator('.modal-header'))).toBe(true);
    // No `force`: Playwright refuses the click if another element would get it.
    await dialog.getByRole('button', { name: 'Close' }).click({ timeout: 5_000 });
    await expect(dialog).toBeHidden();
  });

  test('does not cover the sidebar brand', async ({ browser }) => {
    const page = await adminPage(browser);
    await expect(page.getByRole('alert', { name: 'Demo environment notice' })).toBeVisible();

    expect(await ownsItsTopEdge(page.locator('.sidebar-brand'))).toBe(true);
  });
});

/**
 * #947: on phones in Arabic the closed sidebar sat mid-screen over the
 * headings and pages were 571–1214 px wide on a 390 px viewport — the RTL
 * desktop margin was never reset in the mobile query, and the closed drawer
 * slid out of the wrong side.
 */
test.describe('Arabic at phone width', () => {
  /** True when nothing covers `locator` at its start, middle or end. */
  const uncovered = (locator: Locator) =>
    locator.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const y = box.top + box.height / 2;
      return [box.left + 4, box.left + box.width / 2, box.right - 4].every((x) => {
        const hit = document.elementFromPoint(x, y);
        return hit !== null && el.contains(hit);
      });
    });

  for (const path of ['/dashboard', '/shifts', '/schedule']) {
    test(`${path} fits the screen and its heading is not covered`, async ({ browser }) => {
      const page = await adminPage(browser, { viewport: { width: 390, height: 844 } });
      await page.evaluate(() => window.localStorage.setItem('locale', 'ar'));
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible();

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      // On failure, name the elements that stick out, so the message says
      // what to fix rather than only by how much.
      const offenders = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('body *'))
          .filter((el) => {
            if (el.closest('#app-sidebar')) return false; // off-screen by design while closed
            const box = el.getBoundingClientRect();
            return box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1);
          })
          .slice(0, 8)
          .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
      );
      expect(overflow, `overflowing: ${offenders.join(' | ')}`).toBeLessThanOrEqual(0);
      expect(await uncovered(heading)).toBe(true);
    });
  }
});

/**
 * #845: only the LTR Bootstrap stylesheet was ever loaded, so its spacing
 * utilities stayed physical in Arabic (`.me-3` is `margin-right` there) and
 * the layout did not mirror.
 */
test('Arabic mirrors Bootstrap spacing utilities', async ({ browser }) => {
  const page = await adminPage(browser);
  await page.evaluate(() => window.localStorage.setItem('locale', 'ar'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // The sidebar toggle carries `me-3`: "margin at the inline end", which in a
  // right-to-left document is the LEFT side.
  const toggle = page.getByRole('button', { name: 'Toggle sidebar' });
  await expect.poll(() => toggle.evaluate((el) => getComputedStyle(el).marginLeft)).toBe('16px');
  expect(await toggle.evaluate((el) => getComputedStyle(el).marginRight)).toBe('0px');
});
