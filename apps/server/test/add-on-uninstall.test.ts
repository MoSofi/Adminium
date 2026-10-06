// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REMOVING AN ADD-ON THAT KEEPS TABLES OF ITS OWN leaves nothing of what it
 * declared — no page, role, rule or list entry point to it — and keeps its
 * tables with every row. A page the owner edited stays, as the owner's. Its
 * tables are dropped only when a Super Admin asks and types its key, and then
 * only the ones it made. Installed again over kept tables, it finds the same
 * rows under the same ids. It cannot be removed while a rule of the owner's
 * still hands rows to it.
 */
import { appTablesRepo, auditRepo, manifestsRepo, newId, overridesRepo, pagesRepo, permissionsRepo, rolesRepo, usersRepo, type MetaDb } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { featuresInto, postingsInto } from '../src/add-ons/in-use.js';
import { matrixRowsFromGrants } from '../src/rbac/permissions.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

/**
 * A table rule as it sits in the store, written past the repo's own check:
 * what matters here is who a rule names, not that it is a whole posting.
 */
async function storedRule(meta: MetaDb, connectionId: string, op: string, tableName: string, value: unknown, origin: string, status = 'active'): Promise<string> {
  const id = newId('ovr');
  await meta.db
    .insertInto('adminium_schema_overrides')
    .values({ id, connectionId, op, tableName, columnName: null, value: JSON.stringify(value), origin, llmRunId: null, status, confidence: null, createdBy: null, createdAt: 1, updatedAt: 1 } as never)
    .execute();
  return id;
}

const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;
const remove = (harness: Harness, payload?: Record<string, unknown>, as?: Parameters<Harness['inject']>[0]['as']) =>
  harness.inject({ method: 'DELETE', url: '/add-ons/stock-kit', ...(payload === undefined ? {} : { payload }), ...(as === undefined ? {} : { as }) });
const install = (harness: Harness) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });

