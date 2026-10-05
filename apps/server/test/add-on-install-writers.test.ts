// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ADD-ON DECLARES BESIDE ITS TABLES is written at its install, with
 * no app anywhere: its option lists and column rules, its generated pages,
 * its roles. The rules hold from the first write; the pages are seen only by
 * the add-on's own roles; and whoever installed it holds its first role.
 */
import { documentProfilesRepo, manifestsRepo, optionListsRepo, overridesRepo, pagesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { drawersFor } from '../src/documents/app-documents.js';
import { addOnSettingsGrantHeld } from '../src/rbac/add-on-grant.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const install = (harness: Harness) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the assertions reach into the reply freely
type Body = Record<string, any>;
async function installed(dialect: (typeof LEGS)[number][0]): Promise<{ harness: Harness; body: Body }> {
  const harness = await addOnHarness(dialect, { unbuiltWords: {} });
  await harness.stageAddOn(stockKitManifest());
  const reply = await install(harness);
  expect(reply.statusCode, reply.body).toBe(200);
  return { harness, body: reply.json() as Body };
}
/** The write service over the add-on's own tables, as the data routes build it. */
const writer = (harness: Harness) => writerFor({ meta: harness.meta, manager: harness.manager, connectionId: harness.connectionId, real: (ref: string) => `stock_kit_${ref}` } as unknown as InvoicingHarness);

describe.each(LEGS)('an add-on installed with no app — %s', (dialect, available) => {
  it.runIf(available)('gets its tables, its rules, its option list, its page and its roles', async () => {
    const made = await installed(dialect);
    h = made.harness;
    expect([...made.body.schema.created].sort()).toEqual(['items', 'takes']);
    // The option list, under the add-on's key.
    const list = await optionListsRepo(h.meta).findByKey('stock-kit-zones');
    expect(list).toMatchObject({ origin: 'app:stock-kit' });
    expect(made.body.rules.lists).toEqual(['stock-kit-zones']);
    // Its column rules, on its own real tables.
    const rules = (await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })).filter((rule) => rule.origin === 'app');
    const ops = rules.map((rule) => `${rule.tableName.split('.').pop() ?? ''}.${rule.columnName ?? ''} ${rule.op}`).sort();
    expect(ops).toEqual(expect.arrayContaining(['stock_kit_items.taken column.rollup', 'stock_kit_items.zone column.options']));
    expect(made.body.rules.skipped).toEqual([]);
    expect(made.body.rules.written).toBe(rules.length);
    // Its generated page, in the app section, on its own table.
    expect(made.body.pages.created).toEqual(['stock-kit-items']);
    const page = await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items');
    expect(page).toMatchObject({ origin: 'manifest', navGroup: 'app' });
    // Its roles, owned by it.
    expect([...made.body.roles.created].sort()).toEqual(['stock-kit-manager', 'stock-kit-reader']);
    const roles = (await rolesRepo(h.meta).list()).filter((role) => role.appKey === 'stock-kit');
    expect(roles.map((role) => role.slug).sort()).toEqual(['stock-kit-manager', 'stock-kit-reader']);
    // Each role's grants are on the add-on's REAL tables, the ones under its prefix.
    const tableIdOf = (ref: string) => rules.find((rule) => rule.tableName.endsWith(`stock_kit_${ref}`))?.tableName ?? `stock_kit_${ref}`;
    const granted = async (slug: string) => {
      const role = roles.find((candidate) => candidate.slug === slug)!;
      const rows = await permissionsRepo(h!.meta).listForRole(role.id);
      return rows.filter((row) => row.resourceKind === 'table').map((row) => `${row.resourceRef.split('/').pop() ?? ''}:${Object.entries(row.actions as Record<string, boolean>).filter(([, on]) => on).map(([action]) => action).sort().join('+')}`).sort();
    };
    const items = tableIdOf('items');
    expect(await granted('stock-kit-reader')).toEqual([`${items}:read`]);
    expect((await granted('stock-kit-manager')).find((grant) => grant.startsWith(`${items}:`))).toBe(`${items}:read+update`);
    expect(await granted('stock-kit-manager')).toHaveLength(2);
  });

  it.runIf(available)('its rules hold from the first write: a capped balance refuses what is not there', async () => {
    const made = await installed(dialect);
    h = made.harness;
    const w = await writer(h);
    const flour = await w.create('items', { name: 'Flour', zone: 'shelf', opening: '5.00' });
    await w.create('takes', { item_id: flour['id'], qty: '3.00' });
    const [after] = await h.rows(`SELECT taken, ${dialect === 'mysql' ? '`left`' : '"left"'} AS remaining FROM stock_kit_items`);
    expect(Number(after!['taken'])).toBe(3);
    expect(Number(after!['remaining'])).toBe(2);
    await expect(w.create('takes', { item_id: flour['id'], qty: '2.01' })).rejects.toMatchObject({ code: 'BALANCE_EXCEEDED' });
    // Nothing of the refused take was written, and the balance is as it was.
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_takes'))[0]!['n'])).toBe(1);
    expect(Number((await h.rows('SELECT taken FROM stock_kit_items'))[0]!['taken'])).toBe(3);
    // Exactly what is left may still be taken.
    await w.create('takes', { item_id: flour['id'], qty: '2.00' });
    expect(Number((await h.rows('SELECT taken FROM stock_kit_items'))[0]!['taken'])).toBe(5);
  });
});

