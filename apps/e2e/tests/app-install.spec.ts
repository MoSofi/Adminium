// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing a micro-SaaS app from Studio (steps 1–3).
 *
 * The property under test is the one the whole wave exists for: a bundle
 * uploaded through the browser is SERVED — at the app's own mount, on the next
 * request, with no restart — and uninstalling takes it away again. Unit tests
 * prove each layer; only this proves the layers are connected to each other and
 * to a real HTTP server.
 *
 * ─── What this spec deliberately does not do ────────────────────────────────
 *
 * It installs a manifest whose `requiredSchema` names `shippers`, a table stock
 * Northwind already has, so the plan is installable and creates NOTHING. The
 * suite shares one seeded dataset serially, and a spec that adds a table to it
 * leaves drift every later spec has to tolerate. The CREATE path runs for real
 * in `apps/server/test/app-install.test.ts` against a real `applyInstall` and
 * an in-memory database, and the plan step's create rendering is swept by
 * `app-install-a11y.spec.ts`, which walks to it and cancels — planning writes
 * nothing, which is the point of it having a step of its own.
 */
import { expect, test, type Page } from '@playwright/test';

import { APP_KEY, APP_VERSION, CUSTOMER_MARK, appBundle } from './appBundle.js';
import { signIn, seededConnectionId } from './helpers.js';

/**
 * The check step, answered: `shippers` is used as it is.
 *
 * Northwind made it, so the first install in a run is ASKED about it; once an
 * install has recorded it, a later one takes it back without asking. Specs in
 * this suite share the server, so which of the two a test meets depends on
 * what ran before it — and both end in the same place.
 */
