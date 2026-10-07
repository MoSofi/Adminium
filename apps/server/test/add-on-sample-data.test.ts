// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ADD-ON'S OWN SAMPLE DATA: the rows its package ships, added to its own
 * tables and listed so they can be taken out again — through the four routes
 * an app has. The rows come from the ADD-ON's package; the totals they feed
 * are settled; a row may name one of the add-on's tables the way rows name a
 * table; a row somebody changed is kept when asked.
 */
import { appTablesRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner, registerSampleDataHandler } from '../src/apps/sample-data.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
/** The stock kit with a table of notes that name another table, and sample rows of its own. */
function kit(): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const manifest = stockKitManifest() as Record<string, unknown> & { requiredSchema: { tables: unknown[] } };
  manifest.requiredSchema.tables.push({ ref: 'notes', columns: [pk, { ref: 'about_table', type: 'text', maxLength: 64, rules: { tableRef: true } }, { ref: 'body', type: 'text', maxLength: 80, nullable: true }] });
  manifest['sampleData'] = { file: 'seeds/stock.sample.json' };
  const bundle = {
    format: 'adminium.sample/1',
    app: 'stock-kit',
    tables: [
      { ref: 'items', rows: [{ '@label': 'flour', name: 'Flour', zone: 'shelf', opening: '10.00' }, { '@label': 'salt', name: 'Salt', opening: '4.00' }, { name: 'Yeast', opening: '1.00' }] },
      { ref: 'takes', rows: [{ item_id: { '@ref': 'flour' }, qty: '2.50' }, { item_id: { '@ref': 'flour' }, qty: '1.50' }, { item_id: { '@ref': 'salt' }, qty: '4.00' }] },
      { ref: 'notes', rows: [{ about_table: { '@table': 'items' }, body: 'Counted on Monday' }] },
    ],
  };
  return { manifest, files: { 'seeds/stock.sample.json': JSON.stringify(bundle) } };
}
const get = (harness: Harness, url: string) => harness.inject({ method: 'GET', url });
const post = (harness: Harness, url: string, payload?: Record<string, unknown>) => harness.inject({ method: 'POST', url, ...(payload === undefined ? {} : { payload }) });
const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;
/** What the job does on a real server: the add, run to its end. */
async function add(harness: Harness) {
  const owner = (await findSampleOwner(harness.meta, 'stock-kit', 'add-on'))!;
  return createSampleDataService(harness.sampleData).add(owner, { locale: 'en-US', userId: harness.owner.id, userLabel: 'owner@test' });
}

describe.each(LEGS)('an add-on\'s own sample data — %s', (dialect, available) => {
  async function installed(): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const { manifest, files } = kit();
    await harness.stageAddOn(manifest, { files });
    const reply = await post(harness, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] });
    expect(reply.statusCode, reply.body).toBe(200);
    return harness;
  }

  it.runIf(available)('is offered, added from the add-on\'s package, settled, listed and removed, through the routes an app has', async () => {
    h = await installed();
    const before = await get(h, '/add-ons/stock-kit/sample-data');
    expect(before.statusCode, before.body).toBe(200);
    expect(before.json()).toMatchObject({ offered: true, loaded: false, total: 0 });
    expect(before.json().available).not.toBeNull();
    const queued = await post(h, '/add-ons/stock-kit/sample-data');
    expect(queued.statusCode, queued.body).toBe(200);
    expect(typeof queued.json().jobId).toBe('string');

    const added = await add(h);
    expect(added.counts).toEqual({ items: 3, takes: 3, notes: 1 });
    // The totals its rows feed are settled, with nothing judged: what was taken, and what is left.
    const items = await h.rows(`SELECT name, taken, ${dialect === 'mysql' ? '`left`' : '"left"'} AS remaining FROM stock_kit_items ORDER BY id`);
    expect(items.map((item) => [item['name'], Number(item['taken']), Number(item['remaining'])])).toEqual([['Flour', 4, 6], ['Salt', 4, 0], ['Yeast', 0, 1]]);
    // A row names one of its tables the way rows name a table: by who made it and its short name.
    expect((await h.rows('SELECT about_table FROM stock_kit_notes')).map((note) => note['about_table'])).toEqual(['stock-kit:items']);

    const loaded = (await get(h, '/add-ons/stock-kit/sample-data')).json();
    expect(loaded).toMatchObject({ offered: true, loaded: true, total: 7, available: null });
    // The list of sample rows is a table of its own, under the add-on's prefix, recorded as such and never listed as data.
    expect(await h.tableNames()).toContain('stock_kit_sample_data');
    const ledger = (await appTablesRepo(h.meta).forInstall(h.connectionId, 'stock-kit')).find((record) => record.role === 'sample-ledger');
    expect(ledger).toMatchObject({ tableName: 'stock_kit_sample_data', state: 'created' });
    expect(loaded.tables.map((table: { ref: string }) => table.ref).sort()).toEqual(['items', 'notes', 'takes']);

    const plan = await post(h, '/add-ons/stock-kit/sample-data/remove-plan');
    expect(plan.statusCode, plan.body).toBe(200);
    expect(plan.json().total).toBe(7);
    const removed = await post(h, '/add-ons/stock-kit/sample-data/remove', { keepChanged: true });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json()).toMatchObject({ removed: 7, kept: 0 });
    for (const table of ['items', 'takes', 'notes']) expect(Number((await h.rows(`SELECT COUNT(*) AS n FROM stock_kit_${table}`))[0]!['n']), table).toBe(0);
    expect((await get(h, '/add-ons/stock-kit/sample-data')).json()).toMatchObject({ loaded: false });
  });

  it.runIf(available)('a row changed since is kept when asked, and the owner\'s own rows are never taken', async () => {
    h = await installed();
    await add(h);
    const db = await source(h);
    await sql`update stock_kit_items set name = 'Bread flour' where name = 'Flour'`.execute(db);
    await sql`insert into stock_kit_items (name, opening) values ('Our own', 3)`.execute(db);
    const removed = await post(h, '/add-ons/stock-kit/sample-data/remove', { keepChanged: true });
    expect(removed.statusCode, removed.body).toBe(200);
    const left = (await h.rows('SELECT name FROM stock_kit_items ORDER BY id')).map((item) => item['name']);
    expect(left).toContain('Bread flour');
    expect(left).toContain('Our own');
    expect(left).not.toContain('Salt');
  });
});

