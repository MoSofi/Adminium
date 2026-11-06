// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A database saved as an app on one server, and installed on another.
 *
 * The source is Kiln Street Pottery (`fixtures/own-apps-kiln`), built from
 * nothing through the API on a database of this run's engine, with a role, a
 * welcome mail and two rules added. It is saved through Save as app's wizard,
 * downloaded, and uploaded on a FRESH server through the install review, onto
 * an empty database of each other engine this run can reach: a Postgres or
 * MySQL source lands on SQLite, a SQLite source on Postgres and MySQL (or, on
 * a run that has only SQLite, on a fresh SQLite). Then, on that target:
 *
 *  - the tables match the source's by introspection, and the pages, the role,
 *    the rules, the mail, the option list, the payments setup and (with the
 *    add-on bundle) the document profile arrive; the rule that sends data out
 *    arrives switched off and empty;
 *  - version 2, saved from the source, arrives as an update of every copy, and
 *    a page edited on the target keeps its edit;
 *  - a copy of the source database, installed with "use the existing tables",
 *    runs no DDL: its schema dump is the same before and after;
 *  - a file edited by hand to switch a webhook on, with an address, still
 *    arrives with the rule switched off and the address empty;
 *  - Kiln's mail is sent as Kiln: its database's workspace has a sender, and a
 *    new member's welcome leaves from it.
 *
 * Both servers are this file's own (`ownApps.ts` says why).
 */
import { readFileSync } from 'node:fs';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { buildKiln, type KilnBuilt } from '../fixtures/own-apps-kiln/build.mjs';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ENGINE } from './constants.js';
import {
  ADD_ONS_BUNDLE,
  addTable,
  connect,
  emptyDatabase,
  fingerprintOf,
  membersOf,
  repack,
  skipUnlessInstallable,
  startServer,
  tablesOf,
  targetEngines,
  uploadFile,
  type ChildServer,
  type Database,
} from './ownApps.js';

test.describe.configure({ mode: 'serial' });

const KEY = 'kiln-street';
const NAME = 'Kiln Street Pottery';
const TABLES = ['members', 'classes', 'firings', 'pieces', 'shop_orders'] as const;
const WEBHOOK = 'https://hooks.example.test/kiln-log';
const withAddOn = ADD_ONS_BUNDLE !== '';

let source: ChildServer;
let target: ChildServer;
let kiln: KilnBuilt;
let sourceDb: Database;
const targets: { db: Database; connectionId: string; name: string }[] = [];
const databases: Database[] = [];
/** The saved files, as downloaded from the source. */
const files: Record<string, { bytes: Buffer; fingerprint: string }> = {};

interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  connectionId: string | null;
  graph: { nodes: { id: string; kind: string; action?: Record<string, unknown> }[] };
}

/** On the source: what a person adds around the tables before saving (a role, a welcome mail, two rules). */
async function aroundTheTables(): Promise<void> {
  const api = source.api;
  const conn = kiln.connectionId;
  const role = (await api.post('/roles', { name: 'Studio staff' })) as { id: string };
  await api.put(`/roles/${role.id}/permissions`, {
    grants: [`table:${conn}:${kiln.tables.members}:read`, `table:${conn}:${kiln.tables.members}:update`, `table:${conn}:${kiln.tables.classes}:read`],
    rows: {},
  });
  const template = (await api.post('/email-templates', { kind: 'template', name: 'Welcome member', starter: null })) as { id: string; key: string };
  await api.put(`/email-templates/${template.id}`, {
    name: 'Welcome member',
    category: 'lifecycle',
    enabled: true,
    document: {
      subject: 'Welcome to the studio, {{record.name}}',
      preheader: 'Your wheel is waiting',
      footer: '',
      brand: null,
      attachments: [],
      blocks: [{ id: 'b_1', block: 'email.text', data: { paras: ['Hello {{record.name}}, your membership starts today.'] }, style: {} }],
    },
  });
  const trigger = { id: 't', kind: 'trigger', title: 'When it happens' };
  await api.post('/automations', {
    name: 'Welcome new members',
    connectionId: conn,
    enabled: true,
    trigger: { kind: 'record', event: 'created', connectionId: conn, table: kiln.tables.members },
    graph: { version: 1, nodes: [trigger, { id: 'm', kind: 'action', title: 'Welcome them', action: { kind: 'email', templateKey: template.key, to: { kind: 'field', column: 'email' } } }] },
  });
  await api.post('/automations', {
    name: 'Tell the kiln log',
    connectionId: conn,
    enabled: true,
    trigger: { kind: 'record', event: 'updated', connectionId: conn, table: kiln.tables.firings },
    graph: {
      version: 1,
      nodes: [trigger, { id: 'w', kind: 'action', title: 'Post the firing', action: { kind: 'webhook', url: WEBHOOK, method: 'POST', bodyKind: 'json', body: '{"status":"{{record.status}}"}' } }],
    },
  });
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  [source, target] = await Promise.all([startServer('src', 60, { addOns: true }), startServer('dst', 80, { addOns: true })]);
  sourceDb = await emptyDatabase(ENGINE, 'kiln_src');
  databases.push(sourceDb);
  kiln = await buildKiln({ url: source.url, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, dsn: sourceDb.dsn, engine: ENGINE, addOn: withAddOn });
  await aroundTheTables();
});

