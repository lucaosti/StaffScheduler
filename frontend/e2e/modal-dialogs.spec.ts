/**
 * Every hand-rolled modal must accept pointer input (#941).
 *
 * Eight dialogs rendered their `.modal-backdrop` inside `.modal`. Inside the
 * modal's stacking context the backdrop painted above the dialog, so every
 * click landed on it: nobody could approve or reject on Pending Approvals,
 * create or revoke a delegation, or create a change request or an approval
 * workflow with a mouse. Unit tests never saw it — jsdom has no layout, and
 * `fireEvent.click` dispatches straight to the element — so this has to be a
 * real browser clicking where a person would: fill a field, then press the
 * dialog's primary button and see the action complete.
 *
 * The steps form one serial chain because each dialog needs data the previous
 * one creates: the workflow routes the change request to the manager's
 * Pending Approvals queue. Each role signs in once, in a page shared by its
 * steps: the login limiter allows ten attempts per address per fifteen
 * minutes, and the whole e2e suite runs from one address. A per-run stamp
 * keeps the change types unique across repeated runs.
 *
 * @author Luca Ostinelli
 */

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN, MANAGER, login } from './helpers';

const stamp = Date.now().toString(36);
const DECISION_TYPE = `E2E.Decision.${stamp}`;
const REVIEW_TYPE = `E2E.Review.${stamp}`;
// A workflow nothing has run through: one with approval history cannot be
// deleted (its steps are referenced by pending_approvals).
const DELETE_TYPE = `E2E.Delete.${stamp}`;
// The demo seed's manager account (emergency.manager@…) has user id 2.
const MANAGER_USER_ID = '2';

const dialog = (page: Page) => page.getByRole('dialog');

async function createWorkflow(page: Page, changeType: string): Promise<void> {
  await page.getByRole('button', { name: /new workflow/i }).click();
  await dialog(page).locator('#wfChangeType').fill(changeType);
  await dialog(page).locator('#stepScope-0').selectOption('company_user');
  await dialog(page).locator('#stepUserId-0').fill(MANAGER_USER_ID);
  await dialog(page).getByRole('button', { name: 'Create workflow' }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByText(changeType)).toBeVisible();
}

async function createChangeRequest(page: Page, changeType: string): Promise<void> {
  await page.getByRole('button', { name: /new request/i }).click();
  await dialog(page).locator('#crChangeType').fill(changeType);
  await dialog(page).locator('#crEntityType').fill('e2e');
  await dialog(page).getByRole('button', { name: 'Submit change request' }).click();
  await expect(dialog(page)).toBeHidden();
}

test.describe.serial('modal dialogs accept clicks', () => {
  let admin: Page;

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newPage();
    await login(admin, ADMIN.email, ADMIN.password);
  });

  test.afterAll(async () => {
    await admin.close();
  });

  test('approval workflow modal creates a workflow', async () => {
    await admin.goto('/admin/approval-workflows');
    await createWorkflow(admin, DECISION_TYPE);
  });

  test('change request modals create and review a request', async () => {
    await admin.goto('/change-requests');

    // Routed through the workflow above to the manager's approval queue.
    await createChangeRequest(admin, DECISION_TYPE);
    // No workflow for this type: a reviewer approves it directly.
    await createChangeRequest(admin, REVIEW_TYPE);

    const row = admin.getByRole('row').filter({ hasText: REVIEW_TYPE });
    await row.getByRole('button', { name: /^approve request/i }).click();
    await dialog(admin).locator('#reviewNote').fill('Looks right');
    await dialog(admin).getByRole('button', { name: 'Confirm approve' }).click();

    await expect(dialog(admin)).toBeHidden();
    await expect(row).toContainText(/approved/i);
  });

  test('decision modal approves a pending approval', async ({ page }) => {
    await login(page, MANAGER.email, MANAGER.password);
    await page.goto('/approvals/pending');

    const row = page.getByRole('row').filter({ hasText: DECISION_TYPE });
    await row.getByRole('button', { name: /^approve item/i }).click();
    await dialog(page).locator('#decisionNote').fill('Approved in e2e');
    await dialog(page).getByRole('button', { name: 'Confirm approve' }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(row).toBeHidden();
  });

  test('delete confirm removes a workflow', async () => {
    await admin.goto('/admin/approval-workflows');
    await createWorkflow(admin, DELETE_TYPE);

    await admin.getByRole('button', { name: `Delete workflow ${DELETE_TYPE}` }).click();
    await dialog(admin).getByRole('button', { name: `Confirm delete workflow ${DELETE_TYPE}` }).click();

    await expect(dialog(admin)).toBeHidden();
    await expect(admin.getByText(DELETE_TYPE)).toBeHidden();
  });

  test('delegation modals create and revoke a delegation', async () => {
    await admin.goto('/delegations');

    await admin.getByRole('button', { name: /new delegation/i }).click();
    await dialog(admin).locator('#delegDelegateeId').fill(MANAGER_USER_ID);
    const expiry = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 16);
    await dialog(admin).locator('#delegExpiry').fill(expiry);
    await dialog(admin).locator('#delegPermissionInput').fill('schedule.read');
    await dialog(admin).getByRole('button', { name: /add permission/i }).click();
    await dialog(admin).getByRole('button', { name: 'Submit delegation' }).click();
    await expect(dialog(admin)).toBeHidden();

    await admin.getByRole('button', { name: /^revoke delegation/i }).first().click();
    await dialog(admin).locator('#revokeNote').fill('No longer needed');
    await dialog(admin).getByRole('button', { name: 'Confirm revoke' }).click();

    await expect(dialog(admin)).toBeHidden();
    await expect(admin.getByRole('button', { name: /^revoke delegation/i })).toHaveCount(0);
  });

  test('org chart details dialog closes from its own button', async () => {
    await admin.goto('/org-chart');

    // The unit node, not its expand/collapse toggle (also role="button").
    await admin.locator('g[role="button"][tabindex="0"]').first().click();
    await expect(dialog(admin)).toBeVisible();
    await dialog(admin).getByRole('button', { name: 'Close' }).click();

    await expect(dialog(admin)).toBeHidden();
  });
});
