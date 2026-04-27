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

  const start = await getResolvedTheme(page);
  expect(['light', 'dark']).toContain(start);

  await toggle.click();
  await expect
    .poll(async () => getResolvedTheme(page), { timeout: 5_000 })
    .not.toBe(start);

  const after = await getResolvedTheme(page);
  expect(['light', 'dark']).toContain(after);

  const headerBg = await page.locator('body').evaluate((el) =>
    getComputedStyle(el).backgroundColor
  );
  expect(headerBg).not.toBe('');
});
