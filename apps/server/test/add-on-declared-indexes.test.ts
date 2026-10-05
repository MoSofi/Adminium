// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN INDEX A TABLE DECLARES over a set of columns is made with the table, and
 * added by an update to a table that already holds rows — over the whole set,
 * under a name that fits. An add-on's table and an app's are treated alike.
 */
import { manifestsRepo, snapshotsRepo } from '@adminium/meta';
import { indexSetName } from '@adminium/manifest';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

interface LiveTable {
  name: string;
  indexes: { name: string; columns: string[]; unique: boolean }[];
}
async function live(harness: Harness, name: string): Promise<LiveTable> {
  await harness.introspect();
  const model = (await snapshotsRepo(harness.meta).latest(harness.connectionId))!.schema as { tables: LiveTable[] };
  return model.tables.find((table) => table.name === name)!;
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((column, at) => column === b[at]);
const over = (table: LiveTable, columns: string[]) => table.indexes.filter((index) => !index.unique && same(index.columns, columns));
const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;

const pk = { ref: 'id', type: 'int', role: 'pk' };
/** A table whose plain index name would pass 63 bytes: Postgres would cut it short, MySQL refuse it. */
const LONG = 'movements_between_two_storage_locations';
const LONG_SET = ['from_location_code', 'to_location_code'];

describe.each(LEGS)('an index a table declares — %s', (dialect, available) => {
  it.runIf(available)('is made with an add-on\'s table, under a hashed name when the plain one is too long', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    const kit = stockKitManifest() as Record<string, unknown> & { requiredSchema: { tables: Record<string, unknown>[] } };
    kit.requiredSchema.tables.find((table) => table['ref'] === 'takes')!['indexes'] = [['item_id', 'qty']];
    kit.requiredSchema.tables.push({ ref: LONG, columns: [pk, { ref: LONG_SET[0], type: 'text', maxLength: 20 }, { ref: LONG_SET[1], type: 'text', maxLength: 20 }], indexes: [LONG_SET] });
    await h.stageAddOn(kit);
    const reply = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'stock-kit', version: '1.0.0', attachTo: [] } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(over(await live(h, 'stock_kit_takes'), ['item_id', 'qty']).map((index) => index.name)).toEqual(['ix_stock_kit_takes_item_id_qty']);
    const hashed = indexSetName(`stock_kit_${LONG}`, LONG_SET);
    expect(Buffer.byteLength(`ix_stock_kit_${LONG}_${LONG_SET.join('_')}`)).toBeGreaterThan(63);
    expect(Buffer.byteLength(hashed)).toBeLessThanOrEqual(63);
    expect(over(await live(h, `stock_kit_${LONG}`), LONG_SET).map((index) => index.name)).toEqual([hashed]);
  });

  /** A shop with a table of lines; its second version indexes them by order and day. */
  const shop = (version: string, indexes?: string[][]) => ({
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: indexes === undefined ? '0.3.1' : '0.3.18' },
    pages: [{ ref: 'lines', template: 'page-crud', title: { key: 't', fallback: 'Lines' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'order_lines' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    requiredSchema: {
      tables: [{ ref: 'order_lines', columns: [pk, { ref: 'order_no', type: 'int' }, { ref: 'day', type: 'date', nullable: true }, { ref: 'note', type: 'text', maxLength: 40, nullable: true }], ...(indexes === undefined ? {} : { indexes }) }],
    },
  });

  it.runIf(available)('is added by an update to a table that already holds rows, over the whole set', async () => {
    h = await addOnHarness(dialect);
    await h.stageApp(shop('0.1.0'));
    expect((await h.install('shop', '0.1.0')).statusCode).toBe(200);
    const db = await source(h);
    for (const [id, order] of [[1, 10], [2, 10], [3, 11]]) await sql`insert into ${sql.table('order_lines')} (id, order_no) values (${id}, ${order})`.execute(db);
    // Somebody indexed the first column alone: that says nothing about the pair.
    await sql`create index by_order on ${sql.table('order_lines')} (order_no)`.execute(db);
    await h.introspect();
    await h.stageApp(shop('0.2.0', [['order_no', 'day'], ['note']]));
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update' });
    expect(updated.statusCode, updated.body).toBe(200);
    const lines = await live(h, 'order_lines');
    expect(over(lines, ['order_no', 'day']).map((index) => index.name)).toEqual(['ix_order_lines_order_no_day']);
    expect(over(lines, ['note']).map((index) => index.name)).toEqual(['ix_order_lines_note']);
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM order_lines'))[0]!['n'])).toBe(3);
    // The same version asked for again changes nothing: no index is made a second time.
    const names = lines.indexes.map((index) => index.name).sort();
    await h.stageApp(shop('0.2.1', [['order_no', 'day'], ['note']]));
    expect((await h.inject({ method: 'POST', url: '/apps/shop/update' })).statusCode).toBe(200);
    expect((await live(h, 'order_lines')).indexes.map((index) => index.name).sort()).toEqual(names);
  });

  it.runIf(available)('a receipt table found without its key gains it only when no two rows break it', async () => {
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
    const install = () => h!.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
    expect((await install()).statusCode).toBe(200);
    const db = await source(h);
    const key = ((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { name: string; uniques: { name: string | null; columns: string[] }[]; indexes: { name: string; columns: string[]; unique: boolean }[] }[] }).tables.find((table) => table.name === 'ledger_kit_postings')!;
    const keyName = key.uniques.find((unique) => unique.columns.length === 6)?.name ?? key.indexes.find((index) => index.unique && index.columns.length === 6)!.name;
    await (dialect === 'postgres' ? sql.raw(`ALTER TABLE ledger_kit_postings DROP CONSTRAINT ${keyName}`) : dialect === 'mysql' ? sql.raw(`ALTER TABLE ledger_kit_postings DROP INDEX ${keyName}`) : sql.raw(`DROP INDEX ${keyName}`)).execute(db).catch(() => undefined);
    const at = dialect === 'sqlite' ? sql`'2026-10-06T10:00:00.000Z'` : sql`CURRENT_TIMESTAMP`;
    const receipt = (id: number) =>
      sql`insert into ledger_kit_postings (id, source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${sql.ref('rows')}, add_on_version, origin, ${sql.ref('by')}, ${sql.ref('at')})
          values (${id}, 'shop:orders', '7', 'L1', 'shop:lines', 'units', 'use', 'line', 'post', 1, 'planned', 1, '1.0.0', 'staff', 'u1', ${at})`.execute(db);
    await receipt(1);
    if (dialect === 'sqlite') return; // SQLite keeps a table's unique rule inside the table: it cannot be dropped to stage this.
    await receipt(2);
    await h.introspect();
    const rows = manifestsRepo(h.meta, CRYPTO);
    await rows.setStatus((await rows.findByKey('ledger-kit'))!.row.id, 'installing');
    // Two receipts for one posting: the key cannot be made, and the install says which table and why.
    const refused = await install();
    expect(refused.statusCode, refused.body).not.toBe(200);
    expect(refused.body).toContain('UNIQUE_DUPLICATES');
    await sql`delete from ledger_kit_postings where id = 2`.execute(db);
    const mended = await install();
    expect(mended.statusCode, mended.body).toBe(200);
    await expect(receipt(3)).rejects.toThrow();
  });
});
