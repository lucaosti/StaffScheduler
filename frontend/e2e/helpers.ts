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
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15_000 });
}
