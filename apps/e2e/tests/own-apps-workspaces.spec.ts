// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Workspaces: groups of a server's databases, and one menu per group.
 *
 * A server of three databases: its seeded one, Fernhill's and Kiln's (on this
 * run's engine). Fernhill Coffee holds Fernhill and Kiln; Kiln Street Pottery
 * holds Kiln alone, so Kiln's database is in two workspaces. Then:
 *
 *  - One at a time: the card names the tab's workspace, its block holds its
 *    databases' pages, Shared and the platform rows come once, and another
 *    database's pages are not in the menu. The card's menu moves the tab to
 *    the other workspace, where Kiln's pages are too.
 *  - All in one menu: a block per workspace, Other databases last, Kiln's page
 *    in both blocks, and one `aria-current` among the copies.
 *  - A second session's menu changes, without a reload, when the first one
 *    switches the view for everyone.
 *  - Invoices & Receipts (with the add-on bundle) installed on Fernhill and on
 *    Kiln: two installs, each with its own settings; a request that names
 *    neither is refused rather than given one; each copy has its own section
 *    in the menu; and taking one away leaves the other serving.
 *
 * The server is this file's own (`ownApps.ts` says why).
 */
import { expect, test, type Browser, type Page } from '@playwright/test';

import { ENGINE } from './constants.js';
import { ADD_ONS_BUNDLE, addTable, connect, emptyDatabase, startServer, type ChildServer, type Database } from './ownApps.js';

test.describe.configure({ mode: 'serial' });

const FERNHILL = 'Fernhill Coffee';
const KILN = 'Kiln Street Pottery';

let server: ChildServer;
const databases: Database[] = [];
const ids = { fernhill: '', kiln: '' };

const id = { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startServer('ws', 60, { addOns: true });
  for (const [key, table] of [
    ['fernhill', { name: 'beans', columns: [id, { name: 'origin', logicalType: 'varchar', maxLength: 80, nullable: false }], primaryKey: ['id'] }],
    ['kiln', { name: 'pieces', columns: [id, { name: 'title', logicalType: 'varchar', maxLength: 80, nullable: false }], primaryKey: ['id'] }],
  ] as const) {
    const db = await emptyDatabase(ENGINE, `ws_${key}`);
    databases.push(db);
    ids[key] = await connect(server, db, key);
    await addTable(server, ids[key], table);
  }
});

test.afterAll(async () => {
  await server?.stop();
  for (const db of databases) await db.drop().catch(() => undefined);
});

/** Today's rail: one navigation. A grouped one is a navigation per block, then Server. */
const rail = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
/** The card at the top of the menu: the tab's workspace, or the server's name in All in one menu. */
const card = (page: Page, label: RegExp) => page.locator('[data-part="workspace-card"]').filter({ hasText: label });

async function openOn(browser: Browser, path: string): Promise<Page> {
  const context = await server.context(browser);
  const page = await context.newPage();
  await page.goto(path);
  // The menu is up: today's rail is one "Primary" navigation; a grouped one starts with its card.
  await expect(rail(page).or(page.locator('[data-part="workspace-card"]')).first()).toBeVisible();
  return page;
}