test.afterAll(async () => {
  await Promise.all([source?.stop(), target?.stop()]);
  for (const db of databases) await db.drop().catch(() => undefined);
});

async function contextOn(server: ChildServer, browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await server.context(browser);
  return { context, page: await context.newPage() };
}

/** Save the file on the Download step and read it back; the server keeps the same fingerprint. */
async function download(page: Page, version: string): Promise<{ bytes: Buffer; fingerprint: string }> {
  await expect(page.getByRole('heading', { name: 'Download' })).toBeVisible();
  await expect(page.getByText(`${KEY}-${version}.tgz`)).toBeVisible();
  const pending = page.waitForEvent('download');
  await page.locator('footer').getByRole('button', { name: 'Download', exact: true }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe(`${KEY}-${version}.tgz`);
  const bytes = readFileSync(await file.path());
  const saves = (await source.api.get('/apps/saves')) as { saves: { key: string; version: string; integrity: string }[] };
  const kept = saves.saves.find((one) => one.key === KEY && one.version === version);
  expect(kept?.integrity, 'the fingerprint kept is the one of the bytes downloaded').toBe(fingerprintOf(bytes));
  await expect(page.getByText(kept!.integrity.slice(0, 20))).toBeVisible();
  return { bytes, fingerprint: kept!.integrity };
}

/** Upload a file on the target's Hosted apps page; leaves the page on whatever the upload answers. */
async function upload(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page.goto('/studio/apps');
  await page.getByRole('button', { name: 'Install an app' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/gzip', buffer: bytes });
  await page.getByRole('button', { name: 'Upload' }).click();
}

const rulesOn = async (server: ChildServer, connectionId: string): Promise<Rule[]> =>
  ((await server.api.get('/automations')) as { rules: Rule[] }).rules.filter((rule) => rule.connectionId === connectionId);

test('Kiln is saved through the Save as app wizard and downloaded with its fingerprint', async ({ browser }) => {
  const { context, page } = await contextOn(source, browser);
  await page.goto('/studio/apps');
  await expect(page.getByRole('heading', { name: 'Hosted apps' })).toBeVisible();

  // Two databases here (the seeded one and Kiln): the button asks which.
  await page.getByRole('button', { name: 'Save as app' }).first().click();
  await expect(page.getByText('Save which database?')).toBeVisible();
  await page.getByRole('menuitem', { name: new RegExp(NAME) }).click();

  const quick = page.getByRole('dialog', { name: `Save ${NAME} as an app` });
  await expect(quick).toBeVisible();
  await quick.getByLabel('Key').fill(KEY);
  await expect(quick.getByLabel('Version')).toHaveValue('1.0.0');
  await expect(quick.getByText(/5 tables, 11 pages, 1 role, 2 automations and \d+ more things/)).toBeVisible();
  await quick.getByRole('button', { name: 'More choices' }).click();

  // The wizard: What to include → About the app → Check → Download.
  await expect(page.getByRole('heading', { name: 'What to include' })).toBeVisible();
  // Every group is folded; Tables opens on Kiln's five.
  await page.getByRole('button', { name: /^Tables 5/ }).click();
  for (const table of TABLES) await expect(page.getByText(table, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'About the app' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue(NAME);
  await expect(page.getByText(`No other app uses ${KEY}`)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Check' })).toBeVisible();
  // What cannot travel is named, not dropped in silence: the endpoint no saved key serves.
  await expect(page.getByText(/upcoming_classes/).first()).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeEnabled({ timeout: 20_000 });
  await save.click();
  files['1.0.0'] = await download(page, '1.0.0');

  // The saved file holds what was made around the tables; the webhook's address never travels.
  const manifest = JSON.parse(membersOf(files['1.0.0'].bytes)['manifest.json'] ?? '{}') as Record<string, unknown>;
  expect(JSON.stringify(manifest)).not.toContain(WEBHOOK);
  expect(manifest['provenance']).toMatchObject({ lineage: expect.any(String) as unknown });
  await context.close();
});

test('the file installs through the upload and review on a fresh server, on each other engine', async ({ browser }) => {
  test.setTimeout(240_000);
  const v1 = files['1.0.0']!;
  await skipUnlessInstallable(target, v1.bytes);
  const { context, page } = await contextOn(target, browser);
  for (const engine of targetEngines()) {
    const db = await emptyDatabase(engine, `kiln_${engine}`);
    databases.push(db);
    const name = `kiln_${engine}`;
    targets.push({ db, connectionId: await connect(target, db, name), name });
  }

  for (const [n, { name }] of targets.entries()) {
    await upload(page, `${KEY}-1.0.0.tgz`, v1.bytes);
    if (n > 0) {
      // A copy is on another database already: the file installs another one.
      await expect(page.getByText(`Install ${NAME} on another database`)).toBeVisible();
      await page.getByRole('button', { name: 'Install on another database' }).click();
    }
    await expect(page.getByText('Install into which database?')).toBeVisible();
    await page.getByRole('radio', { name: new RegExp(name) }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Check before you install')).toBeVisible();
    await expect(page.getByText('Your own app')).toBeVisible();
    // The fingerprint shown when it was saved, checked against the file uploaded.
    await page.getByLabel('Check against the fingerprint shown when it was saved').fill(v1.fingerprint);
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.getByText('Matches. This is the file that was saved.')).toBeVisible();
    // The rule that sends data out is listed, switched off.
    await expect(page.getByText('These rules would send data out')).toBeVisible();

    const install = page.getByRole('button', { name: 'Install', exact: true });
    await expect(install).toBeEnabled();
    await install.click();
    await expect(page.getByText(new RegExp(`${NAME} 1\\.0\\.0 is installed on ${name}`))).toBeVisible({ timeout: 60_000 });
  }
  await context.close();
});

test('each target has what the source has: tables by introspection, pages, role, rules, mail and setup', async () => {
  test.skip(targets.length === 0, 'nothing was installed');
  const want = await tablesOf(source, kiln.connectionId, TABLES);
  for (const t of TABLES) expect(want[t]?.length, `${t} on the source`).toBeGreaterThan(1);

  type PageRow = { id: string; connectionId: string | null; slug: string; title: string; type: string };
  const allPages = async (server: ChildServer) => ((await server.api.get('/pages')) as { data: PageRow[] }).data;
  const sourcePages = (await allPages(source)).filter((p) => p.connectionId === kiln.connectionId);
  const titles = (rows: PageRow[]) => rows.map((p) => `${p.type} ${p.title}`).sort();
  const targetPages = await allPages(target);

  for (const { connectionId, name } of targets) {
    expect(await tablesOf(target, connectionId, TABLES), `tables on ${name}`).toEqual(want);
    expect(titles(targetPages.filter((p) => p.connectionId === connectionId)), `pages on ${name}`).toEqual(titles(sourcePages));

    const rules = await rulesOn(target, connectionId);
    expect(rules.map((r) => r.name).sort()).toEqual(['Tell the kiln log', 'Welcome new members']);
    expect(rules.find((r) => r.name === 'Welcome new members')?.enabled).toBe(true);
    const out = rules.find((r) => r.name === 'Tell the kiln log')!;
    expect(out.enabled, 'a rule that sends data out arrives switched off').toBe(false);
    expect(out.graph.nodes.find((node) => node.id === 'w')?.action?.['url'] ?? null).toBeNull();

    const payables = ((await target.api.get('/payments/payables')) as { data: { profiles: { connectionId: string; tableName: string }[] } }).data.profiles;
    expect(payables.some((p) => p.connectionId === connectionId && p.tableName.endsWith('shop_orders'))).toBe(true);
    if (withAddOn) {
      const profiles = ((await target.api.get('/documents/profiles')) as { profiles: { connectionId: string; name: string }[] }).profiles;
      expect(profiles.some((p) => p.connectionId === connectionId && p.name === 'Shop receipt')).toBe(true);
    }
  }
  // The option list arrives under the app's own key, with its five glazes.
  const lists = ((await target.api.get('/option-lists')) as { lists: { key: string; name: string; items: unknown[] }[] }).lists;
  expect(lists.find((list) => list.name === 'Glazes' && list.key !== 'glazes')?.items).toHaveLength(5);
  const roles = ((await target.api.get('/roles')) as { roles: { name: string }[] }).roles;
  expect(roles.some((role) => role.name === 'Studio staff')).toBe(true);
});

test('version 2 arrives as an update of every copy, and a page edited on the target keeps its edit', async ({ browser }) => {
  test.setTimeout(240_000);
  test.skip(targets.length === 0, 'nothing was installed');
  // On the target: a person renames the members page of the first copy.
  type PageRow = { id: string; connectionId: string | null; slug: string; title: string };
  const pagesOn = async (connectionId: string) => ((await target.api.get('/pages')) as { data: PageRow[] }).data.filter((p) => p.connectionId === connectionId);
  const first = targets[0]!;
  const members = (await pagesOn(first.connectionId)).find((p) => p.title === 'Members')!;
  expect(members, 'the members page').toBeDefined();
  await target.api.patch(`/pages/${members.id}`, { title: 'Our potters' });

  // On the source: a new table, then "Save a newer version".
  await addTable(source, kiln.connectionId, {
    name: 'glaze_tests',
    columns: [
      { name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } },
      { name: 'glaze', logicalType: 'varchar', maxLength: 40, nullable: false },
      { name: 'tested_on', logicalType: 'date', nullable: false },
    ],
    primaryKey: ['id'],
  });
  const { context, page } = await contextOn(source, browser);
  await page.goto('/studio/apps');
  await expect(page.getByText('Saved from here')).toBeVisible();
  await page.getByRole('button', { name: 'Save a newer version' }).first().click();
  const quick = page.getByRole('dialog', { name: `Save ${NAME} as an app` });
  await expect(quick.getByLabel('Version')).toHaveValue('1.0.1');
  await expect(quick.getByLabel('Key')).toHaveValue(KEY);
  await expect(quick.getByText('Ready to save')).toBeVisible({ timeout: 20_000 });
  await quick.getByRole('button', { name: 'Save', exact: true }).click();
  files['1.0.1'] = await download(page, '1.0.1');
  await context.close();

  // On the target: the file is newer than every copy, so each copy is updated through its own review.
  const on = await contextOn(target, browser);
  await upload(on.page, `${KEY}-1.0.1.tgz`, files['1.0.1'].bytes);
  await expect(on.page.getByText(`Update ${NAME} to 1.0.1`)).toBeVisible();
  await on.page.getByRole('button', { name: /^Update every copy/ }).click();
  for (const { name } of targets) {
    const dialog = on.page.getByRole('dialog', { name: `Update ${NAME} on ${name} to v1.0.1` });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    const update = dialog.getByRole('button', { name: 'Update', exact: true });
    await expect(update).toBeEnabled({ timeout: 20_000 });
    await update.click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
  }
  await expect(on.page.getByText(`${NAME} is on 1.0.1 on every database.`)).toBeVisible({ timeout: 30_000 });
  await on.context.close();

  for (const { connectionId, name } of targets) {
    const pages = await pagesOn(connectionId);
    expect(pages.some((p) => p.title === 'Glaze Tests'), `the new table's page on ${name}`).toBe(true);
    expect((await tablesOf(target, connectionId, ['glaze_tests']))['glaze_tests']?.length, `glaze_tests on ${name}`).toBe(3);
  }
  const kept = (await pagesOn(first.connectionId)).find((p) => p.id === members.id);
  expect(kept?.title, 'the page edited on the target keeps its edit').toBe('Our potters');
});

test('a copy of the source database, with "use the existing tables", installs with no DDL', async ({ browser }) => {
  test.setTimeout(240_000);
  const latest = files['1.0.1'] ?? files['1.0.0']!;
  await skipUnlessInstallable(target, latest.bytes);
  // A Postgres copy is made from the source as a template, which wants no other session on it: the source is done.
  await source.stop();
  const copy = await sourceDb.copy('kiln_copy');
  databases.push(copy);
  const copyId = await connect(target, copy, 'kiln_copy');
  const before = await copy.dump();

  const { context, page } = await contextOn(target, browser);
  const version = files['1.0.1'] === undefined ? '1.0.0' : '1.0.1';
  await upload(page, `${KEY}-${version}.tgz`, latest.bytes);
  if (targets.length > 0) {
    await expect(page.getByText(`Install ${NAME} on another database`)).toBeVisible();
    await page.getByRole('button', { name: 'Install on another database' }).click();
  }
  await page.getByRole('radio', { name: /kiln_copy/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Check before you install')).toBeVisible();

  const tableCount = files['1.0.1'] === undefined ? 5 : 6;
  await expect(page.getByText(`${String(tableCount)} tables already exist here with these names.`)).toBeVisible();
  await page.getByRole('button', { name: 'Use the existing tables' }).click();
  await expect(page.getByText(`${String(tableCount)} used as they are · 0 changes to them`)).toBeVisible();
  // Connecting the copy made its own pages, at the addresses the app's pages take: each is as Adminium made it, so the app's replaces it.
  await expect(page.getByText(/pages have names already used here/)).toBeVisible();
  const replace = page.getByRole('button', { name: 'Replace it' });
  for (let left = await replace.count(); left > 0; left = await replace.count()) {
    await replace.first().click();
    await expect(replace).toHaveCount(left - 1);
  }
  const install = page.getByRole('button', { name: 'Install', exact: true });
  await expect(install).toBeEnabled();
  await install.click();
  await expect(page.getByText(new RegExp(`${NAME} ${version.replaceAll('.', '\\.')} is installed on kiln_copy`))).toBeVisible({ timeout: 60_000 });
  await context.close();

  expect(await copy.dump(), 'the copy holds the same schema after the install').toBe(before);
  const pages = ((await target.api.get('/pages')) as { data: { connectionId: string | null }[] }).data.filter((p) => p.connectionId === copyId);
  expect(pages.length, 'the app’s pages arrived on the copy').toBeGreaterThan(5);
});

test('a file edited by hand cannot switch a webhook on: an address is refused, and a rule switched on arrives off', async ({ browser }) => {
  test.setTimeout(180_000);
  const v1 = files['1.0.0']!;
  await skipUnlessInstallable(target, v1.bytes);
  // The edits are made to another app (every "kiln-street" made "kiln-crafted"), so its tables go on a database of their own.
  type Manifest = Record<string, unknown> & { automations?: { name: string; enabled?: boolean; graph: { nodes: { kind: string; action?: Record<string, unknown> }[] } }[] };
  const members = membersOf(v1.bytes);
  const crafted = (edit: (rule: NonNullable<Manifest['automations']>[number]) => void) => {
    const manifest = JSON.parse(members['manifest.json']!.replaceAll(KEY, 'kiln-crafted').replaceAll(NAME, 'Kiln Crafted')) as Manifest;
    const rule = manifest.automations?.find((one) => one.name === 'Tell the kiln log');
    expect(rule, 'the saved file carries the rule').toBeDefined();
    edit(rule!);
    return repack({ ...members, 'manifest.json': JSON.stringify(manifest, null, 2) }).buffer;
  };
  const withAddress = crafted((rule) => {
    for (const node of rule.graph.nodes) if (node.action?.['kind'] === 'webhook') node.action['url'] = WEBHOOK;
  });
  const switchedOn = crafted((rule) => {
    rule.enabled = true;
  });

  const db = await emptyDatabase(ENGINE, 'kiln_crafted');
  databases.push(db);
  const connectionId = await connect(target, db, 'kiln_crafted');
  const { context, page } = await contextOn(target, browser);

  // An address in the file: the file is refused at upload, and nothing of it is staged.
  const refused = await uploadFile(target, withAddress);
  expect(refused.status).toBe(422);
  expect(JSON.stringify(refused.body)).toContain('Unrecognized key: \\"url\\"');
  await upload(page, 'kiln-crafted-1.0.0.tgz', withAddress);
  await expect(page.getByText('The manifest in this bundle is not valid.')).toBeVisible();

  // The rule switched on, with no address: it installs, and the rule arrives switched off.
  await upload(page, 'kiln-crafted-1.0.0.tgz', switchedOn);
  await expect(page.getByText('Install into which database?')).toBeVisible();
  await page.getByRole('radio', { name: /kiln_crafted/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('These rules would send data out')).toBeVisible();
  await expect(page.getByText('They arrive switched off and empty. Someone who manages automations can turn them on.')).toBeVisible();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByText(/Kiln Crafted 1\.0\.0 is installed on kiln_crafted/)).toBeVisible({ timeout: 60_000 });
  await context.close();

  const out = (await rulesOn(target, connectionId)).find((one) => one.name === 'Tell the kiln log');
  expect(out?.enabled, 'the rule the file switched on arrives off').toBe(false);
  expect(out?.graph.nodes.find((node) => node.action?.['kind'] === 'webhook')?.action?.['url'] ?? null, 'and its address empty').toBeNull();
});

test('Kiln’s mail is sent as Kiln: a new member’s welcome leaves from its workspace’s sender', async ({ browser }) => {
  test.setTimeout(240_000);
  test.skip(targets.length === 0, 'nothing was installed');
  const { connectionId, name } = targets[0]!;
  // The server may send for kilnstreet.example: it is one of its senders.
  await target.api.put('/settings/email', { senders: [{ name: NAME, address: 'studio@kilnstreet.example' }] });
  const made = (await target.api.post('/workspaces', { name: 'Kiln Street', connectionIds: [connectionId] })) as { workspace: { id: string } };

  // The sender is set on the workspace's row, in Data connections.
  const { context, page } = await contextOn(target, browser);
  await page.goto('/studio');
  const row = page.getByRole('listitem').filter({ hasText: 'Kiln Street' }).first();
  await row.getByRole('button', { name: 'Sender' }).click();
  const sheet = page.getByRole('dialog', { name: 'Sender for Kiln Street' });
  await sheet.getByLabel('From address').fill('hello@kilnstreet.example');
  await sheet.getByLabel('Sender name').fill(NAME);
  await sheet.getByLabel('Postal address').fill('14 Kiln Street, Bristol BS1 4KS');
  await sheet.getByRole('button', { name: 'Save sender' }).click();
  await expect(sheet).toBeHidden();
  await context.close();
  const workspace = ((await target.api.get('/workspaces')) as { workspaces: { id: string; sender: { from: string | null } }[] }).workspaces.find((one) => one.id === made.workspace.id);
  expect(workspace?.sender.from).toBe('hello@kilnstreet.example');

  // A member joins on the target's Kiln; the welcome rule that came with the app mails them.
  const membersTable = ((await target.api.get(`/connections/${connectionId}/schema`)) as { model: { tables: { id: string; name: string }[] } }).model.tables.find((t) => t.name === 'members')!.id;
  await target.api.post(`/data/${connectionId}/${membersTable}/one-by-one`, {
    creates: [{ name: 'Ada Potter', email: 'ada.potter@example.test', membership: 'monthly', joined_on: '2026-11-06' }],
  });
  // A write made in the dashboard runs its rules after the minute it can be undone in.
  await expect
    .poll(async () => (await target.messages()).find((m) => m.to.includes('ada.potter@example.test'))?.from ?? '', { timeout: 150_000, intervals: [2000], message: `the welcome on ${name}` })
    .toContain('hello@kilnstreet.example');
  const mail = (await target.messages()).find((m) => m.to.includes('ada.potter@example.test'))!;
  expect(mail.from).toContain(NAME);
  expect(mail.subject).toBe('Welcome to the studio, Ada Potter');
});
