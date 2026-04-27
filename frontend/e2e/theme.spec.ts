/**
 * Smoke: theme toggle updates `data-bs-theme` and keeps key surfaces readable.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import { ADMIN, login } from './helpers';

const getResolvedTheme = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-bs-theme'));

test('theme toggle cycles between light and dark', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  const toggle = page.getByRole('button', { name: /^theme:/i });
  await expect(toggle).toBeVisible();
  await toggle.scrollIntoViewIfNeeded();

  const start = await getResolvedTheme(page);
  expect(['light', 'dark']).toContain(start);

  // The toggle cycles light → dark → system.
  // If the starting choice is "system" and the resolved theme is "light",
  // the first click may resolve to "light" again. Click up to twice to ensure
  // the resolved theme actually changes.
  for (let i = 0; i < 2; i++) {
    // The demo banner is sticky at the top; "force" avoids occasional overlap issues.
    await toggle.click({ force: true });
    const current = await getResolvedTheme(page);
    if (current !== start) break;
  }

  await expect.poll(async () => getResolvedTheme(page), { timeout: 10_000 }).not.toBe(start);

  const after = await getResolvedTheme(page);
  expect(['light', 'dark']).toContain(after);

  const headerBg = await page.locator('body').evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  expect(headerBg).not.toBe('');
});
