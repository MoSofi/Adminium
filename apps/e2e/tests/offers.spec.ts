// SPDX-License-Identifier: AGPL-3.0-only
/**
 * OFFERS & GIFT CARDS, WALKED IN A BROWSER.
 *
 * The add-on as it is built in the add-ons repository, packed, uploaded and
 * installed with no app; its sample data added by the button's own job; the
 * Overview read to the cent; a sample gift card looked up by its code, topped
 * up at the desk and printed; a discount made, saved and switched on; and the
 * sample taken out again.
 *
 * Needs the add-ons checkout, built (`ADMINIUM_ADD_ONS_REPO`), a server of
 * 0.3.19 or later, and the add-on's deciding file trusted
 * (`ADMINIUM_ADD_ON_DEV_TRUST=offers`). Without one of them the test is
 * skipped and says which: it must never pass by walking nothing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const KEY = 'offers';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && ['server.js', 'documents.js', 'pages/look-up.js', 'pages/discounts.js'].every((file) => existsSync(join(PACKAGE, 'dist', file)));
/** The sample card the guide quotes: $19.00 left of $50.00. */
const CARD = 'GC-7K2M-W3HN-Q4XP';

async function bodyOf(res: APIResponse): Promise<string> {
  return `${String(res.status())} ${(await res.text()).slice(0, 600)}`;
}
async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), await bodyOf(res)).toBe(true);
  return (await res.json()) as T;
}
/** Out again, with its tables: the next run starts from nothing. */
async function cleanUp(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } });
}

test.describe('Offers with no app', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/offers');
  test.skip(!(process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY), "an uploaded add-on's deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=offers");

  test.afterEach(async ({ page }) => {
    await cleanUp(page.request);
  });

  test('installed from its package, its sample added, the Overview read, a card topped up and printed, a discount made', async ({ page, context }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    const staff = page.request;
    await cleanUp(staff);

    // ── packed as it would be published, uploaded, installed ──────────────
    const out = mkdtempSync(join(tmpdir(), 'adminium-offers-'));
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
    const bytes = readFileSync(join(out, packed!.filename));
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const upload = await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bytes });
    const refused = upload.ok() ? '' : await bodyOf(upload);
    test.skip(refused.includes('REQUIRES_NEWER_ADMINIUM'), 'this build is older than 0.3.19: Offers asks a price question and brings a card in under its own code, which a server does from 0.3.19 on');
    expect(upload.ok(), refused).toBe(true);
    await ok(await staff.post('/api/v1/add-ons', { data: { key: KEY, version: packed!.version, attachTo: [] } }));

    // ── the sample, by the button's own job ───────────────────────────────
    await ok(await staff.post(`/api/v1/add-ons/${KEY}/sample-data`));
    await expect
      .poll(async () => (await ok<{ loaded: boolean; total: number }>(await staff.get(`/api/v1/add-ons/${KEY}/sample-data`))).total, { timeout: 120_000, intervals: [1000] })
      .toBe(706);

    // ── the Overview, as a person opens it ────────────────────────────────
    await page.goto('/p/offers-overview');
    const card = (title: string) => page.locator('[data-widget-id], article, section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
    await expect(page.getByRole('heading', { name: 'Owed on gift cards and credit', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(card('Owed on gift cards and credit')).toContainText('$455.25');
    await expect(card('Given last month')).toContainText('$667.66');
    await expect(card('Uses of discounts last month')).toContainText('126');
    await expect(card('Issued and topped up last month')).toContainText('$505.00');
    await expect(card('Spent from cards and credit last month')).toContainText('$238.05');
    // The month's discounts, largest first, and what staff took off by hand.
    for (const figure of ['$280.20', '$117.48', '$100.00', '$90.00', '$22.50', '$24.10', '$21.98', '$11.40']) await expect(page.getByText(figure, { exact: true }).first()).toBeVisible();

    // ── a card looked up by its code, topped up, printed ──────────────────
    await page.goto('/add-ons/offers/offers-look-up');
    const field = page.getByPlaceholder(/GC-7K2M/);
    await field.fill(CARD);
    await field.press('Enter');
    await expect(page.getByText('19.00').first()).toBeVisible({ timeout: 30_000 });
    // The code is echoed as it was typed, and shown nowhere else in full.
    await expect(page.getByText('Q4XP').first()).toBeVisible();
    await page.getByRole('button', { name: 'Top up', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/^Amount/).fill('10');
    await dialog.getByLabel(/^Why/).fill('Asked for more');
    await dialog.getByRole('button', { name: 'Top up', exact: true }).click();
    await expect(page.getByText('29.00').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Topped up').first()).toBeVisible();
    const [printed] = await Promise.all([context.waitForEvent('page', { timeout: 30_000 }), page.getByRole('button', { name: 'Print', exact: true }).click()]);
    await printed.waitForLoadState('load');
    await expect(printed.getByText(CARD)).toBeVisible({ timeout: 30_000 });
    await expect(printed.getByText(/Balance \$29\.00 on /)).toBeVisible();
    await printed.close();

    // ── a discount made, saved, switched on, found in the list ────────────
    await page.goto('/add-ons/offers/offers-discounts/new');
    await page.getByLabel(/^Name \(internal\)/).fill('Rainy day');
    await page.getByLabel(/^What customers see/).fill('10 % off on a rainy day');
    await page.getByLabel(/^Percent off/).fill('10');
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page).toHaveURL(/offers-discounts\/\d+$/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Switch on', exact: true }).click();
    // Switched on, it can be paused: the save has landed.
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto('/add-ons/offers/offers-discounts');
    const row = page.getByRole('row').filter({ hasText: 'Rainy day' });
    await expect(row).toContainText('10 % off', { timeout: 30_000 });
    await expect(row).toContainText('Active');

    // ── the sample out again; what was changed here is the owner's and stays ──
    const removed = await ok<{ removed: number; kept: number }>(await staff.post(`/api/v1/add-ons/${KEY}/sample-data/remove`, { data: { keepChanged: true } }));
    expect(removed.removed).toBeGreaterThan(600);
    expect(removed.kept).toBeGreaterThan(0);
  });
});