describe.each(LEGS)('removing an add-on with tables of its own — %s', (dialect, available) => {
  /** The kit installed, with an item and a take in it. */
  async function installed(): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    await harness.stageAddOn(stockKitManifest());
    expect((await install(harness)).statusCode).toBe(200);
    const db = await source(harness);
    await sql`insert into stock_kit_items (id, name, opening) values (7, 'Flour', 5)`.execute(db);
    await sql`insert into stock_kit_takes (id, item_id, qty) values (3, 7, 2)`.execute(db);
    return harness;
  }
  const ownRules = async (harness: Harness) => (await overridesRepo(harness.meta).listForConnection(harness.connectionId)).filter((rule) => rule.origin === 'app');

  it.runIf(available)('leaves no page, role, rule or grant of its own, keeps its tables and rows, and says so', async () => {
    h = await installed();
    // A role of the owner's own was granted the page of the kit's code.
    const counter = await rolesRepo(h.meta).create({ slug: 'counter', name: 'Counter' } as never);
    await permissionsRepo(h.meta).grant(counter.id, 'page', 'stock-kit-count', { view: true, edit: false } as never);
    expect((await ownRules(h)).length).toBeGreaterThan(0);

    const plan = await h.inject({ method: 'GET', url: '/add-ons/stock-kit/uninstall-plan' });
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json()).toMatchObject({ likeApp: true, pages: { removed: ['stock-kit-items'], kept: [] }, requiredBy: [], inUse: { postings: [], features: [] } });
    expect(plan.json().roles.map((role: { slug: string }) => role.slug).sort()).toEqual(['stock-kit-manager', 'stock-kit-reader']);
    // The person who installed it holds its first role.
    expect(plan.json().roles.find((role: { slug: string }) => role.slug === 'stock-kit-manager').members).toBe(1);
    expect(plan.json().tables).toEqual(expect.arrayContaining([{ table: 'stock_kit_items', droppable: true }, { table: 'stock_kit_takes', droppable: true }]));
    // The plan removed nothing.
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items')).not.toBeNull();

    const reply = await remove(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toMatchObject({ key: 'stock-kit', tablesKept: true, removed: { pages: 1, roles: 2 }, kept: { pages: [] }, dropped: [] });
    expect([...reply.json().kept.tables].sort()).toEqual(['stock_kit_items', 'stock_kit_takes']);
    expect(await manifestsRepo(h.meta, CRYPTO).findByKey('stock-kit')).toBeNull();
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items')).toBeNull();
    expect((await rolesRepo(h.meta).list()).filter((role) => role.appKey === 'stock-kit')).toEqual([]);
    expect(await ownRules(h)).toEqual([]);
    // The owner's own role holds nothing of the page that is gone.
    expect((await permissionsRepo(h.meta).listForRole(counter.id)).filter((grant) => grant.resourceRef === 'stock-kit-count')).toEqual([]);
    // Its tables and rows are exactly as they were, and their records are let go, not forgotten.
    expect(await h.rows('SELECT id, name FROM stock_kit_items')).toEqual([{ id: 7, name: 'Flour' }]);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_takes'))[0]!['n'])).toBe(1);
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit');
    expect(records.map((record) => record.state)).toEqual(['released', 'released']);
    expect((await auditRepo(h.meta).list({ limit: 40 })).filter((entry) => entry.action === 'add-on.uninstalled')).toHaveLength(1);
  });

  it.runIf(available)('a page the owner edited stays, as the owner\'s own', async () => {
    h = await installed();
    const pages = pagesRepo(h.meta);
    const page = (await pages.findBySlug(h.connectionId, 'stock-kit-items'))!;
    await pages.replaceConfig(page.id, { ...(structuredClone(page.config) as Record<string, unknown>), ownersNote: 'ours' });
    const reply = await remove(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json()).toMatchObject({ removed: { pages: 0 }, kept: { pages: ['stock-kit-items'] } });
    const kept = await pages.findBySlug(h.connectionId, 'stock-kit-items');
    expect(kept).not.toBeNull();
    expect(kept!.manifestId).toBeNull();
  });

  it.runIf(available)('installed again over the kept tables, it finds the same rows under the same ids', async () => {
    h = await installed();
    expect((await remove(h)).statusCode).toBe(200);
    await h.stageAddOn(stockKitManifest());
    const again = await install(h);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().schema.created).toEqual([]);
    expect([...again.json().schema.reused].sort()).toEqual(['stock_kit_items', 'stock_kit_takes']);
    expect(await h.rows('SELECT id, name FROM stock_kit_items')).toEqual([{ id: 7, name: 'Flour' }]);
    expect((await h.rows('SELECT id, item_id FROM stock_kit_takes')).map((take) => [Number(take['id']), Number(take['item_id'])])).toEqual([[3, 7]]);
    // Still its own: made by it the first time, and recorded so again.
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit');
    expect(records.map((record) => [record.tableName, record.owned]).sort()).toEqual([['stock_kit_items', true], ['stock_kit_takes', true]]);
    expect(records.every((record) => record.state === 'created' || record.state === 'adopted')).toBe(true);
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items')).not.toBeNull();
  });

  it.runIf(available)('drops the tables it made only for a Super Admin who typed its key', async () => {
    h = await installed();
    // Somebody who may manage add-ons but is no Super Admin.
    const admin = await usersRepo(h.meta).create({ email: 'ada@test', name: 'Ada' });
    const keeper = await rolesRepo(h.meta).create({ slug: 'add-on-keeper', name: 'Add-on keeper' } as never);
    for (const row of matrixRowsFromGrants(['system:manifests:manage']).rows) await permissionsRepo(h.meta).grant(keeper.id, row.resourceKind, row.resourceRef, row.actions);
    await rolesRepo(h.meta).assignToUser(admin.id, keeper.id);
    const refused = await remove(h, { dropTables: true, confirmKey: 'stock-kit' }, admin);
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json().error.details).toMatchObject({ reason: 'DROP_NEEDS_SUPER_ADMIN' });
    const untyped = await remove(h, { dropTables: true });
    expect(untyped.statusCode, untyped.body).toBe(422);
    expect(untyped.json().error.details).toMatchObject({ reason: 'CONFIRM_KEY_MISMATCH' });
    const mistyped = await remove(h, { dropTables: true, confirmKey: 'stock' });
    expect(mistyped.statusCode).toBe(422);
    // Every refusal came before anything was removed.
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('stock-kit'))?.row.status).toBe('installed');
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-items')).not.toBeNull();
    expect(await h.tableNames()).toEqual(expect.arrayContaining(['stock_kit_items', 'stock_kit_takes']));

    const dropped = await remove(h, { dropTables: true, confirmKey: 'stock-kit' });
    expect(dropped.statusCode, dropped.body).toBe(200);
    expect(dropped.json().tablesKept).toBe(false);
    expect([...dropped.json().dropped].sort()).toEqual(['stock_kit_items', 'stock_kit_takes']);
    expect((await h.tableNames()).filter((name) => name.startsWith('stock_kit_'))).toEqual([]);
    expect((await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit')).map((record) => record.state)).toEqual(['dropped', 'dropped']);
  });

  it.runIf(available)('is refused while a rule of the owner\'s still hands rows to it, and removed once that rule is gone', async () => {
    h = await installed();
    const rule = await storedRule(h.meta, h.connectionId, 'table.postings', 'main.shipments', { postings: [{ id: 'ship', into: { addOn: 'stock-kit', ledger: 'units', action: 'use' } }] }, 'user');
    const refused = await remove(h);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'ADD_ON_IN_USE', details: { postings: [{ table: 'shipments', posting: 'ship' }], features: [] } });
    expect((await manifestsRepo(h.meta, CRYPTO).findByKey('stock-kit'))?.row.status).toBe('installed');
    expect((await h.inject({ method: 'GET', url: '/add-ons/stock-kit/uninstall-plan' })).json().inUse.postings).toEqual([{ table: 'shipments', posting: 'ship' }]);
    await overridesRepo(h.meta).delete(rule);
    expect((await remove(h)).statusCode).toBe(200);
  });
});

