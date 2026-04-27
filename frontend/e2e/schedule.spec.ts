/**
 * Smoke: admin opens the Schedule page and creates a new schedule end-to-end.
 *
 * Verifies that the "New Schedule" button opens the modal, the form submits to
 * the backend, and the new schedule appears in the list.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import { ADMIN, login } from './helpers';

test('admin can create a schedule via the UI', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  await page.goto('/schedule');
  await page.getByTestId('open-create-schedule').click();

  const modal = page.getByRole('dialog', { name: /create schedule/i });
  await expect(modal).toBeVisible();

  const stamp = Date.now().toString(36);
  const today = new Date();
  const inAWeek = new Date(today);
  inAWeek.setDate(today.getDate() + 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  await modal.getByLabel(/^name/i).fill(`E2E smoke ${stamp}`);
  await modal.getByLabel(/start date/i).fill(iso(today));
  await modal.getByLabel(/end date/i).fill(iso(inAWeek));

  const departmentSelect = modal.getByLabel(/^department/i);
  const optionValues = await departmentSelect.locator('option:not([disabled])').evaluateAll(
    (nodes) => nodes.map((n) => (n as HTMLOptionElement).value).filter(Boolean)
  );
  expect(optionValues.length).toBeGreaterThan(0);
  await departmentSelect.selectOption(optionValues[0]);

  const [createResponse] = await Promise.all([
    page
      .waitForResponse((res) => {
        const url = res.url();
        return res.request().method() === 'POST' && (url.includes('/api/schedules') || url.endsWith('/schedules'));
      })
      .catch(() => null),
    modal.getByRole('button', { name: /create schedule/i }).click(),
  ]);

  if (createResponse && !createResponse.ok()) {
    const body = await createResponse.text().catch(() => '<unreadable>');
    throw new Error(`Create schedule failed (${createResponse.status()}): ${body}`);
  }

  const errorAlert = modal.locator('[role="alert"].alert-danger');
  if (await errorAlert.isVisible().catch(() => false)) {
    const msg = (await errorAlert.textContent().catch(() => null))?.trim() ?? '<unknown>';
    throw new Error(`Create schedule modal error: ${msg}`);
  }

  await expect(modal).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(`E2E smoke ${stamp}`)).toBeVisible({ timeout: 15_000 });
});
