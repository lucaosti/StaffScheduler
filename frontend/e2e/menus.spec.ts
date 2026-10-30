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

/**
 * Not the first item, on purpose: opening the menu focuses the first item,
 * and on WebKit a click does not move focus, so pressing another item blurs
 * the focused one with no `relatedTarget`. The menu took that for focus
 * leaving it and closed before the click landed, so Delete did nothing on
 * Safari and in the iOS app (#840 review).
 */
test('a menu item other than the first takes the click', async ({ browser }) => {
  const page = await adminPage(browser);
  // macOS Safari, iOS WKWebView and Firefox-mac do not focus a button on
  // click: pressing one blurs whatever had focus (relatedTarget null) and
  // leaves the button unfocused. Playwright's WebKit runs on Linux
  // (WebKitGTK), which focuses on click like Chromium, so neither project
  // shows that by itself — the page is made to behave that way here.
  await page.addInitScript(() => {
    document.addEventListener(
      'mousedown',
      (event) => {
        if (!(event.target as Element).closest('button')) return;
        event.preventDefault(); // the button does not take focus…
        (document.activeElement as HTMLElement | null)?.blur(); // …and focus goes nowhere
      },
      true
    );
  });
  await page.goto('/shifts');

  await page.getByRole('button', { name: 'Shift actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
});

test('the notification bell opens its menu', async ({ browser }) => {
  const page = await adminPage(browser);

  await page.getByRole('button', { name: /^Notifications/ }).click();

  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
});
