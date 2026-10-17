// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's roles will hold of an add-on's tables, on the install check.
 *
 * An add-on (`e2e-stock`) says how far an app's role may go on its tables
 * (`appGrants`): its items are read without their cost, its suppliers by
 * three columns and never changed, and its orders by no app at all. An app
 * (`e2e-roles`) asks for more: the cost, a supplier's address, a change to
 * it, the orders. Both are put on the server as an operator would upload them,
 * and the app's install is walked to its check, where the add-on's row says
 * how many of its tables the app's roles get and, opened, each one: what is
 * read, and what was asked for and is not given. Two roles holding the same
 * share a line.
 *
 * Opened and closed with the keyboard; in Arabic (right to left), dark, at
 * 390 pixels wide, where the lines wrap inside the add-on's row and opening
 * them widens nothing.
 * The install is never made: planning writes nothing, so the add-on's tables
 * and the app's are never created, and both packages are removed after.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { seededConnectionId, signIn } from './helpers.js';
import { textIn } from './localeText.js';

test.describe.configure({ mode: 'serial' });

const ADD_ON = 'e2e-stock';
const APP = 'e2e-roles';
const VERSION = '1.0.0';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, nullable = true) => ({ ref, type: 'text', maxLength: 120, ...(nullable ? { nullable: true } : {}) });

const ADD_ON_MANIFEST = {
  kind: 'add-on',
  manifestVersion: 1,
  key: ADD_ON,
  name: 'E2E Stock',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'addon.e2e-stock.line', fallback: 'Keeps a stock list and its suppliers.' },
  categories: ['data'],
  // The release that reads `appGrants`.
  compatibility: { minAdminiumVersion: '0.3.28', requires: [] },
  addOn: { attaches: [{ app: '*' }], connect: { kind: 'none' } },
  requiredSchema: {
    prefixed: true,
    tables: [
      { ref: 'items', columns: [id, text('name', false), text('sku'), { ref: 'cost', type: 'decimal', scale: 2, nullable: true }], appGrants: { actions: ['read'], never: ['cost'] } },
      { ref: 'suppliers', columns: [id, text('name', false), text('email'), { ref: 'lead_days', type: 'int', nullable: true }], appGrants: { actions: ['read'], readable: ['id', 'name', 'lead_days'] } },
      // Given to no app: the add-on says it of its other tables and not of this one.
      { ref: 'orders', columns: [id, text('note')] },
    ],
  },
};

const APP_MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: APP,
  name: 'E2E Roles',
  version: VERSION,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'mft.e2e-roles.desc', fallback: 'A sales desk that reads the stock list.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.3.18' },
  addOns: { suggests: [{ key: ADD_ON, range: '>=1.0.0', reason: { 'en-US': 'Shows what is in stock.' } }] },
  roles: [
    {
      key: 'desk',
      name: 'Sales desk',
      permissions: ['table:@notes:read'],
      tables: [
        { addOn: ADD_ON, table: 'items', actions: ['read'], limit: { readable: ['id', 'name', 'sku', 'cost'] } },
        { addOn: ADD_ON, table: 'suppliers', actions: ['read', 'update'], limit: { readable: ['id', 'name', 'email'], writable: ['email'] } },
        { addOn: ADD_ON, table: 'orders', actions: ['read'] },
      ],
    },
    { key: 'lead', name: 'Desk lead', cloneFrom: 'desk' },
  ],
  requiredSchema: { prefixed: true, tables: [{ ref: 'notes', columns: [id, text('body')] }] },
  pages: [{ ref: 'e2e-roles-notes', template: 'page-crud', title: { key: 'mft.e2e-roles.notes', fallback: 'Desk notes' }, nav: { group: 'library', icon: 'list', order: 13 }, bindings: { rows: 'notes' } }],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

async function upload(page: Page, kind: 'add-ons' | 'apps', files: Record<string, string>): Promise<void> {
  const bundle = bundleOf(files);
  const reply = await page.request.post(`/api/v1/${kind}/upload?expectedSha512=${encodeURIComponent(bundle.integrity)}`, {
    headers: { 'content-type': 'application/octet-stream' },
    data: bundle.buffer,
  });
  expect(reply.ok(), await reply.text()).toBe(true);
}

async function setPrefs(page: Page, theme: string | null, locale: string | null): Promise<void> {
  const reply = await page.request.patch('/api/v1/me/prefs', { data: { theme, locale } });
  expect(reply.ok(), `prefs → ${String(reply.status())}`).toBe(true);
}

/** From the shelf to the install's check step, in the reader's own language. */
async function reachCheck(page: Page, tx: ReturnType<typeof textIn>): Promise<Locator> {
  await page.goto('/studio/apps');
  const card = page.getByRole('article').filter({ hasText: 'E2E Roles' });
  await card.getByRole('button', { name: tx('studio:hostedApps.browse.install'), exact: true }).click();
  await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
  await page.getByRole('radio', { name: /northwind/i }).click();
  await page.getByRole('button', { name: tx('studio:hostedApps.install.continue') }).click();
  await expect(page.getByText(tx('studio:hostedApps.install.check.title'))).toBeVisible();
  const row = page.getByTestId('install-add-ons').locator(`[data-add-on="${ADD_ON}"]`);
  await expect(row).toBeVisible();
  return row;
}

/** Each line of the opened list: its paragraphs' words. */
const linesOf = (details: Locator): Promise<string[][]> =>
  details.locator('[data-role-table]').evaluateAll((lines) => lines.map((line) => [...line.querySelectorAll('p')].map((p) => p.textContent ?? '')));