/** The stock kit with starting rows a sample can name: shelves told apart by a code, causes by their name (in the installing person's language). */
function seededKit(): { manifest: Record<string, unknown>; files: Record<string, string> } {
  const manifest = stockKitManifest() as Record<string, unknown> & { requiredSchema: { tables: unknown[] } };
  manifest.requiredSchema.tables.push(
    { ref: 'shelves', columns: [pk, { ref: 'code', type: 'text', maxLength: 12, unique: true }, { ref: 'name', type: 'text', maxLength: 40 }] },
    { ref: 'causes', keyField: 'label', columns: [pk, { ref: 'label', type: 'text', maxLength: 40 }] },
    {
      ref: 'tags',
      columns: [pk, { ref: 'shelf_id', type: 'fk', references: 'shelves' }, { ref: 'cause_id', type: 'fk', references: 'causes', nullable: true }, { ref: 'body', type: 'text', maxLength: 80 }],
    },
  );
  manifest['seeds'] = [
    { table: 'shelves', rows: [{ '@label': 'shelf:top', code: 'top', name: { '@t': { 'en-US': 'Top shelf', 'de-DE': 'Oberes Regal' } } }, { '@label': 'shelf:low', code: 'low', name: { '@t': { 'en-US': 'Low shelf' } } }, { code: 'back', name: 'Back' }] },
    { table: 'causes', rows: [{ '@label': 'cause:broken', label: { '@t': { 'en-US': 'Broken', 'de-DE': 'Kaputt' } } }] },
  ];
  manifest['sampleData'] = { file: 'seeds/stock.sample.json' };
  const bundle = {
    format: 'adminium.sample/1',
    app: 'stock-kit',
    tables: [
      {
        ref: 'tags',
        rows: [
          { '@label': 'tag:first', shelf_id: { '@ref': 'shelf:top' }, cause_id: { '@ref': 'cause:broken' }, body: 'On the top shelf' },
          { shelf_id: { '@ref': 'shelf:low' }, body: 'On the low shelf' },
        ],
      },
    ],
  };
  return { manifest, files: { 'seeds/stock.sample.json': JSON.stringify(bundle) } };
}

