/**
 * Smoke: login flows for admin and manager accounts.
 *
 * Confirms the JWT auth contract (frontend → backend → frontend) by completing
 * a real form submission and asserting the post-login redirect.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import { ADMIN, MANAGER, login } from './helpers';

test.describe('authentication', () => {
  test('admin can sign in', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole('heading', { level: 5, name: /staff scheduler/i })).toBeVisible();
  });

  test('manager can sign in', async ({ page }) => {
    await login(page, MANAGER.email, MANAGER.password);
    await expect(page.getByRole('heading', { level: 5, name: /staff scheduler/i })).toBeVisible();
  });

  test('invalid credentials surface an error message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.invalid');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.locator('[role="alert"].alert-danger')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });
});
