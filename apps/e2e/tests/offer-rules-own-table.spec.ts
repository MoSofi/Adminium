// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OFFER RULE ON AN OWNER'S OWN TABLE.
 *
 * A shop nobody wrote an app for: two plain tables, orders and their lines,
 * made as an owner makes them. Offers is installed with no app. On Offer
 * rules the owner says the orders take discounts — the lines, their price,
 * how many, a word on the line — and lets Adminium add what is missing. The
 * sheet lists what it will add before it adds anything. Then the discount's
 * own "Try it" pane says what a code would take off an order of that shop,
 * saving nothing, and the code typed on the order takes it off for good.
 *
 * Needs what `offers.spec.ts` needs, and skips saying which is missing.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { seededConnectionId } from './helpers.js';

const KEY = 'offers';
const REPO = process.env['ADMINIUM_ADD_ONS_REPO'];
const PACKAGE = REPO === undefined || REPO === '' ? null : join(REPO, 'packages', KEY);
const built = PACKAGE !== null && ['server.js', 'pages/rules.js', 'pages/discounts.js'].every((file) => existsSync(join(PACKAGE, 'dist', file)));
const ORDERS = 'walk_orders';
const LINES = 'walk_order_lines';

async function bodyOf(res: APIResponse): Promise<string> {
  return `${String(res.status())} ${(await res.text()).slice(0, 600)}`;
}
async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), await bodyOf(res)).toBe(true);
  return (await res.json()) as T;
}

interface Schema {
  snapshotId: string;
  model: { tables: { id: string; name: string; columns: { name: string }[] }[] };
}
const schemaOf = async (request: APIRequestContext, connectionId: string) => ok<Schema>(await request.get(`/api/v1/connections/${connectionId}/schema`));
/** A change to the schema, reviewed and then applied: as Studio does it. */
async function change(request: APIRequestContext, connectionId: string, edit: Record<string, unknown>): Promise<void> {
  const base = { ...edit, baseSnapshotId: (await schemaOf(request, connectionId)).snapshotId };
  const plan = await ok<{ checksum: string }>(await request.post(`/api/v1/connections/${connectionId}/schema/plan`, { data: base }));
  await ok(await request.post(`/api/v1/connections/${connectionId}/schema/apply`, { data: { ...base, checksum: plan.checksum, acknowledgeRows: true } }));
}
/** The rule, the add-on and the two tables out again: the next run, and every other spec, starts from what was there. */
async function cleanUp(request: APIRequestContext, connectionId: string): Promise<void> {
  const tables = (await schemaOf(request, connectionId)).model.tables;
  const orders = tables.find((table) => table.name === ORDERS);
  if (orders !== undefined) await request.delete(`/api/v1/connections/${connectionId}/tables/${encodeURIComponent(orders.id)}/adjust`);
  await request.delete(`/api/v1/add-ons/${KEY}`, { data: { dropTables: true, confirmKey: KEY } });
  const mine = (await schemaOf(request, connectionId)).model.tables.filter((table) => [ORDERS, LINES, 'order_codes'].includes(table.name)).map((table) => table.id);
  // The lines and the codes point at the orders: they go first.
  for (const id of [...mine.filter((one) => !one.endsWith(ORDERS)), ...mine.filter((one) => one.endsWith(ORDERS))]) {
    const base = { dropTables: [id], baseSnapshotId: (await schemaOf(request, connectionId)).snapshotId };
    const plan = await request.post(`/api/v1/connections/${connectionId}/schema/plan`, { data: base });
    if (plan.ok()) await request.post(`/api/v1/connections/${connectionId}/schema/apply`, { data: { ...base, checksum: ((await plan.json()) as { checksum: string }).checksum, acknowledgeRows: true } });
  }
}

