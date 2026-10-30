/**
 * Smoke: the app's menus open in a real browser (#840).
 *
 * They were wired with Bootstrap's `data-bs-toggle`, whose JavaScript the app
 * never loads, so in a browser nothing happened on click — while the jsdom
 * unit tests, which apply no stylesheet, happily clicked the CSS-hidden items.
 * Only a real browser can tell a hidden menu from an open one.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import { ADMIN, login } from './helpers';

test('the shift card menu opens and its Edit action opens the editor', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);
  await page.goto('/shifts');

  const toggle = page.getByRole('button', { name: 'Shift actions' }).first();
  await toggle.click();
  const edit = page.getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await edit.click();

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the notification bell opens its menu', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await page.getByRole('button', { name: /^Notifications/ }).click();

  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
});