describe('who sees an add-on\'s pages', () => {
  it('its own roles and nobody else: no role that sees another page of the database is let in', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    // A role of the owner's, with a page of their own on this database.
    const own = await pagesRepo(h.meta).create({ connectionId: h.connectionId, slug: 'notes', type: 'page-crud', title: 'Notes', navGroup: 'manage', config: {}, createdBy: h.owner.id });
    const clerk = await rolesRepo(h.meta).create({ slug: 'clerk', name: 'Clerk' });
    await permissionsRepo(h.meta).grant(clerk.id, 'page', own.id, { view: true, edit: false } as never);

    await h.stageAddOn(stockKitManifest());
    expect((await install(h)).statusCode).toBe(200);
    const page = (await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items'))!;
    const permissions = permissionsRepo(h.meta);
    expect(await permissions.find(clerk.id, 'page', page.id)).toBeNull();
    const roles = await rolesRepo(h.meta).list();
    const manager = roles.find((role) => role.slug === 'stock-kit-manager')!;
    const reader = roles.find((role) => role.slug === 'stock-kit-reader')!;
    expect((await permissions.find(manager.id, 'page', page.id))?.actions).toMatchObject({ view: true });
    expect((await permissions.find(reader.id, 'page', page.id))?.actions).toMatchObject({ view: true });
    // The add-on's own screen has no page row: the grant is on its ref, for the role that was given it.
    expect((await permissions.find(manager.id, 'page', 'stock-kit-count'))?.actions).toMatchObject({ view: true });
    expect(await permissions.find(reader.id, 'page', 'stock-kit-count')).toBeNull();
  });

  it('whoever installed it holds its first role, once', async () => {
    const made = await installed('sqlite');
    h = made.harness;
    const roles = rolesRepo(h.meta);
    const held = (await roles.rolesForUser(h.owner.id)).map((role) => role.slug);
    expect(held).toContain('stock-kit-manager');
    expect(held).not.toContain('stock-kit-reader');
  });

  it('its manager may save its own settings while it is installed, and no other add-on\'s; its reader may not', async () => {
    const made = await installed('sqlite');
    h = made.harness;
    const roles = rolesRepo(h.meta);
    const people = usersRepo(h.meta);
    const manager = await people.create({ email: 'manager@test', name: 'Manager' });
    const reader = await people.create({ email: 'reader@test', name: 'Reader' });
    await roles.assignToUser(manager.id, (await roles.findBySlug('stock-kit-manager'))!.id);
    await roles.assignToUser(reader.id, (await roles.findBySlug('stock-kit-reader'))!.id);
    const held = (user: { id: string }, addOn = 'stock-kit') => addOnSettingsGrantHeld(h!.meta, { kind: 'user', id: user.id, label: 'x' }, addOn);
    expect(await held(manager)).toBe(true);
    expect(await held(reader)).toBe(false);
    expect(await held(manager, 'invoices')).toBe(false);
    // Only while it is installed: an add-on being changed answers no.
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'updating' }).where('manifestKey', '=', 'stock-kit').execute();
    expect(await held(manager)).toBe(false);
  });

  it('a role or a page whose name the owner already uses is a problem said before anything is made, never merged into', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageAddOn(stockKitManifest());
    // The owner's own role under the slug the add-on's role would take.
    const theirs = await rolesRepo(h.meta).create({ slug: 'stock-kit-manager', name: 'My stock people' });
    const taken = await install(h);
    expect(taken.statusCode, taken.body).toBe(422);
    expect(taken.body).toContain('stock-kit-manager');
    expect((await h.tableNames()).filter((name) => name.startsWith('stock_kit_'))).toEqual([]);
    expect((await rolesRepo(h.meta).findBySlug('stock-kit-manager'))?.appKey ?? null).toBeNull();
    // Nothing was started: with the name free again, the same package installs.
    expect(await h.meta.db.selectFrom('adminium_manifests').select('id').execute()).toEqual([]);
    await h.meta.db.deleteFrom('adminium_roles').where('id', '=', theirs.id).execute();
    expect((await install(h)).statusCode).toBe(200);
  });

  it('a role that names a page the add-on does not have is refused before anything is made', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    const doc = stockKitManifest() as { roles: { permissions: string[] }[] };
    doc.roles[1]!.permissions.push('page:@stock-kit-ghost:view');
    await h.stageAddOn(doc as unknown as Record<string, unknown>);
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain('stock-kit-ghost');
    expect((await h.tableNames()).filter((name) => name.startsWith('stock_kit_'))).toEqual([]);
  });
});