test.describe('an offer rule on a table of the owner\'s own', () => {
  test.skip(!built, 'the add-ons checkout is not built here: set ADMINIUM_ADD_ONS_REPO to it and run `npm run build` in packages/offers');
  test.skip(!(process.env['ADMINIUM_ADD_ON_DEV_TRUST'] ?? '').split(',').includes(KEY), "an uploaded add-on's deciding file runs only when trusted: set ADMINIUM_ADD_ON_DEV_TRUST=offers");

  test('the sheet adds what the tables lack, and a code then cuts an order of that shop', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    const connectionId = await seededConnectionId(page);
    const staff = page.request;
    await cleanUp(staff, connectionId);

    // ── Offers with no app, and its sample (the discounts and their codes) ──
    const out = mkdtempSync(join(tmpdir(), 'adminium-offers-'));
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', out], { cwd: PACKAGE!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) as { filename: string; version: string }[];
    const bytes = readFileSync(join(out, packed!.filename));
    const upload = await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(`sha512-${createHash('sha512').update(bytes).digest('base64')}`)}`, { headers: { 'content-type': 'application/octet-stream' }, data: bytes });
    const refused = upload.ok() ? '' : await bodyOf(upload);
    test.skip(refused.includes('REQUIRES_NEWER_ADMINIUM'), 'this build is older than 0.3.19: a price rule on a table, and the columns it makes, are run from 0.3.19 on');
    expect(upload.ok(), refused).toBe(true);
    try {
      await ok(await staff.post('/api/v1/add-ons', { data: { key: KEY, version: packed!.version, attachTo: [] } }));
      await ok(await staff.post(`/api/v1/add-ons/${KEY}/sample-data`));
      await expect.poll(async () => (await ok<{ total: number }>(await staff.get(`/api/v1/add-ons/${KEY}/sample-data`))).total, { timeout: 120_000, intervals: [1000] }).toBe(706);

      // ── the owner's two tables: what was sold and for how much, and nothing else ──
      await change(staff, connectionId, {
        upsertTables: [
          { name: ORDERS, columns: [{ name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } }, { name: 'note', logicalType: 'varchar' }], primaryKey: ['id'] },
        ],
      });
      const ordersId = (await schemaOf(staff, connectionId)).model.tables.find((table) => table.name === ORDERS)!.id;
      await change(staff, connectionId, {
        upsertTables: [
          {
            name: LINES,
            columns: [
              { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
              { name: 'order_id', logicalType: 'integer', nullable: false },
              { name: 'what', logicalType: 'varchar' },
              { name: 'price', logicalType: 'decimal' },
              { name: 'qty', logicalType: 'integer' },
            ],
            primaryKey: ['id'],
            foreignKeys: [{ columns: ['order_id'], toTable: ordersId, toColumns: ['id'], onDelete: 'cascade' }],
          },
        ],
      });
      const linesId = (await schemaOf(staff, connectionId)).model.tables.find((table) => table.name === LINES)!.id;

      // ── Offer rules: the sheet, as a person fills it ──────────────────────
      await page.goto('/add-ons/offers/offers-rules');
      await page.getByRole('button', { name: 'Add a rule' }).first().click();
      const sheet = page.getByRole('dialog');
      await sheet.getByLabel(/^Table/).selectOption(ordersId);
      await sheet.getByLabel(/^Its lines are rows of/).selectOption({ label: LINES });
      await sheet.getByLabel(/^The line's price/).selectOption('price');
      await sheet.getByLabel(/^The line's quantity/).selectOption('qty');
      await sheet.getByLabel(/^A word on the line/).selectOption('what');
      for (const name of [/^Make it: let Adminium add the amount/, /^Make it: add a table for the codes/]) await sheet.getByRole('switch', { name }).click();
      await sheet.getByRole('button', { name: 'Save rule', exact: true }).click();
      // Nothing is added before it is listed and agreed to.
      const agree = page.getByRole('button', { name: 'Add these and save', exact: true });
      await expect(agree).toBeVisible({ timeout: 30_000 });
      expect((await schemaOf(staff, connectionId)).model.tables.find((table) => table.name === ORDERS)!.columns.map((column) => column.name).sort()).toEqual(['id', 'note']);
      await agree.click();
      await expect(page.getByText('Takes discounts').first()).toBeVisible({ timeout: 60_000 });
      const after = (await schemaOf(staff, connectionId)).model.tables;
      expect(after.find((table) => table.name === ORDERS)!.columns.map((column) => column.name).sort()).toEqual(['discount', 'id', 'net', 'note', 'subtotal', 'total']);
      expect(after.find((table) => table.name === LINES)!.columns.map((column) => column.name)).toEqual(expect.arrayContaining(['amount', 'discount']));
      const codesId = after.find((table) => table.name === 'order_codes')!.id;

      // ── an order of that shop: two lamps and a mug, $94.00; AUTUMN5 takes five off ──
      const data = (table: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(table)}`;
      const order = (await ok<{ data: { id: number } }>(await staff.post(data(ordersId), { data: { values: { note: 'Table 4' } } }))).data;
      await ok(await staff.post(data(linesId), { data: { values: { order_id: order.id, what: 'lamp', price: '40.00', qty: 2 } } }));
      await ok(await staff.post(data(linesId), { data: { values: { order_id: order.id, what: 'mugs', price: '14.00', qty: 1 } } }));
      const figures = async () => {
        const row = (await ok<{ data: Record<string, unknown> }>(await staff.get(`${data(ordersId)}/${String(order.id)}`))).data;
        return [Number(row['subtotal']), Number(row['discount']), Number(row['total'])];
      };
      expect(await figures()).toEqual([94, 0, 94]);

      // ── the discount's own "Try it" pane, on that order: nothing is saved by trying ──
      await page.goto('/add-ons/offers/offers-discounts');
      await page.getByText('Autumn 5').first().click();
      await expect(page.getByText('Try it').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`A saved row of ${ORDERS}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('94.00').first()).toBeVisible({ timeout: 30_000 });
      const code = page.getByLabel(/^Code at checkout/);
      await code.fill('AUTUMN5');
      await code.press('Enter');
      await expect(page.getByText('89.00').first()).toBeVisible({ timeout: 30_000 });
      expect(await figures()).toEqual([94, 0, 94]);

      // ── and typed on the order itself, as a till or a form would: five off, kept ──
      await ok(await staff.post(data(codesId), { data: { values: { order_id: order.id, typed: 'autumn5' } } }));
      expect(await figures()).toEqual([94, 5, 89]);
    } finally {
      await cleanUp(staff, connectionId);
    }
    // Nothing of the walk is left behind.
    expect((await schemaOf(staff, connectionId)).model.tables.map((table) => table.name).filter((name) => [ORDERS, LINES, 'order_codes'].includes(name))).toEqual([]);
  });
});
