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

  const [loginResponse] = await Promise.all([
    page.waitForResponse((res) => {
      const url = res.url();
      return url.includes('/api/auth/login') || url.endsWith('/auth/login');
    }),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);

  // If the API call itself failed, surface the body for easy CI diagnosis.
  if (!loginResponse.ok()) {
    const body = await loginResponse.text().catch(() => '<unreadable>');
    throw new Error(`Login API failed (${loginResponse.status()}): ${body}`);
  }

  // On app-level failures (e.g. unexpected response contract), the UI stays on /login
  // and shows an error alert. Race the success URL against the alert to get a crisp error.
  const dashboardPromise = page.waitForURL(/\/dashboard$/, { timeout: 30_000 }).then(() => 'ok' as const);
  const alertPromise = page
    .getByRole('alert')
    .waitFor({ timeout: 30_000 })
    .then(() => 'alert' as const)
    .catch(() => 'no-alert' as const);

  const outcome = await Promise.race([dashboardPromise, alertPromise]);
  if (outcome !== 'ok') {
    const alertText = await page.getByRole('alert').textContent().catch(() => null);
    throw new Error(`Login did not reach /dashboard. Alert: ${alertText ?? '<none>'}`);
  }
}
