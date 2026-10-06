// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S UPDATE MAY CHANGE ITS OWN TABLES: a version that adds a column,
 * a table or an index gets them, and then what it declares beside them is
 * written the way an app's update writes it — what the owner changed is kept.
 * While it runs the add-on's row says `updating`; a stop leaves it so, and the
 * same call finishes. The old upgrade door still refuses a change to a table.
 */
import { appTablesRepo, auditRepo, manifestsRepo, optionListsRepo, pagesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
type Kit = Record<string, unknown> & { requiredSchema: { tables: Record<string, unknown>[] }; pages: unknown[]; roles: { permissions: string[] }[] };
/** The stock kit's next version: a column on `items`, an index on `takes`, two new tables (one with starting rows), a page, a grant. */
function next(over: { zone?: string } = {}): Kit {
  const kit = stockKitManifest() as Kit;
  kit['version'] = '1.0.1';
  const items = kit.requiredSchema.tables.find((table) => table['ref'] === 'items')!;
  (items['columns'] as unknown[]).push({ ref: 'bin', type: 'text', maxLength: 20, nullable: true });
  kit.requiredSchema.tables.find((table) => table['ref'] === 'takes')!['indexes'] = [['item_id', 'qty']];
  kit.requiredSchema.tables.push(
    { ref: 'counts', columns: [pk, { ref: 'item_id', type: 'fk', references: 'items' }, { ref: 'counted', type: 'decimal', scale: 2, default: 0 }] },
    { ref: 'units', columns: [pk, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'zone', type: 'text', maxLength: 32, nullable: true, rules: { options: { list: 'zones' } } }] },
  );
  kit.pages.push({ ref: 'stock-kit-counts', template: 'page-crud', title: { key: 'stock.counts', fallback: 'Counts' }, nav: { group: 'manage', icon: 'list', order: 2 }, bindings: { main: 'counts' } });
  kit.roles[0]!.permissions.push('table:@counts:read', 'page:@stock-kit-counts:view');
  kit['seeds'] = [
    // A table that was there before this version: it gets no starting rows now, empty or not.
    { table: 'items', rows: [{ name: 'Seeded item' }] },
    { table: 'units', rows: [{ name: 'Each', zone: over.zone ?? 'shelf' }, { name: 'Box' }] },
  ];
  return kit;
}
const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;
const post = (harness: Harness, url: string, payload: Record<string, unknown> = {}) => harness.inject({ method: 'POST', url, payload });
const row = async (harness: Harness) => (await manifestsRepo(harness.meta, CRYPTO).findByKey('stock-kit'))!.row;

