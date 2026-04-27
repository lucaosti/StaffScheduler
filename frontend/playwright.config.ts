/**
 * Playwright configuration for headless e2e smoke tests.
 *
 * Tests assume the backend is already running on `http://localhost:3001`
 * (CI starts it from the workflow; locally use `./scripts/demo.sh up`).
 * The frontend dev server is started automatically by the `webServer`
 * block below — that way `npm run test:e2e` works both locally and in
 * CI without copy-pasting `npm start` into another terminal.
 *
 * Run with:
 *   npx playwright install --with-deps chromium  # one-time
 *   npm run test:e2e
 *
 * @author Luca Ostinelli
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const PORT = Number(new URL(BASE_URL).port || 3000);
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: SKIP_WEB_SERVER
    ? undefined
    : {
        command: 'npm start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          BROWSER: 'none',
          PORT: String(PORT),
          REACT_APP_API_URL: process.env.REACT_APP_API_URL ?? 'http://localhost:3001/api',
        },
      },
});
