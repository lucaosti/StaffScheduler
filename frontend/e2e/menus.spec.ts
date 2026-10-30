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
import { adminPage } from './helpers';

test('the shift card menu opens and its Edit action opens the editor', async ({ browser }) => {
  const page = await adminPage(browser);
  await page.goto('/shifts');

  await page.getByRole('button', { name: 'Shift actions' }).first().click();
  const edit = page.getByRole('menuitem', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await edit.click();

  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the notification bell opens its menu', async ({ browser }) => {
  const page = await adminPage(browser);

  await page.getByRole('button', { name: /^Notifications/ }).click();

  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
});