describe.each(LEGS)('a sample row names a row the install seeded — %s', (dialect, available) => {
  async function installed(locale?: string): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    const { manifest, files } = seededKit();
    await harness.stageAddOn(manifest, { files });
    const reply = await harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] }, ...(locale === undefined ? {} : { headers: { 'accept-language': locale } }) });
    expect(reply.statusCode, reply.body).toBe(200);
    return harness;
  }
  const tags = async (harness: Harness) =>
    (await harness.rows('SELECT t.body AS body, s.code AS shelf, c.label AS cause FROM stock_kit_tags t JOIN stock_kit_shelves s ON s.id = t.shelf_id LEFT JOIN stock_kit_causes c ON c.id = t.cause_id ORDER BY t.id')).map((row) => [row['body'], row['shelf'], row['cause'] ?? null]);
  const count = async (harness: Harness, table: string) => Number((await harness.rows(`SELECT COUNT(*) AS n FROM stock_kit_${table}`))[0]!['n']);

  it.runIf(available)('by the starting row\'s label; the starting rows are never the sample\'s to take out', async () => {
    h = await installed();
    const added = await add(h);
    expect(added.counts).toEqual({ tags: 2 });
    expect(await tags(h)).toEqual([['On the top shelf', 'top', 'Broken'], ['On the low shelf', 'low', null]]);
    // Only the sample's own rows are listed: a unit the install seeded is the owner's from the first second.
    expect((await get(h, '/add-ons/stock-kit/sample-data')).json()).toMatchObject({ loaded: true, total: 2 });
    const removed = await post(h, '/add-ons/stock-kit/sample-data/remove', { keepChanged: true });
    expect(removed.json()).toMatchObject({ removed: 2, kept: 0 });
    expect([await count(h, 'tags'), await count(h, 'shelves'), await count(h, 'causes')]).toEqual([0, 3, 1]);
  });

  it.runIf(available)('with that starting row deleted, or renamed where its name is all that tells it apart, the row that names it is left out', async () => {
    h = await installed();
    const db = await source(h);
    await sql`delete from stock_kit_shelves where code = 'low'`.execute(db);
    await sql`update stock_kit_causes set label = 'Smashed'`.execute(db);
    const added = await add(h);
    // The low shelf is gone, so its tag is left out; the first tag names the renamed cause, so it goes too. Nothing fails.
    expect(added.counts).toEqual({});
    expect(await tags(h)).toEqual([]);
    // A shelf is told apart by its code alone: renamed, it is still the row the sample means.
    await post(h, '/add-ons/stock-kit/sample-data/remove', { keepChanged: true });
    await sql`update stock_kit_causes set label = 'Kaputt'`.execute(db);
    await sql`update stock_kit_shelves set name = 'The high one' where code = 'top'`.execute(db);
    expect((await add(h)).counts).toEqual({ tags: 1 });
    expect(await tags(h)).toEqual([['On the top shelf', 'top', 'Kaputt']]);
  });
});

describe('the job an add-on\'s sample is added by', () => {
  it('is queued as the add-on\'s, and the handler adds the add-on\'s rows — never an app\'s of the same key', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    const { manifest, files } = kit();
    await h.stageAddOn(manifest, { files });
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    const queued = await post(h, '/add-ons/stock-kit/sample-data');
    const job = await h.meta.db.selectFrom('adminium_jobs').selectAll().where('id', '=', queued.json().jobId).executeTakeFirstOrThrow();
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as Record<string, unknown>;
    expect(payload).toMatchObject({ key: 'stock-kit', kind: 'add-on' });
    // The handler a real server runs the job with.
    let handler: ((payload: never, ctx: never) => Promise<unknown>) | null = null;
    registerSampleDataHandler({ registerJobHandler: (_kind: string, _schema: unknown, run: typeof handler) => (handler = run) } as never, h.sampleData);
    const result = (await handler!(payload as never, { progress: () => undefined } as never)) as { counts: Record<string, number> };
    expect(result.counts).toEqual({ items: 3, takes: 3, notes: 1 });
  });

  it('an add-on whose install has not finished has no sample to add', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    const { manifest, files } = kit();
    await h.stageAddOn(manifest, { files });
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    await h.meta.db.updateTable('adminium_manifests').set({ status: 'installing' }).where('manifestKey', '=', 'stock-kit').execute();
    expect((await get(h, '/add-ons/stock-kit/sample-data')).statusCode).toBe(404);
    expect((await post(h, '/add-ons/stock-kit/sample-data')).statusCode).toBe(404);
  });

  it('a row that names a table the add-on does not have is refused, and nothing of the add is kept', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    const { manifest, files } = kit();
    const bundle = JSON.parse(files['seeds/stock.sample.json']!) as { tables: { ref: string; rows: Record<string, unknown>[] }[] };
    bundle.tables.find((table) => table.ref === 'notes')!.rows[0]!['about_table'] = { '@table': 'nothing' };
    await h.stageAddOn(manifest, { files: { 'seeds/stock.sample.json': JSON.stringify(bundle) } });
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    // The bundle is read against the manifest before a row is written: a table it does not declare does not fit.
    await expect(add(h)).rejects.toThrow(/does not fit/);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_items'))[0]!['n'])).toBe(0);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM stock_kit_notes'))[0]!['n'])).toBe(0);
  });
});

describe('an add-on with no sample data, or none installed', () => {
  it('offers none, and an add of it is refused by name', async () => {
    h = await addOnHarness('sqlite', { unbuiltWords: {} });
    await h.stageAddOn(stockKitManifest());
    expect((await post(h, '/add-ons', { key: 'stock-kit', version: '1.0.0', attachTo: [] })).statusCode).toBe(200);
    expect((await get(h, '/add-ons/stock-kit/sample-data')).json()).toMatchObject({ offered: false, loaded: false });
    const refused = await post(h, '/add-ons/stock-kit/sample-data');
    expect(refused.statusCode, refused.body).toBe(404);
    expect(refused.json().error.details).toMatchObject({ reason: 'NO_SAMPLE_DATA' });
    expect((await get(h, '/add-ons/absent/sample-data')).statusCode).toBe(404);
    // An APP of that key is not what these routes are about.
    expect(await findSampleOwner(h.meta, 'stock-kit', 'app')).toBeNull();
  });
});