describe('what still hands rows to an add-on', () => {
  it('counts a rule the owner drew, on or off, and a price rule; never a rule an app ships', async () => {
    h = await addOnHarness('sqlite');
    const posting = (addOn: string) => ({ postings: [{ id: 'line', into: { addOn, ledger: 'units', action: 'use' } }] });
    const add = (op: string, tableName: string, value: unknown, origin: string, status?: string) => storedRule(h!.meta, h!.connectionId, op, tableName, value, origin, status);
    await add('table.postings', 'main.orders', posting('stock-kit'), 'user');
    await add('table.postings', 'main.visits', posting('stock-kit'), 'app');
    await add('table.postings', 'main.returns', posting('another'), 'user');
    await add('table.postings', 'main.repairs', posting('stock-kit'), 'user', 'disabled');
    await add('table.adjust', 'main.carts', { by: { addOn: 'stock-kit' } }, 'user');
    expect((await postingsInto(h.meta, 'stock-kit')).map((found) => `${found.table} ${found.posting}`)).toEqual(['main.orders line', 'main.repairs line', 'main.carts price']);
    expect(await postingsInto(h.meta, 'nobody')).toEqual([]);
  });

  it('counts an app\'s feature that posts into it only while the add-on is attached to that app and switched on there', async () => {
    h = await addOnHarness('sqlite');
    const rows = manifestsRepo(h.meta, CRYPTO);
    const app = (key: string) => ({
      kind: 'app',
      key,
      name: key === 'shop' ? 'Shop' : 'Desk',
      addOns: { features: [{ id: 'stock', requires: ['stock-kit'] }, { id: 'labels', requires: ['stock-kit'] }, { id: 'tax', requires: ['other'] }] },
      requiredSchema: { tables: [{ ref: 'lines', postings: [{ id: 'l', needs: 'stock' }, { id: 't', needs: 'tax' }] }, { ref: 'carts', adjust: { needs: 'stock' } }] },
    });
    await rows.install({ manifestKey: 'shop', version: '1.0.0', kind: 'app', source: 'file', document: app('shop'), connectionId: h.connectionId });
    await rows.install({ manifestKey: 'desk', version: '1.0.0', kind: 'app', source: 'file', document: app('desk'), connectionId: h.connectionId });
    const kit = await rows.install({ manifestKey: 'stock-kit', version: '1.0.0', kind: 'add-on', source: 'file', document: { kind: 'add-on', key: 'stock-kit' }, connectionId: h.connectionId, status: 'installed', attachTo: ['shop'] });
    // A feature that posts nothing ("labels") stops no removal; one that needs another add-on ("tax") is not this one's.
    expect(await featuresInto(h.meta, 'stock-kit')).toEqual([{ app: 'shop', appName: 'Shop', feature: 'stock' }]);
    await rows.setAttachmentEnabled(kit.row.id, 'shop', false);
    expect(await featuresInto(h.meta, 'stock-kit')).toEqual([]);
    expect(await featuresInto(h.meta, 'absent')).toEqual([]);
  });
});
