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
import { ADMIN, login } from './helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('the menu button opens the drawer and a link in it navigates', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

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
