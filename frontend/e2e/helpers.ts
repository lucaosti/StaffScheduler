/**
 * Shared helpers for Playwright e2e smoke tests.
 *
 * @author Luca Ostinelli
 */

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const ADMIN = {
  email: process.env.E2E_ADMIN_EMAIL || 'admin@demo.staffscheduler.local',
  password: process.env.E2E_ADMIN_PASSWORD || 'demo1234',
};

export const MANAGER = {
  email: process.env.E2E_MANAGER_EMAIL || 'emergency.manager@demo.staffscheduler.local',
  password: process.env.E2E_MANAGER_PASSWORD || 'demo1234',
};

/**
 * Sign in via the real login form and wait for redirect to /dashboard.
 */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);

  // Best-effort capture of the login response for diagnostics.
  // Do not hard-block the flow on this because some environments may not expose the response
  // (e.g. request is blocked preflight, service worker, or navigation interruption).
  const loginResponsePromise = page
    .waitForResponse(
      (res) => {
      const url = res.url();
      return url.includes('/api/auth/login') || url.endsWith('/auth/login');
      },
      { timeout: 30_000 }
    )
    .catch(() => null);

  await page.getByRole('button', { name: /sign in/i }).click();

  // Demo mode renders a persistent warning banner with role="alert". That must not be treated as
  // a login failure. We consider login successful only when the redirect to /dashboard happens.
  try {
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  } catch {
    const errorAlert = page.locator('[role="alert"].alert-danger').first();
    const errorText = (await errorAlert.textContent().catch(() => null))?.trim() ?? null;

    const loginResponse = await loginResponsePromise;
    if (loginResponse) {
      const body = await loginResponse.text().catch(() => '<unreadable>');
      throw new Error(
        `Login did not reach /dashboard. Error alert: ${errorText ?? '<none>'}. ` +
          `Login API: ${loginResponse.status()} ${loginResponse.url()} Body: ${body}`
      );
    }

    throw new Error(`Login did not reach /dashboard. Error alert: ${errorText ?? '<none>'}.`);
  }
}