test.describe('what an app\'s roles will hold of an add-on\'s tables, on the install check', () => {
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await signIn(page);
    // A run that stopped part way leaves nothing to trip on.
    await page.request.delete(`/api/v1/apps/${APP}`, { data: { dropTables: true, confirmKey: APP } }).catch(() => undefined);
    await upload(page, 'add-ons', { 'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${ADD_ON}`, version: VERSION }), 'manifest.json': JSON.stringify(ADD_ON_MANIFEST) });
    await upload(page, 'apps', { 'package.json': JSON.stringify({ name: `@adminium-apps/${APP}`, version: VERSION }), 'manifest.json': JSON.stringify(APP_MANIFEST), 'staff/index.html': '<!doctype html><html><body data-app="e2e-roles-staff"></body></html>' });
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.request.patch('/api/v1/me/prefs', { data: { theme: null, locale: null } }).catch(() => undefined);
    await page.request.delete(`/api/v1/apps/${APP}`, { data: { dropTables: true, confirmKey: APP } }).catch(() => undefined);
    await page.request.delete(`/api/v1/add-ons/${ADD_ON}`).catch(() => undefined);
    await page.close();
  });

  test('the server\'s check cuts each grant to the add-on\'s words and names what is left out', async ({ page }) => {
    await signIn(page);
    const connectionId = await seededConnectionId(page);
    const reply = await page.request.post('/api/v1/apps/plan', { data: { key: APP, version: VERSION, connectionId } });
    expect(reply.ok(), await reply.text()).toBe(true);
    const { plan } = (await reply.json()) as { plan: { roleTables: Record<string, unknown>[] } };
    expect(plan.roleTables.filter((entry) => entry['role'] === 'desk')).toEqual([
      { role: 'desk', roleName: 'Sales desk', addOn: ADD_ON, table: 'items', actions: ['read'], readable: ['id', 'name', 'sku'], narrowed: { actions: [], readable: ['cost'] }, skipped: 'ceiling' },
      { role: 'desk', roleName: 'Sales desk', addOn: ADD_ON, table: 'suppliers', actions: ['read'], readable: ['id', 'name'], narrowed: { actions: ['update'], readable: ['email'] }, skipped: 'ceiling' },
      { role: 'desk', roleName: 'Sales desk', addOn: ADD_ON, table: 'orders', actions: [], narrowed: { actions: ['read'] }, skipped: 'not-offered' },
    ]);
  });

  test('the add-on\'s row lists each table with its columns, opened and closed with the keyboard', async ({ page }) => {
    await signIn(page);
    await setPrefs(page, 'light', null);
    const row = await reachCheck(page, textIn('en-US'));
    const details = row.locator('details[data-part="add-on-role-tables"]');
    const summary = details.locator('summary');
    await expect(summary).toHaveText('E2E Roles’s roles get 2 of its tables. See what they read and change.');
    await expect(details).not.toHaveAttribute('open', '');

    // Reached with the keyboard: Tab moves onto it from the control before it, Enter opens it, Enter closes it.
    await summary.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(summary).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(details).toHaveAttribute('open', '');
    expect(await linesOf(details)).toEqual([
      ['itemsSales desk and Desk lead', 'Reads id, name, sku', 'Asked for, not given: cost'],
      ['suppliersSales desk and Desk lead', 'Reads id, name', 'Asked for, not given: change rows, email'],
      ['ordersSales desk and Desk lead', 'Not given: E2E Stock shares this table with no app.'],
    ]);
    await expect(details.getByText('A read also shows each row’s key and its links to other rows.')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(details).not.toHaveAttribute('open', '');
  });

  test('in Arabic, right to left, dark, at 390 pixels: the same list, inside its row, widening nothing', async ({ page }) => {
    await signIn(page);
    await setPrefs(page, 'dark', 'ar_EG');
    await page.setViewportSize({ width: 390, height: 844 });
    const tx = textIn('ar-EG');
    const row = await reachCheck(page, tx);
    const probe = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), dir: document.documentElement.getAttribute('dir') }));
    expect(probe).toEqual({ theme: 'dark', dir: 'rtl' });

    const details = row.locator('details[data-part="add-on-role-tables"]');
    const summary = details.locator('summary');
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
    // The wizard's own frame is wider than 390 already (its step bar and header); the list must add nothing to it.
    const before = await wide();
    await summary.focus();
    await page.keyboard.press('Space');
    await expect(details).toHaveAttribute('open', '');
    const lines = await linesOf(details);
    expect(lines.map((line) => line.slice(1))).toEqual([
      [tx('studio:appAddOns.roleTables.reads', { columns: 'id, name, sku' }), tx('studio:appAddOns.roleTables.notGiven', { what: 'cost' })],
      [tx('studio:appAddOns.roleTables.reads', { columns: 'id, name' }), tx('studio:appAddOns.roleTables.notGiven', { what: `${tx('studio:appAddOns.roleTables.action.update')}, email` })],
      [tx('studio:appAddOns.roleTables.notOffered', { addOn: 'E2E Stock' })],
    ]);
    // The table's own name reads left to right inside the right-to-left line.
    await expect(details.locator('[data-role-table="items"] [dir="ltr"]')).toHaveText('items');
    // Every line sits inside the row, and opening the list pushes nothing sideways.
    expect(await wide()).toBeLessThanOrEqual(before);
    const box = await row.boundingBox();
    for (const line of await details.locator('[data-role-table]').all()) {
      const lineBox = await line.boundingBox();
      expect(lineBox!.x).toBeGreaterThanOrEqual(box!.x - 1);
      expect(lineBox!.x + lineBox!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
    }
    // Painted on the dark theme: the line's surface is not the light one.
    const surface = await details.locator('[data-role-table]').first().evaluate((line) => getComputedStyle(line).backgroundColor);
    expect(surface).not.toBe('rgb(255, 255, 255)');
  });
});
