/**
 * Signs ADMIN in once per run and saves the session for `adminPage`.
 *
 * The backend allows ten logins per IP per 15 minutes outside NODE_ENV=test,
 * and the e2e suite runs against a development backend. With every spec
 * logging in for itself — and Playwright starting a fresh worker, so a fresh
 * login, after every failure and retry — the budget ran out and unrelated
 * specs failed with 429. One login here serves every spec that is not about
 * logging in.
 *
 * @author Luca Ostinelli
 */

import { chromium, type FullConfig } from '@playwright/test';
import { ADMIN, ADMIN_STATE_FILE, login } from './helpers';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL;
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await login(page, ADMIN.email, ADMIN.password);
  await context.storageState({ path: ADMIN_STATE_FILE });
  await browser.close();
}