describe('what an add-on\'s install would make, asked before it is made', () => {
  it('names its pages, its roles and its lists, says where its tables go, and writes nothing', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageAddOn({ ...stockKitManifest(), seeds: [{ table: 'items', rows: [{ name: 'Flour' }] }] });
    const reply = await h.inject({ method: 'POST', url: '/add-ons/plan', payload: { key: 'stock-kit', attachTo: [] } });
    expect(reply.statusCode, reply.body).toBe(200);
    const body = reply.json();
    expect(body.makes).toEqual({
      // The generated page, then the page of its own code.
      pages: [{ ref: 'stock-kit-items', title: 'Items' }, { ref: 'stock-kit-count', title: 'Count' }],
      roles: [{ key: 'manager', name: 'Stock manager' }, { key: 'reader', name: 'Stock reader' }],
      lists: ['zones'],
      documents: 0,
      seeds: true,
    });
    expect(body.connectionId).toBe(h.connectionId);
    expect(typeof body.connectionName).toBe('string');
    expect(body.connectionName.length).toBeGreaterThan(0);
    expect((await h.tableNames()).filter((name) => name.startsWith('stock_kit_'))).toEqual([]);
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items')).toBeNull();
    // Without starting rows or a settings table it says so.
    await h.stageAddOn({ ...stockKitManifest(), version: '1.0.1' });
    expect((await h.inject({ method: 'POST', url: '/add-ons/plan', payload: { key: 'stock-kit', version: '1.0.1', attachTo: [] } })).json().makes.seeds).toBe(false);
  });
});

describe.each(LEGS)('an app that needs an add-on with tables of its own — %s', (dialect, available) => {
  /** An app with a table called `items` of its own, under no prefix, that requires the kit. */
  const SHOP = {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version: '0.3.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    pages: [{ ref: 'items', template: 'page-crud', title: { key: 't', fallback: 'Items' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'items' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    addOns: { requires: [{ key: 'stock-kit', range: '>=1.0.0', reason: { 'en-US': 'Keeps the stock.' } }] },
    requiredSchema: { tables: [{ ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'title', type: 'text', maxLength: 80 }] }] },
  };

  it.runIf(available)('installs it with the app, in the app\'s database, each keeping its own table of the same short name', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(stockKitManifest(), { bundled: true });
    const plan = await h.plan(SHOP);
    expect(plan.statusCode, plan.body).toBe(200);
    // The app's `items` is a table to make: the add-on's `items` is another table, under the add-on's prefix.
    expect(plan.json().plan).toMatchObject({ installable: true });
    expect(plan.json().plan.create.map((table: { ref: string }) => table.ref)).toEqual(['items']);
    const reply = await h.install('shop', '0.3.0', { addOns: [{ key: 'stock-kit', version: '1.0.0' }] });
    expect(reply.statusCode, reply.body).toBe(200);
    const names = await h.tableNames();
    expect(names).toEqual(expect.arrayContaining(['items', 'stock_kit_items', 'stock_kit_takes']));
    const kit = await manifestsRepo(h.meta, { encrypt: (v: string) => v, decrypt: (v: string) => v }).findByKey('stock-kit');
    expect(kit?.row).toMatchObject({ status: 'installed', connectionId: h.connectionId });
    expect(kit?.attachments.map((attachment) => attachment.attachedTo)).toContain('shop');
    // The person who installed the app holds the add-on's first role too.
    expect((await rolesRepo(h.meta).rolesForUser(h.owner.id)).map((role) => role.slug)).toContain('stock-kit-manager');

    // Uninstalling the app: its own `items` is its to drop; nothing of the add-on's is in the list at all.
    const list = await h.inject({ method: 'GET', url: '/apps/shop/uninstall-plan' });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().tables).toEqual([{ table: 'items', droppable: true }]);
  });
});