describe.each(LEGS)('an add-on\'s update — %s', (dialect, available) => {
  /** 1.0.0 installed with one item in it, and 1.0.1 staged. */
  async function ready(over: Parameters<typeof next>[0] = {}): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    await harness.stageAddOn(stockKitManifest());
    expect((await post(harness, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    await sql`insert into stock_kit_items (name) values ('Flour')`.execute(await source(harness));
    await harness.stageAddOn(next(over));
    return harness;
  }

  it.runIf(available)('adds the version\'s column, tables and index, writes its new page and grant, and keeps every row', async () => {
    h = await ready();
    const planned = await post(h, '/add-ons/stock-kit/update/plan');
    expect(planned.statusCode, planned.body).toBe(200);
    expect(planned.json()).toMatchObject({ from: '1.0.0', to: '1.0.1', connectionId: h.connectionId, plan: { installable: true, requiresSchemaChange: true } });
    expect(planned.json().plan.create.map((table: { ref: string }) => table.ref).sort()).toEqual(['counts', 'units']);
    // The plan wrote nothing.
    expect((await row(h)).version).toBe('1.0.0');
    expect(await h.tableNames()).not.toContain('stock_kit_counts');

    const reply = await post(h, '/add-ons/stock-kit/update', { planChecksum: planned.json().checksum });
    expect(reply.statusCode, reply.body).toBe(200);
    const body = reply.json();
    expect(body).toMatchObject({ from: '1.0.0', to: '1.0.1', connectionId: h.connectionId });
    expect([...body.schema.created].sort()).toEqual(['counts', 'units']);
    expect(await row(h)).toMatchObject({ version: '1.0.1', status: 'installed' });
    expect(await h.tableNames()).toEqual(expect.arrayContaining(['stock_kit_counts', 'stock_kit_units']));
    // The row that was there is there, with the new column empty.
    expect((await h.rows('SELECT name, bin FROM stock_kit_items')).map((item) => [item['name'], item['bin']])).toEqual([['Flour', null]]);
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit');
    expect(records.filter((record) => record.state === 'created').map((record) => record.ref).sort()).toEqual(['counts', 'items', 'takes', 'units']);
    // The index it now declares, on a table with history.
    await h.introspect();
    const takes = ((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { name: string; indexes: { columns: string[] }[] }[] }).tables.find((table) => table.name === 'stock_kit_takes')!;
    expect(takes.indexes.some((index) => index.columns.join(',') === 'item_id,qty')).toBe(true);
    // Its new page, and the grant on it and on the new table.
    expect(await pagesRepo(h.meta).findBySlug(h.connectionId, 'stock-kit-counts')).not.toBeNull();
    const manager = (await rolesRepo(h.meta).findBySlug('stock-kit-manager'))!;
    const held = await permissionsRepo(h.meta).listForRole(manager.id);
    expect(held.some((grant) => grant.resourceKind === 'table' && grant.resourceRef.endsWith('stock_kit_counts'))).toBe(true);
    // Starting rows only for the table this update made: `items` was the owner's already.
    expect(body.seeds).toEqual({ units: 2 });
    expect((await h.rows('SELECT name FROM stock_kit_units ORDER BY id')).map((unit) => unit['name'])).toEqual(['Each', 'Box']);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_items'))[0]!['n'])).toBe(1);
    const audit = (await auditRepo(h.meta).list({ limit: 30 })).filter((entry) => entry.action === 'add-on.upgraded');
    expect(audit).toHaveLength(1);
  });

  it.runIf(available)('keeps a page the owner edited and a role the owner narrowed', async () => {
    h = await ready();
    const pages = pagesRepo(h.meta);
    const page = (await pages.findBySlug(h.connectionId, 'stock-kit-items'))!;
    const edited = structuredClone(page.config) as Record<string, unknown>;
    edited['ownersNote'] = 'ours';
    await pages.replaceConfig(page.id, edited);
    // The owner took the reader's sight of the items page away.
    const reader = (await rolesRepo(h.meta).findBySlug('stock-kit-reader'))!;
    expect(await permissionsRepo(h.meta).revoke(reader.id, 'page', page.id)).toBe(true);

    // And emptied the items: a table the version before already had gets no starting rows, empty or not.
    await sql`delete from stock_kit_items`.execute(await source(h));

    expect((await post(h, '/add-ons/stock-kit/update')).statusCode).toBe(200);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_items'))[0]!['n'])).toBe(0);
    expect(((await pages.findBySlug(h.connectionId, 'stock-kit-items'))!.config as Record<string, unknown>)['ownersNote']).toBe('ours');
    expect((await permissionsRepo(h.meta).listForRole(reader.id)).some((grant) => grant.resourceKind === 'page' && grant.resourceRef === page.id)).toBe(false);
    // The person who installed it is not handed the first role a second time, nor anybody else.
    expect((await auditRepo(h.meta).list({ limit: 50 })).filter((entry) => entry.action === 'user.role.assign')).toHaveLength(1);
  });

  it.runIf(available)('stopped after its tables were made, the row says updating and the same call finishes it', async () => {
    h = await ready({ zone: 'attic' });
    const stopped = await post(h, '/add-ons/stock-kit/update');
    expect(stopped.statusCode, stopped.body).toBe(409);
    expect(stopped.json().error).toMatchObject({ code: 'ADD_ON_UPDATE_INCOMPLETE', details: { stage: 'seeds', from: '1.0.0', to: '1.0.1' } });
    // Not live, and nothing undone: the tables are there, no starting row was kept, and the version has not moved yet.
    expect(await row(h)).toMatchObject({ status: 'updating', version: '1.0.0' });
    expect(await h.tableNames()).toContain('stock_kit_units');
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_units'))[0]!['n'])).toBe(0);
    // The plan of a stopped update can still be read.
    expect((await post(h, '/add-ons/stock-kit/update/plan')).statusCode).toBe(200);
    // The owner adds the choice the row needs; the same call takes the update up where it stopped.
    const zones = (await optionListsRepo(h.meta).findByKey('stock-kit-zones'))!;
    await optionListsRepo(h.meta).update('stock-kit-zones', { items: [...zones.items, { value: 'attic', label: 'Attic' }] });
    const finished = await post(h, '/add-ons/stock-kit/update');
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.json()).toMatchObject({ to: '1.0.1' });
    expect(await row(h)).toMatchObject({ status: 'installed', version: '1.0.1' });
    // A table made by the run that stopped still gets its starting rows: it holds none.
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_units'))[0]!['n'])).toBe(2);
    // And once it is finished there is nothing left to update.
    expect((await post(h, '/add-ons/stock-kit/update')).statusCode).toBe(404);
  });

  it.runIf(available)('stopped at the very end, with the version already moved, the same call still finishes it', async () => {
    h = await ready();
    expect((await post(h, '/add-ons/stock-kit/update')).statusCode).toBe(200);
    // As a stop between "the version moved" and "it is live again" leaves it.
    const rows = manifestsRepo(h.meta, CRYPTO);
    await rows.setStatus((await row(h)).id, 'updating');
    const finished = await post(h, '/add-ons/stock-kit/update');
    expect(finished.statusCode, finished.body).toBe(200);
    expect(finished.json()).toMatchObject({ from: '1.0.1', to: '1.0.1' });
    expect(await row(h)).toMatchObject({ status: 'installed', version: '1.0.1' });
    // Nothing was made or seeded a second time.
    expect(finished.json().schema.created).toEqual([]);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_units'))[0]!['n'])).toBe(2);
  });

  it.runIf(available)('a version that brings its first tables says where they went', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const plain = { ...stockKitManifest(), version: '0.9.0' } as Record<string, unknown>;
    for (const block of ['requiredSchema', 'pages', 'roles', 'optionLists']) delete plain[block];
    await h.stageAddOn(plain);
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '0.9.0', attachTo: [] })).statusCode).toBe(200);
    expect((await row(h)).connectionId).toBeNull();
    // The owner keeps tables of their own under the kit's plain names: they are not the kit's, and are never taken for it.
    const own = await source(h);
    await sql.raw('CREATE TABLE items (id INT PRIMARY KEY)').execute(own);
    await sql.raw('CREATE TABLE takes (id INT PRIMARY KEY)').execute(own);
    await h.introspect();
    await h.stageAddOn(stockKitManifest());
    const reply = await post(h, '/add-ons/stock-kit/update');
    expect(reply.statusCode, reply.body).toBe(200);
    expect(await row(h)).toMatchObject({ version: '1.0.0', status: 'installed', connectionId: h.connectionId });
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit');
    expect(records.map((record) => [record.tableName, record.owned, record.state]).sort()).toEqual([['stock_kit_items', true, 'created'], ['stock_kit_takes', true, 'created']]);
    expect(await h.tableNames()).toEqual(expect.arrayContaining(['stock_kit_items', 'stock_kit_takes']));
  });

  it.runIf(available)('refuses a plan the database has moved away from, before anything moves', async () => {
    h = await ready();
    const planned = await post(h, '/add-ons/stock-kit/update/plan');
    // Somebody adds the column the version brings, by hand, in between: the plan that was read is no longer the plan.
    await sql.raw('ALTER TABLE stock_kit_items ADD COLUMN bin VARCHAR(20)').execute(await source(h));
    await h.introspect();
    const reply = await post(h, '/add-ons/stock-kit/update', { planChecksum: planned.json().checksum });
    expect(reply.statusCode, reply.body).toBe(409);
    expect(reply.json().error.code).toBe('SCHEMA_DRIFT');
    expect(await row(h)).toMatchObject({ status: 'installed', version: '1.0.0' });
  });

  it.runIf(available)('the old upgrade door still refuses a version that changes a table, and moves nothing', async () => {
    h = await ready();
    const reply = await post(h, '/add-ons/stock-kit/upgrade');
    expect(reply.statusCode, reply.body).toBe(422);
    expect(reply.body).toContain('requiresSchemaChange');
    expect(await row(h)).toMatchObject({ status: 'installed', version: '1.0.0' });
    expect(await h.tableNames()).not.toContain('stock_kit_counts');
  });
});

describe('an update of an add-on that keeps no tables of its own', () => {
  it('moves the version as it always did, through either door', async () => {
    const before = (version: string): Record<string, unknown> => ({
      kind: 'add-on',
      manifestVersion: 1,
      key: 'papers',
      name: 'Papers',
      version,
      publisher: { id: 'adminium', name: 'Adminium' },
      license: 'MIT',
      description: { key: 'papers.line', fallback: 'Prints.' },
      categories: ['data'],
      compatibility: { minAdminiumVersion: '0.3.1' },
      addOn: { attaches: [{ app: '*', range: '*' }], connect: { kind: 'none' }, hostApi: 1 },
    });
    h = await addOnHarness('sqlite');
    await h.stageAddOn(before('1.0.0'));
    expect((await post(h, '/add-ons', { key: 'papers', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    await h.stageAddOn(before('1.0.1'));
    const updated = await post(h, '/add-ons/papers/update');
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json()).toMatchObject({ from: '1.0.0', to: '1.0.1' });
    expect(updated.json()).not.toHaveProperty('schema');
    await h.stageAddOn(before('1.0.2'));
    expect((await post(h, '/add-ons/papers/upgrade')).json()).toMatchObject({ from: '1.0.1', to: '1.0.2' });
  });
});
