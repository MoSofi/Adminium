// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A workspace of two databases, saved as one file and installed on a fresh
 * server, where the install stops part way and is finished after a reload.
 *
 * On the source, Corner Shop holds two databases, each with a table and its
 * page: the café's (on this run's engine) and the stock room's (SQLite). Save
 * workspace, on the workspace's row in Data connections, makes one file of
 * two apps, downloaded from its result dialog.
 *
 * On a fresh server, with empty databases of the same names, the file goes in
 * through the app upload, which hands it to its own review: a new workspace
 * named after the file, each app on the database of its name. Just before
 * Install, the stock room's database is held locked from outside the server,
 * so its app cannot write: the café installs, the stock room stops, and
 * nothing of it is kept. After a reload, Hosted apps still offers the file;
 * with the lock gone, Install the rest finishes it, into the same workspace.
 *
 * Both servers are this file's own (`ownApps.ts` says why).
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { ENGINE } from './constants.js';
import { addTable, connect, emptyDatabase, membersOf, olderThan, startServer, versionOf, type ChildServer, type Database } from './ownApps.js';

test.describe.configure({ mode: 'serial' });

const WORKSPACE = 'Corner Shop';
const id = { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } };
const CAFE = { name: 'cups', columns: [id, { name: 'size', logicalType: 'varchar', maxLength: 20, nullable: false }], primaryKey: ['id'] };
const STOCK = { name: 'crates', columns: [id, { name: 'label', logicalType: 'varchar', maxLength: 40, nullable: false }], primaryKey: ['id'] };

let source: ChildServer;
let target: ChildServer;
const databases: Database[] = [];
let file: Buffer;
let stockTarget: Database;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  [source, target] = await Promise.all([startServer('wsf_src', 60), startServer('wsf_dst', 80)]);
  const ids: string[] = [];
  for (const [name, engine, table] of [
    ['shop_cafe', ENGINE, CAFE],
    ['shop_stock', 'sqlite', STOCK],
  ] as const) {
    const db = await emptyDatabase(engine, `wsf_src_${name}`);
    databases.push(db);
    const connectionId = await connect(source, db, name);
    await addTable(source, connectionId, table);
    ids.push(connectionId);
  }
  await source.api.post('/workspaces', { name: WORKSPACE, connectionIds: ids });
});

test.afterAll(async () => {
  await Promise.all([source?.stop(), target?.stop()]);
  for (const db of databases) await db.drop().catch(() => undefined);
});

