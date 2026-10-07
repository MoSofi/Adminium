// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RECORD PAGE'S OWN BUTTONS, PRESSED.
 *
 * An app's manifest puts buttons on a generated record page (`states.actions`).
 * This installs a small shop for real and presses each form a person meets:
 * a move behind a confirm, a link that opens another page with the row, a
 * move the server refuses — said in words under the record's head — and a
 * move that asks for a value first.
 *
 * The buttons need a server of 0.3.18 or later. On an older build the upload
 * is refused by name and the test is skipped, saying so: it must never pass
 * by pressing nothing.
 */
import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { gridRows, navLink, recordPage, seededConnectionId } from './helpers.js';

const KEY = 'e2e-shop';
const VERSION = '1.0.0';
const PREFIX = 'e2e_shop_';
const CUSTOMER = 'Ada of the state actions';

const id = { ref: 'id', type: 'int', role: 'pk' };

const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: KEY,
  name: 'E2E Shop',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.e2e-shop.desc', fallback: 'A shop whose orders have buttons.' },
  categories: ['crm'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'orders',
        columns: [
          id,
          { ref: 'customer', type: 'text', maxLength: 60 },
          { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'done', 'cancelled'], default: 'draft' },
          { ref: 'reason', type: 'text', maxLength: 200, nullable: true },
          { ref: 'sent_at', type: 'timestamptz', nullable: true },
        ],
        states: {
          column: 'status',
          initial: 'draft',
          moves: {
            draft: ['sent'],
            // A sent order is cancelled only once it has a line.
            sent: ['done', { to: 'cancelled', requires: { children: { order_lines: 1 } } }],
          },
          children: { order_lines: { via: 'order_id', createIn: ['draft'] } },
          lock: { when: ['sent', 'done'], except: ['reason', 'sent_at'] },
          actions: [
            { id: 'send', label: 'Send to supplier', move: { to: 'sent' }, tone: 'primary', confirm: 'Send this order?', set: { sent_at: { now: true } } },
            { id: 'close', label: 'Close order', move: { to: 'done' }, ask: ['reason'] },
            { id: 'cancel', label: 'Cancel order', move: { to: 'cancelled' }, tone: 'danger' },
            { id: 'receive', label: 'Receive', link: { page: 'e2e-shop-receipts', param: 'po' }, in: ['sent'] },
          ],
        },
      },
      {
        ref: 'order_lines',
        columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }, { ref: 'qty', type: 'int', default: 1 }],
      },
    ],
  },
  pages: [
    { ref: 'e2e-shop-orders', template: 'page-crud', title: { key: 'mft.e2e-shop.orders', fallback: 'Shop orders' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'orders' } },
    { ref: 'e2e-shop-receipts', template: 'page-crud', title: { key: 'mft.e2e-shop.receipts', fallback: 'Shop receipts' }, nav: { group: 'library', icon: 'list', order: 2 }, bindings: { rows: 'order_lines' } },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

async function bodyOf(res: APIResponse): Promise<string> {
  return res.text().catch(() => '');
}

async function ok<T>(res: APIResponse): Promise<T> {
  expect(res.ok(), `${res.url()} → ${String(res.status())} ${await bodyOf(res)}`).toBe(true);
  return (await res.json()) as T;
}

async function cleanUp(request: APIRequestContext): Promise<void> {
  await request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
}

/** The order's row, as the API reads it. */
async function orderOf(page: Page, connectionId: string, table: string, key: number): Promise<Record<string, unknown>> {
  const body = await ok<{ data: Record<string, unknown> }>(await page.request.get(`/api/v1/data/${connectionId}/${table}/${String(key)}`));
  return body.data;
}

test.describe('the buttons an app puts on a record page', () => {
  test.afterEach(async ({ page }) => {
    await cleanUp(page.request);
  });

  test('a move behind a confirm, a link with the row, a refusal in words, and a move that asks first', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto('/');
    const connectionId = await seededConnectionId(page);
    const staff = page.request;
    await cleanUp(staff);

    // ── install ───────────────────────────────────────────────────────────
    const app = bundleOf({
      'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: VERSION }),
      'manifest.json': JSON.stringify(MANIFEST),
      'staff/index.html': '<!doctype html><html><body data-app="e2e-shop-staff"></body></html>',
    });
    const upload = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: app.buffer,
    });
    const refused = upload.ok() ? '' : await bodyOf(upload);
    test.skip(refused.includes('REQUIRES_NEWER_ADMINIUM'), 'this build is older than 0.3.18: a record page takes an app\'s buttons from 0.3.18 on');
    expect(upload.ok(), refused).toBe(true);

    const install = { key: KEY, version: VERSION, connectionId };
    const { plan } = await ok<{ plan: { installable: boolean; checksum: string } }>(await staff.post('/api/v1/apps/plan', { data: install }));
    expect(plan.installable).toBe(true);
    await ok(await staff.post('/api/v1/apps/install', { data: { ...install, planChecksum: plan.checksum } }));

    const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
    const orders = schema.model.tables.find((table) => table.name === `${PREFIX}orders`)?.id;
    expect(orders, 'the app\'s orders table').toBeDefined();
    const made = await ok<{ data: { id: number } }>(await staff.post(`/api/v1/data/${connectionId}/${orders as string}`, { data: { values: { customer: CUSTOMER } } }));
    const key = made.data.id;

    // ── the record page of the new order ──────────────────────────────────
    await page.goto('/');
    await navLink(page, 'Shop orders').click();
    await gridRows(page).filter({ hasText: CUSTOMER }).first().click();
    const record = recordPage(page);
    await expect(record).toBeVisible();
    const actions = record.locator('[data-part="record-state-actions"]');
    const recordUrl = page.url();

    // A draft offers the move out of draft, and neither what a sent order offers.
    await expect(actions.getByRole('button', { name: 'Send to supplier' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Receive' })).toHaveCount(0);
    await expect(actions.getByRole('button', { name: 'Close order' })).toHaveCount(0);

    // ── a move behind a confirm ───────────────────────────────────────────
    await actions.getByRole('button', { name: 'Send to supplier' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Send this order?')).toBeVisible();
    // Nothing is made until the confirm is answered.
    expect((await orderOf(page, connectionId, orders as string, key))['status']).toBe('draft');
    await dialog.getByRole('button', { name: 'Send to supplier' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(actions.getByRole('button', { name: 'Receive' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Send to supplier' })).toHaveCount(0);
    const sent = await orderOf(page, connectionId, orders as string, key);
    expect(sent['status']).toBe('sent');
    // The time is the action's to set, at the server's clock.
    expect(sent['sent_at']).not.toBeNull();

    // ── a link opens another page with the row ────────────────────────────
    await actions.getByRole('button', { name: 'Receive' }).click();
    await expect(page).toHaveURL(new RegExp(`[?&]po=${String(key)}(?:&|$)`));
    await expect(recordPage(page)).toHaveCount(0);
    await page.goto(recordUrl);
    await expect(record).toBeVisible();

    // ── a refused move is said in words, and nothing moves ────────────────
    await actions.getByRole('button', { name: 'Cancel order' }).click();
    await expect(page.getByText(/Add at least 1 row/)).toBeVisible();
    expect((await orderOf(page, connectionId, orders as string, key))['status']).toBe('sent');

    // ── a move that asks for a value first ────────────────────────────────
    await actions.getByRole('button', { name: 'Close order' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox').fill('Collected at the desk');
    await dialog.getByRole('button', { name: 'Close order' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(actions).toHaveCount(0);
    expect(await orderOf(page, connectionId, orders as string, key)).toMatchObject({ status: 'done', reason: 'Collected at the desk' });
  });
});
