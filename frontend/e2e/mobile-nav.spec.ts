/**
 * Phone-width navigation (#890): the sidebar is an off-canvas drawer below
 * 768px, and the menu button must open it so other pages are reachable.
 *
 * jsdom applies no CSS, so only a real browser can show that the drawer is
 * actually on screen and clickable — which is exactly what was broken.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import { ADMIN_STATE_FILE } from './helpers';

// Signed in through the run's one shared login (see global-setup.ts): with
// two browser projects, per-spec logins exceed the backend's login limit.
test.use({ storageState: ADMIN_STATE_FILE });

test.use({ viewport: { width: 390, height: 844 } });

test('the menu button opens the drawer and a link in it navigates', async ({ page }) => {
  await page.goto('/dashboard');

  const sidebar = page.locator('#app-sidebar');
  const employees = sidebar.getByRole('link', { name: 'Employees' });
  await expect(employees).not.toBeInViewport();

  const toggle = page.getByRole('button', { name: /toggle sidebar/i });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(employees).toBeInViewport();

  await employees.click();
  await expect(page).toHaveURL(/\/employees$/);
  await expect(employees).not.toBeInViewport();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