async function pageOn(server: ChildServer, browser: Parameters<Parameters<typeof test>[2]>[0]['browser'], path: string): Promise<Page> {
  const context = await server.context(browser);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test('Save workspace on the workspace’s row makes one file of its two apps', async ({ browser }) => {
  const page = await pageOn(source, browser, '/studio');
  const row = page.getByRole('listitem').filter({ hasText: WORKSPACE }).first();
  await row.getByRole('button', { name: 'Save workspace' }).click();
  const dialog = page.getByRole('dialog', { name: `Save ${WORKSPACE} as one file` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Include shop_cafe' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Include shop_stock' })).toBeChecked();
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();

  const saved = page.getByRole('dialog', { name: `${WORKSPACE} is saved as one file` });
  await expect(saved).toBeVisible({ timeout: 30_000 });
  await expect(saved.getByText('shop-cafe-1.0.0.tgz')).toBeVisible();
  await expect(saved.getByText('shop-stock-1.0.0.tgz')).toBeVisible();
  const pending = page.waitForEvent('download');
  await saved.getByRole('link', { name: 'Download' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('corner-shop.workspace.tgz');
  file = readFileSync(await download.path());
  const members = Object.keys(membersOf(file)).sort();
  expect(members).toEqual(['apps/shop-cafe-1.0.0.tgz', 'apps/shop-stock-1.0.0.tgz', 'manifest.json', 'workspace.json']);
  await page.context().close();
});

test('installed on a fresh server, it stops part way, and Install the rest finishes it after a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const floor = (JSON.parse(membersOf(file)['workspace.json'] ?? '{}') as { minAdminiumVersion?: string }).minAdminiumVersion ?? '0.0.0';
  const running = await versionOf(target);
  test.skip(olderThan(running, floor), `this build calls itself ${running}; the workspace file needs ${floor}, the release that carries its words`);

  const cafe = await emptyDatabase(ENGINE, 'wsf_dst_shop_cafe');
  stockTarget = await emptyDatabase('sqlite', 'wsf_dst_shop_stock');
  databases.push(cafe, stockTarget);
  await connect(target, cafe, 'shop_cafe');
  await connect(target, stockTarget, 'shop_stock');

  const page = await pageOn(target, browser, '/studio/apps');
  await page.getByRole('button', { name: 'Install an app' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'corner-shop.workspace.tgz', mimeType: 'application/gzip', buffer: file });
  await page.getByRole('button', { name: 'Upload' }).click();

  // Its own review: the file, a new workspace named after it, and each app on the database of its name.
  await expect(page.getByText('Install a workspace file')).toBeVisible();
  await expect(page.getByText('Check before you install')).toBeVisible();
  await expect(page.getByText('Workspace file', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: new RegExp(`Create workspace ${WORKSPACE}`) })).toHaveAttribute('aria-checked', 'true');
  for (const key of ['shop-cafe', 'shop-stock']) await expect(page.getByTestId(`ws-app-${key}`).getByText('Ready')).toBeVisible({ timeout: 30_000 });

  // The stock room's database is held, so its app cannot write: it stops, and the café installs.
  const release = stockTarget.lock!();
  let held = true;
  try {
    await page.getByRole('button', { name: 'Install 2 apps' }).click();
    const stopped = page.getByRole('alert').filter({ hasText: '1 of 2 installed.' });
    await expect(stopped).toBeVisible({ timeout: 60_000 });
    await expect(stopped).toContainText('stopped part way. Nothing was removed, and Install the rest finishes from where it stopped.');
  } finally {
    release();
    held = false;
  }
  expect(held).toBe(false);
  const workspaces = (await target.api.get('/workspaces')) as { workspaces: { name: string; connectionIds: string[] }[] };
  expect(workspaces.workspaces.find((one) => one.name === WORKSPACE)?.connectionIds, 'both databases joined, the stopped one’s too').toHaveLength(2);

  // After a reload, Hosted apps still offers it.
  await page.goto('/studio/apps');
  await page.reload();
  const waiting = page.getByRole('region', { name: 'Workspace files waiting' }).or(page.getByText(`${WORKSPACE}: 1 of 2 installed. The install stopped part way.`).locator('..'));
  await expect(page.getByText(`${WORKSPACE}: 1 of 2 installed. The install stopped part way.`)).toBeVisible();
  await waiting.getByRole('button', { name: 'Install the rest' }).first().click();
  const alert = page.getByRole('alert').filter({ hasText: '1 of 2 installed.' });
  const rest = alert.getByRole('button', { name: 'Install the rest' });
  await expect(rest).toBeEnabled({ timeout: 30_000 });
  await rest.click();
  await expect(page.getByText('2 of 2 apps are installed')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(`They are on`)).toContainText(WORKSPACE);
  await page.context().close();

  // One workspace, made on the first run and kept; both apps installed, each on its database.
  const after = (await target.api.get('/workspaces')) as { workspaces: { name: string }[] };
  expect(after.workspaces.filter((one) => one.name === WORKSPACE)).toHaveLength(1);
  const apps = (await target.api.get('/apps')) as { apps: { key: string }[] };
  expect(apps.apps.map((one) => one.key).sort()).toEqual(expect.arrayContaining(['shop-cafe', 'shop-stock']));
  expect(await stockTarget.dump(), 'the stock room’s table was made by Install the rest').toContain('crates');
});
