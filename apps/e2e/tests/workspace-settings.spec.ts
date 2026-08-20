// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/studio/settings` end-to-end (09 §8.1) — the screen where three sections
 * ride ONE Save button and one review modal, each writing its own section-put.
 *
 * Everything on that screen was unit-tested against a fetch stub and nothing
 * else: the stub answers whatever the test says it answers, so it can prove the
 * form builds the right body and cannot prove the server accepts it. The SMTP
 * section is where that gap mattered most — it carries a secret through
 * `email.smtp`, whose write path has bounds (`settingsEmailPutBody`), a host
 * guard (`assertSmtpHostAllowed`) and a rule the client cannot see the state of
 * (a username needs a password). This spec drives the real server, so those
 * three agree or this goes red.
 *
 * State is SHARED with every other spec in the serial suite, so the transport
 * this configures is removed again through the UI at the end — by the same
 * control an admin would use, which is also the last thing worth asserting.
 */
import { expect, test } from '@playwright/test';

import { signIn } from './helpers.js';

const SETTINGS = '/studio/settings';
const HOST = 'smtp.e2e.local';
const FROM = 'Adminium <ops@e2e.local>';

test.describe.configure({ mode: 'serial' });

test.describe('workspace settings', () => {
  test('configures SMTP through the shared review modal, and the server keeps it', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(SETTINGS);

    // The three cards of the one form.
    await expect(page.getByRole('heading', { name: 'Workspace identity' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email (SMTP)' })).toBeVisible();

    // A fresh install has no relay, and the card says what that costs.
    await expect(
      page.getByText(/cannot send password resets, user invites or scheduled reports/),
    ).toBeVisible();

    const save = page.getByRole('button', { name: 'Save changes' }).first();
    await expect(save).toBeDisabled();

    // A pasted URL is refused where it was typed — the same shape the server's
    // host guard refuses, so the two must agree.
    await page.getByLabel('SMTP host').fill('smtp://smtp.e2e.local:587');
    await expect(page.getByText(/no scheme, port or credentials/)).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByLabel('SMTP host').fill(HOST);
    await page.getByLabel('From address').fill(FROM);
    await expect(save).toBeEnabled();

    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(`— → ${HOST}`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Workspace settings updated')).toBeVisible();

    // The round trip: a reload re-reads `GET /settings/email`, so these values
    // came back out of the meta store rather than out of the form's own state.
    await page.reload();
    await expect(page.getByLabel('SMTP host')).toHaveValue(HOST);
    await expect(page.getByLabel('From address')).toHaveValue(FROM);
    // 587 is the form's suggestion for a first configuration; it was saved.
    await expect(page.getByLabel('Port')).toHaveValue('587');
    await expect(
      page.getByText(/cannot send password resets, user invites or scheduled reports/),
    ).toHaveCount(0);
    // Whatever the server stores, it never sends a password back. `exact`
    // because "Minimum password length" is on the same screen.
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  });

  test('removes the transport again, which is the other half of the surface', async ({ page }) => {
    await signIn(page);
    await page.goto(SETTINGS);

    await page.getByRole('button', { name: 'Remove mail server' }).click();
    const save = page.getByRole('button', { name: 'Save changes' }).first();
    await save.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Removed')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Workspace settings updated')).toBeVisible();

    await page.reload();
    await expect(
      page.getByText(/cannot send password resets, user invites or scheduled reports/),
    ).toBeVisible();
    await expect(page.getByLabel('SMTP host')).toHaveValue('');
  });
});