describe('what an add-on prints for its own rows', () => {
  /** The stock kit with a label it draws itself, and a document another add-on would draw. */
  const withDocuments = (): Record<string, unknown> => ({
    ...stockKitManifest(),
    addOns: { suggests: [{ key: 'invoices', range: '>=1.0.0', reason: { 'en-US': 'Prints purchase orders.' } }] },
    documents: [
      { kind: 'stock-label', addOn: 'stock-kit', table: 'items', name: 'Stock label', mapping: { title: { column: 'name' } } },
      { kind: 'purchase-order', addOn: 'invoices', table: 'items', name: 'Purchase order', mapping: { title: { column: 'name' } } },
    ],
  });
  /** A loaded add-on that draws the kinds named. */
  const drawing = (addOnKey: string, kinds: string[]) => ({
    addOnKey,
    contract: 'document-render',
    version: 1,
    module: { key: addOnKey, kinds: () => kinds.map((id) => ({ id, formats: ['html'], paper: ['a4'] })), describe: () => ({ slots: [{ id: 'title', type: 'text' }] }), render: () => Promise.resolve([]) },
  });

  it('is made at its install, once its own code is loaded — by itself, with nobody attached', async () => {
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    // Its code is loaded when the install says so, and not a moment before.
    h = await addOnHarness('sqlite', {
      unbuiltWords: {},
      documents: { runtime: () => state as never },
      onRebuild: () => state.providers.set('document-render@1', [drawing('stock-kit', ['stock-label'])]),
    });
    await h.stageAddOn(withDocuments());
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(200);
    const profiles = await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'stock-kit');
    expect(profiles.map((profile) => [profile.kind, profile.addOnKey])).toEqual([['stock-label', 'stock-kit']]);
    // The other document waits for the add-on that draws it: said, and nothing made for it.
    expect(JSON.stringify(reply.json().documents.skipped)).toContain('purchase-order');
    expect(reply.json().documents.made).toHaveLength(1);
    // An add-on it suggests that is not installed draws nothing for it.
    expect([...(await drawersFor(h.meta, 'stock-kit'))]).toEqual(['stock-kit']);
  });

  it('never stops its install: with nothing loaded that draws it, the add-on is installed and the document is listed as skipped', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {}, documents: { runtime: () => null } });
    await h.stageAddOn(withDocuments());
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'stock-kit')).toEqual([]);
    expect(JSON.stringify(reply.json().documents.skipped)).toContain('stock-label');
  });

  it('a suggested add-on that is here and does not draw the kind is listed, and the install still finishes', async () => {
    const state = { providers: new Map<string, unknown[]>(), slots: new Map(), conflicts: [], problems: [], deciders: new Map() };
    h = await addOnHarness('sqlite', {
      unbuiltWords: {},
      documents: { runtime: () => state as never },
      onRebuild: () => state.providers.set('document-render@1', [drawing('stock-kit', ['stock-label']), drawing('invoices', ['invoice'])]),
    });
    await h.stageAddOn(withDocuments());
    const manifests = manifestsRepo(h.meta, { encrypt: (v: string) => v, decrypt: (v: string) => v });
    // Suggested and not installed: it draws nothing for this owner.
    expect([...(await drawersFor(h.meta, 'stock-kit'))]).toEqual([]);
    await manifests.install({ manifestKey: 'invoices', version: '1.0.8', kind: 'add-on', source: 'marketplace', document: { kind: 'add-on', key: 'invoices' } });
    const reply = await install(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect([...(await drawersFor(h.meta, 'stock-kit'))].sort()).toEqual(['invoices', 'stock-kit']);
    expect(reply.json().documents.refused).toEqual([]);
    expect(JSON.stringify(reply.json().documents.skipped)).toContain('does not draw a \\"purchase-order\\" document');
    expect((await documentProfilesRepo(h.meta).listOwnedBy(h.connectionId, 'stock-kit')).map((profile) => profile.kind)).toEqual(['stock-label']);
  });

  it('who may draw for an owner: an app\'s attached add-ons; an add-on itself while installed, and what it suggests', async () => {
    const made = await installed('sqlite');
    h = made.harness;
    expect([...(await drawersFor(h.meta, 'stock-kit'))]).toEqual(['stock-kit']);
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'updating' }).where('manifestKey', '=', 'stock-kit').execute();
    expect([...(await drawersFor(h.meta, 'stock-kit'))]).toEqual([]);
    expect([...(await drawersFor(h.meta, 'an-app-with-nothing-attached'))]).toEqual([]);
  });
});