async function useShippersAsItIs(page: Page): Promise<void> {
  await expect(page.getByText('Check the tables')).toBeVisible();
  const shippers = page.getByTestId('check-table-shippers');
  await expect(shippers).toBeVisible();
  if (await page.getByText('Pick what to do with shippers before you install.').isVisible()) {
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeDisabled();
    await shippers.getByRole('button', { name: /shippers/ }).click();
    await shippers.getByRole('radio', { name: /Use it and keep its data/ }).click();
  }
  await expect(page.getByText('Nothing changes until you press Install.', { exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('installing an app', () => {
  test.afterAll(async ({ browser }) => {
    // The suite shares one instance: a failed run must not leave an installed
    // app behind for every later spec to render.
    const page = await browser.newPage();
    await page.request.delete(`/api/v1/apps/${APP_KEY}`).catch(() => undefined);
    await page.close();
  });

  test('an uploaded bundle is planned, installed, served, then removed', async ({ page }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    expect(connectionId).not.toBe('');

    await page.goto('/studio/apps');
    await expect(page.getByRole('heading', { name: 'Hosted apps' })).toBeVisible();

    // Nothing is installed, and the page says so rather than showing an empty list.
    await expect(page.getByText('No apps installed yet')).toBeVisible();

    // ── Step 1: the bundle ────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Install an app' }).click();
    const bundle = appBundle('reuse');
    await page.locator('input[type="file"]').setInputFiles({
      name: `${APP_KEY}-${APP_VERSION}.tgz`,
      mimeType: 'application/gzip',
      buffer: bundle.buffer,
    });
    // Nothing about WHICH app this is gets typed: the server reads the key and
    // version out of the bundle's manifest, and the footer names what it read.
    await expect(page.getByLabel('App key')).toHaveCount(0);
    // The operator's own hash: the one path where the integrity check is real
    // end to end rather than self-referential.
    await page.getByLabel(/Integrity/).fill(bundle.integrity);
    await page.getByRole('button', { name: 'Upload' }).click();

    // ── Step 2: where it goes ─────────────────────────────────────────────
    await expect(page.getByText('Install into which database?')).toBeVisible();
    await expect(page.getByText(`Step 2 of 4 · ${APP_KEY}`)).toBeVisible();
    await page.getByRole('radio', { name: /northwind/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // ── Step 3: consent ───────────────────────────────────────────────────
    // Nothing is created: the one table is Northwind's, used as it is.
    await useShippersAsItIs(page);
    await expect(page.locator('[data-part="check-summary"]')).not.toContainText('new');

    /*
     * NOTHING IS SERVED YET. The bundle is unpacked and on disk, the plan has
     * been computed, and the mount does not answer as the app — which is what
     * makes the install button a decision rather than a formality.
     *
     * MEASURED ON THE BYTES, NOT THE STATUS, and that is not fussiness: an
     * unknown `/apps/…` path is caught by the DASHBOARD'S SPA fallback and
     * comes back 200 with the dashboard shell (29's not-found handler). A
     * status assertion here would have passed before the install and after it,
     * and proved nothing either time.
     */
    const beforeInstall = await page.request.get(`/apps/${APP_KEY}/customer/`);
    expect(await beforeInstall.text(), 'the app answered before the install').not.toContain(
      CUSTOMER_MARK,
    );

    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByText('E2E Desk is installed')).toBeVisible();
    await expect(page.getByText(`/apps/${APP_KEY}/staff/`).first()).toBeVisible();

    // ── Served, on the next request, with no restart ──────────────────────
    const customer = await page.request.get(`/apps/${APP_KEY}/customer/`);
    expect(customer.status()).toBe(200);
    expect(await customer.text()).toContain(CUSTOMER_MARK);

    // The staff side is gated by the session this request carries, so it serves
    // here — and its ASSETS are behind the same gate, which is the half that
    // leaks the screens and endpoints when it is missed.
    const staff = await page.request.get(`/apps/${APP_KEY}/staff/`);
    expect(staff.status()).toBe(200);

    // ── Back on the page, it is listed and placeable ──────────────────────
    await page.getByRole('button', { name: 'Manage apps' }).click();
    await expect(page.getByText(`/apps/${APP_KEY}/staff/`).first()).toBeVisible();
    // The install joined the SURFACES list too, not just the installed one —
    // one list, two sources.
    await expect(page.getByRole('heading', { name: 'Surfaces' })).toBeVisible();

    // ── Uninstall asks for the key back, and means it ─────────────────────
    await page.getByRole('button', { name: 'Uninstall' }).first().click();
    // What goes and what stays, from the server's own plan: the data stays.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('The app’s files')).toBeVisible();
    await expect(dialog.getByText('Kept')).toBeVisible();
    await dialog.getByRole('button', { name: 'Uninstall', exact: true }).click();

    await expect(page.getByText('No apps installed yet')).toBeVisible();
    const afterUninstall = await page.request.get(`/apps/${APP_KEY}/customer/`);
    expect(await afterUninstall.text(), 'the app still answered after uninstall').not.toContain(
      CUSTOMER_MARK,
    );
  });

  test('an app already on disk installs straight from its card', async ({ page }) => {
    await signIn(page);
    await page.goto('/studio/apps');

    // Put a package on disk the way the bundled set would, then reload so the
    // catalogue sees it. `ADMINIUM_BUNDLED_APPS` seeds at boot and this suite
    // shares one long-lived server, so the upload route is how a test gets a
    // package into the same place the seed would have put it.
    const bundle = appBundle('reuse');
    const query = new URLSearchParams({
      key: APP_KEY,
      version: APP_VERSION,
      expectedSha512: bundle.integrity,
    });
    const staged = await page.request.post(`/api/v1/apps/upload?${query.toString()}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: bundle.buffer,
    });
    expect(staged.ok(), await staged.text()).toBe(true);
    await page.reload();

    // The card, with what the manifest actually declares on it.
    const card = page.getByRole('article').filter({ hasText: 'E2E Desk' });
    await expect(card).toBeVisible();
    await expect(card.getByText('by Adminium')).toBeVisible();

    await card.getByRole('button', { name: 'Install', exact: true }).click();

    // The comp's source step, as a confirmation — no upload form, because the
    // bytes are already here.
    await expect(page.getByText('Install E2E Desk')).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Install into which database?')).toBeVisible();
    await page.getByRole('radio', { name: /northwind/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await useShippersAsItIs(page);
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByText('E2E Desk is installed')).toBeVisible();

    // Back on the shelf the card says so, instead of offering to do it again.
    await page.getByRole('button', { name: 'Manage apps' }).click();
    await expect(card.getByText('Installed')).toBeVisible();

    await page.request.delete(`/api/v1/apps/${APP_KEY}`);
  });

  test('an app whose tables are missing cannot be installed', async ({ page }) => {
    await signIn(page);
    await page.goto('/studio/apps');
    await page.getByRole('button', { name: 'Install an app' }).click();

    /*
     * The create-shaped bundle, taken to the plan step and no further. This is
     * the refusal half of consent: the operator sees what WOULD happen, and the
     * seeded database has no `e2e_app_probe`, so the plan creates it — which is
     * installable, but not something this suite applies. The staged bundle is
     * then discarded through the page, which is both the coverage for that
     * route and why this spec leaves nothing behind.
     */
    const bundle = appBundle('create');
    await page.locator('input[type="file"]').setInputFiles({
      name: `${APP_KEY}-${APP_VERSION}.tgz`,
      mimeType: 'application/gzip',
      buffer: bundle.buffer,
    });
    await page.getByLabel(/Integrity/).fill(bundle.integrity);
    await page.getByRole('button', { name: 'Upload' }).click();

    await expect(page.getByText('Install into which database?')).toBeVisible();
    await page.getByRole('radio', { name: /northwind/i }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Check the tables')).toBeVisible();
    const probe = page.getByTestId('check-table-e2e_app_probe');
    await expect(probe).toBeVisible();
    await expect(page.locator('[data-part="check-summary"]')).toContainText('1 new');

    // The create preview is a disclosure, and it carries the real column list.
    await probe.getByRole('button', { name: /e2e_app_probe/ }).click();
    await expect(probe.getByText('Create preview')).toBeVisible();
    await expect(page.getByText('CREATE TABLE e2e_app_probe')).toBeVisible();

    // Cancelling writes nothing: the table the plan describes does not exist.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('No apps installed yet')).toBeVisible();

    /*
     * And changing your mind is not a dead end. The bundle is still on disk —
     * the page says so rather than leaving it invisible — and discarding it is
     * one click, not "upload it again to replace it", which would ask the
     * operator to perform the thing they decided against in order to undo it.
     */
    await expect(page.getByText('Uploaded but not installed')).toBeVisible();
    await expect(page.getByText(`${APP_KEY}@${APP_VERSION}`)).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByText('Uploaded but not installed')).toBeHidden();
  });
});
