// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY, WALKED IN A BROWSER.
 *
 * The Inventory add-on as it is built in the add-ons repository, packed,
 * uploaded and installed with no app; its sample data added by the button's
 * own job; the Overview read; a delivery received against the sample's open
 * order by typing into the Receive screen; and the Overview read again.
 *
 * Needs the add-ons checkout, built (`ADMINIUM_ADD_ONS_REPO`), a server of
 * 0.3.18 or later, and the add-on's deciding file trusted
 * (`ADMINIUM_ADD_ON_DEV_TRUST=inventory`). Without one of them the test is
 * skipped and says which: it must never pass by walking nothing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seededConnectionId } from './helpers.js';

const KEY = 'inventory';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && existsSync(join(PACKAGE, 'dist', 'server.js')) && existsSync(join(PACKAGE, 'dist', 'pages', 'receive.js'));

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

test.describe('Inventory with no app', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/inventory');
  test.skip(!(process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY), 'an uploaded add-on\'s deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=inventory');

  test.afterEach(async ({ page }) => {
    await cleanUp(page.request);
  });

  test('installed from its package, its sample added, the Overview read, a delivery received', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    const connectionId = await seededConnectionId(page);
    const staff = page.request;
    await cleanUp(staff);

    // ── packed as it would be published, uploaded, installed ──────────────
    const out = mkdtempSync(join(tmpdir(), 'adminium-inventory-'));
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
    const bytes = readFileSync(join(out, packed!.filename));
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    const upload = await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(integrity)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bytes });
    const refused = upload.ok() ? '' : await bodyOf(upload);
    test.skip(refused.includes('REQUIRES_NEWER_ADMINIUM'), 'this build is older than 0.3.18: Inventory keeps tables of its own, which an add-on may from 0.3.18 on');
    expect(upload.ok(), refused).toBe(true);
    await ok(await staff.post('/api/v1/add-ons', { data: { key: KEY, version: packed!.version, attachTo: [] } }));

    // ── the sample, by the button's own job ───────────────────────────────
    await ok(await staff.post(`/api/v1/add-ons/${KEY}/sample-data`));
    await expect
      .poll(async () => (await ok<{ loaded: boolean; total: number }>(await staff.get(`/api/v1/add-ons/${KEY}/sample-data`))).total, { timeout: 120_000, intervals: [1000] })
      .toBe(2453);

    // ── the Overview, as a person opens it ────────────────────────────────
    await page.goto('/p/inventory-overview');
    const card = (title: string) => page.locator('[data-widget-id], article, section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first();
    await expect(page.getByRole('heading', { name: 'Stock value', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(card('Running low')).toContainText('5');
    await expect(card('Out')).toContainText('1');
    await expect(card('Expiring within 30 days')).toContainText('2');
    await expect(card('Orders on the way')).toContainText('1');
    await expect(card('To reorder')).toContainText('2');
    // The six places, to the cent, and the low list with the item that is out.
    for (const figure of ['$964.55', '$475.20', '$254.00', '$108.26', '$0.00']) await expect(page.getByText(figure, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('T-shirt, blue, M').first()).toBeVisible();
    await expect(page.getByText('Lidocaine 1% ampoule').first()).toBeVisible();

    // ── a delivery against the open order, typed into the Receive screen ──
    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    const tableOf = (name: string) => schema.model.tables.find((table) => table.name === `inventory_${name}`)!.id;
    const orders = await ok<{ data: { id: number; number: string }[] }>(await staff.get(`/api/v1/data/${connectionId}/${encodeURIComponent(tableOf('purchase_orders'))}?pageSize=20`));
    const open = orders.data.find((order) => order.number === 'PO-1002');
    expect(open, 'the sample\'s open order').toBeDefined();
    await page.goto(`/add-ons/inventory/inventory-receive?po=${String(open!.id)}`);
    const line = page.locator('[data-part="inventory-line"]').filter({ hasText: 'Lidocaine' }).first();
    await line.getByLabel('Receiving now').fill('5');
    await line.getByLabel('Batch').fill('LD201');
    await line.locator('input[type="date"]').fill('2029-04-30');
    await page.getByRole('button', { name: 'Post receipt', exact: true }).click();
    await expect(page.getByText('Receipt posted').first()).toBeVisible({ timeout: 60_000 });

    // Fourteen ampoules and fifty: sixty-four on hand, nothing of them on order, and the order part received.
    const points = await ok<{ data: { item_name: string; on_hand: unknown; on_order: unknown; low: unknown }[] }>(
      await staff.get(`/api/v1/data/${connectionId}/${encodeURIComponent(tableOf('stock_points'))}?pageSize=100`),
    );
    const lidocaine = points.data.find((point) => point.item_name === 'Lidocaine 1% ampoule')!;
    expect([Number(lidocaine.on_hand), Number(lidocaine.on_order), Number(lidocaine.low)]).toEqual([64, 0, 0]);
    const after = await ok<{ data: { number: string; status: string }[] }>(await staff.get(`/api/v1/data/${connectionId}/${encodeURIComponent(tableOf('purchase_orders'))}?pageSize=20`));
    expect(after.data.find((order) => order.number === 'PO-1002')?.status).toBe('part_received');

    // The Overview follows: four low, not five.
    await page.goto('/p/inventory-overview');
    await expect(page.getByRole('heading', { name: 'Running low', exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(card('Running low')).toContainText('4');

    // ── the sample out again, and the add-on with it ──────────────────────
    // What the delivery changed is the owner's now and stays (the order, its line, the stock it moved); the rest goes.
    const removed = await ok<{ removed: number; kept: number }>(await staff.post(`/api/v1/add-ons/${KEY}/sample-data/remove`, { data: { keepChanged: true } }));
    expect(removed.removed).toBeGreaterThan(2000);
    expect(removed.kept).toBeGreaterThan(0);
  });
});