test('workspaces made in Data connections group the menu, One at a time', async ({ browser }) => {
  const page = await openOn(browser, '/studio');
  // Before any workspace, the menu is today's: every database's pages together.
  await expect(card(page, /Workspace/)).toHaveCount(0);
  await expect(rail(page).getByRole('link', { name: 'Beans' })).toBeVisible();

  // The first workspace, made in its dialog.
  await page.getByRole('button', { name: 'New workspace' }).click();
  const dialog = page.getByRole('dialog', { name: 'New workspace' });
  await expect(dialog.getByTestId('first-workspace-notice')).toBeVisible();
  await dialog.getByLabel('Name').fill(FERNHILL);
  await dialog.getByRole('checkbox', { name: 'fernhill' }).check();
  await dialog.getByRole('checkbox', { name: 'kiln' }).check();
  await dialog.getByRole('button', { name: 'Create workspace' }).click();
  await expect(dialog).toBeHidden();
  // The second holds Kiln too: one database, two workspaces.
  await server.api.post('/workspaces', { name: KILN, connectionIds: [ids.kiln] });
  const defaults = (await server.api.get('/settings/defaults')) as { data: Record<string, unknown> };
  await server.api.put('/settings/defaults', { ...defaults.data, workspaceView: 'one' });

  await page.reload();
  await expect(card(page, new RegExp(`Workspace\\s*${FERNHILL}`))).toBeVisible();
  const block = page.getByRole('navigation', { name: FERNHILL });
  await expect(block.getByRole('link', { name: 'Beans' })).toBeVisible();
  await expect(block.getByRole('link', { name: 'Pieces' })).toBeVisible();
  // The seeded database is in no workspace: its pages are not in this one's menu.
  await expect(page.getByRole('link', { name: 'Customers' })).toHaveCount(0);
  // Shared and the platform rows, once.
  const shared = page.getByRole('navigation', { name: 'Server' });
  await expect(shared.getByRole('link', { name: 'People' })).toHaveCount(1);

  // The card's menu moves the tab, and ticks where it is.
  await card(page, new RegExp(`Workspace\\s*${FERNHILL}`)).click();
  const menu = page.getByRole('dialog', { name: /^Workspaces on / });
  const rows = menu.locator('[data-part="workspace-menu-row"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(menu.getByText('Applies to everyone on this server.')).toBeVisible();
  await rows.filter({ hasText: KILN }).click();
  await expect(card(page, new RegExp(`Workspace\\s*${KILN}`))).toBeVisible();
  const kiln = page.getByRole('navigation', { name: KILN });
  await expect(kiln.getByRole('link', { name: 'Pieces' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Beans' })).toHaveCount(0);
  await page.context().close();
});

test('All in one menu shows each workspace, Kiln’s page in both, with one aria-current; a second session follows without a reload', async ({ browser }) => {
  // The landing page is the seeded database's, which is in no workspace: both tabs go to Other databases.
  const first = await openOn(browser, '/');
  const second = await openOn(browser, '/');
  for (const page of [first, second]) await expect(card(page, /Not in a workspace\s*Other databases/i)).toBeVisible();

  // The view is switched for everyone, from the first session's card menu.
  await card(first, /Other databases/).click();
  const menu = first.getByRole('dialog', { name: /^Workspaces on / });
  await menu.getByRole('radio', { name: 'All in one menu' }).click();
  await first.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  for (const page of [first, second]) {
    // The second session never reloads: the change reaches it over the realtime channel.
    const all = page.getByRole('navigation', { name: 'All workspaces' });
    await expect(all).toBeVisible({ timeout: 20_000 });
    await expect(all.locator('[data-part="nav-workspace-block"]')).toHaveCount(3);
    await expect(all.getByRole('link', { name: /^Pieces/ })).toHaveCount(2);
    await expect(all.getByRole('link', { name: 'Customers' })).toBeVisible();
  }
  await expect(card(second, /Server/)).toBeVisible();

  // Open Kiln's page: of its two copies in the menu, one is current; the other says where it is.
  await first.getByRole('navigation', { name: 'All workspaces' }).getByRole('link', { name: /^Pieces/ }).first().click();
  await expect(first.locator('[data-part="nav-workspaces"] [aria-current="page"], [data-part="nav-server"] [aria-current="page"]')).toHaveCount(1);
  await expect(first.getByRole('navigation', { name: 'All workspaces' }).getByRole('link', { name: /Pieces \(also in / })).toHaveCount(1);
  await first.context().close();
  await second.context().close();
});

test('Invoices & Receipts installed on two databases keeps two installs apart', async ({ browser }) => {
  test.skip(ADD_ONS_BUNDLE === '', 'needs E2E_ADD_ONS_BUNDLE: a folder with the pinned invoices tarball (fixtures/own-apps-kiln/README.md)');
  const api = server.api;
  const catalog = (await api.get('/add-ons/catalog')) as { addOns: { key: string; version: string; state: string }[] };
  const invoices = catalog.addOns.find((one) => one.key === 'invoices');
  expect(invoices?.state, 'the bundled invoices add-on is staged').toMatch(/staged|installed/);
  for (const connectionId of [ids.fernhill, ids.kiln]) await api.post('/add-ons', { key: 'invoices', version: invoices!.version, attachTo: [], connectionId });

  // Each install keeps its own settings.
  await api.put(`/add-ons/invoices/settings?connectionId=${ids.fernhill}`, { values: { business_name: FERNHILL, payment_instructions: 'Pay Fernhill by bank transfer.' } });
  await api.put(`/add-ons/invoices/settings?connectionId=${ids.kiln}`, { values: { business_name: KILN, payment_instructions: 'Pay at the studio counter, 14 Kiln Street.' } });
  type Listed = { key: string; settingValues: Record<string, unknown> };
  const listed = ((await api.get('/add-ons')) as { addOns: Listed[] }).addOns.filter((one) => one.key === 'invoices');
  expect(listed).toHaveLength(2);
  expect(listed.map((one) => [one.settingValues['business_name'], one.settingValues['payment_instructions']]).sort()).toEqual([
    [FERNHILL, 'Pay Fernhill by bank transfer.'],
    [KILN, 'Pay at the studio counter, 14 Kiln Street.'],
  ]);

  // A request that names no install is refused, never given one of the two.
  const ambiguous = await api.put('/add-ons/invoices/settings', { values: { business_name: 'Which one?' } }, { allow: [409] });
  expect(JSON.stringify(ambiguous)).toContain('APP_INSTALL_AMBIGUOUS');

  // Each copy's own page opens at its own address: the first install keeps the plain one, Kiln's is `invoices~kiln`.
  const page = await openOn(browser, '/');
  for (const address of ['invoices', 'invoices~kiln']) {
    await page.goto(`/add-ons/${address}/documents`);
    await expect(page.getByText('This page failed to render')).toHaveCount(0);
    await expect(page.locator('main')).toContainText('No templates yet', { timeout: 20_000 });
  }

  // Fernhill's copy is switched off, then taken away: Kiln's still serves, with its own settings.
  await api.patch(`/add-ons/invoices?connectionId=${ids.fernhill}`, { attachedTo: 'dashboard', enabled: false });
  await page.goto('/add-ons/invoices~kiln/documents');
  await expect(page.locator('main')).toContainText('No templates yet', { timeout: 20_000 });
  await api.req('DELETE', `/add-ons/invoices?connectionId=${ids.fernhill}`, { confirmKey: 'invoices' });
  const left = ((await api.get('/add-ons')) as { addOns: Listed[] }).addOns.filter((one) => one.key === 'invoices');
  expect(left).toHaveLength(1);
  expect(left[0]!.settingValues).toMatchObject({ business_name: KILN, payment_instructions: 'Pay at the studio counter, 14 Kiln Street.' });
  // With one install left, a request that names none means it.
  await api.put('/add-ons/invoices/settings', { values: { business_name: KILN, payment_instructions: 'Pay at the studio counter, 14 Kiln Street.' } });
  await page.goto('/add-ons/invoices~kiln/documents');
  await expect(page.locator('main')).toContainText('No templates yet', { timeout: 20_000 });
  await page.context().close();
});
