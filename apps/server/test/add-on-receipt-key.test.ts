// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE KEY A LEDGER'S RECEIPT TABLE IS KEPT BY, and the indexes its rows are
 * read by, are made by Adminium from the ledger's declaration: on the tables
 * an install creates, and on tables it finds already there. A receipt for the
 * same source, line, posting, phase and round is refused by the database.
 */
import { manifestsRepo, snapshotsRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const KEY = ['source_table', 'source_row', 'source_line', 'posting', 'phase', 'round'];

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const install = (harness: Harness) => harness.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
const source = async (harness: Harness) => (await harness.manager.data(harness.connectionId)).db as unknown as Kysely<unknown>;

interface LiveTable {
  name: string;
  indexes: { name: string; columns: string[]; unique: boolean }[];
  uniques: { name: string | null; columns: string[] }[];
}
/** The table as the database has it now, read the way Adminium reads any database. */
async function live(harness: Harness, name: string): Promise<LiveTable> {
  await harness.introspect();
  const model = (await snapshotsRepo(harness.meta).latest(harness.connectionId))!.schema as { tables: LiveTable[] };
  return model.tables.find((table) => table.name === name)!;
}
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((column, at) => column === b[at]);
/** How many of the table's indexes are over exactly these columns, in this order. */
const indexesOver = (table: LiveTable, columns: string[]) => table.indexes.filter((index) => !index.unique && same(index.columns, columns)).length;
/** How many unique rules — constraints, and unique indexes no constraint stands for — are over exactly these columns. */
const uniquesOver = (table: LiveTable, columns: string[]) => {
  const names = new Set([...table.uniques.filter((unique) => same(unique.columns, columns)).map((unique) => unique.name), ...table.indexes.filter((index) => index.unique && same(index.columns, columns)).map((index) => index.name)]);
  return names.size;
};

describe.each(LEGS)('a ledger\'s receipt table — %s', (dialect, available) => {
  async function installed(): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    await harness.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
    const reply = await install(harness);
    expect(reply.statusCode, reply.body).toBe(200);
    return harness;
  }
  const receipt = (db: Kysely<unknown>, id: number, round: number, line = 'L1') =>
    sql`insert into ledger_kit_postings (id, source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${sql.ref('rows')}, add_on_version, origin, ${sql.ref('by')}, ${sql.ref('at')})
        values (${id}, 'shop:orders', '7', ${line}, 'shop:lines', 'units', 'use', 'line', 'post', ${round}, 'planned', 1, '1.0.0', 'staff', 'u1', ${dialect === 'sqlite' ? '2026-10-06T10:00:00.000Z' : sql`CURRENT_TIMESTAMP`})`.execute(db);

  it.runIf(available)('takes one receipt for a source, line, posting, phase and round, and another for the next round', async () => {
    h = await installed();
    const db = await source(h);
    await receipt(db, 1, 1);
    await expect(receipt(db, 2, 1)).rejects.toThrow();
    // The next round of the same posting is another receipt; so is another line.
    await receipt(db, 3, 2);
    await receipt(db, 4, 1, 'L2');
    expect(Number((await h.rows('SELECT COUNT(*) AS n FROM ledger_kit_postings'))[0]!['n'])).toBe(3);
  });

  it.runIf(available)('is made with its key, its two indexes, and an index on each ledger table\'s receipt', async () => {
    h = await installed();
    const postings = await live(h, 'ledger_kit_postings');
    expect(uniquesOver(postings, KEY)).toBe(1);
    expect(indexesOver(postings, ['line_table', 'source_line'])).toBe(1);
    expect(indexesOver(postings, ['held_until'])).toBe(1);
    for (const table of ['ledger_kit_entries', 'ledger_kit_holds']) {
      // On MySQL a foreign key brings its own index; either way exactly one index leads with the receipt.
      expect((await live(h, table)).indexes.filter((index) => index.columns[0] === 'receipt_id'), table).toHaveLength(1);
    }
    // The declared set on the ledger's rows.
    expect(indexesOver(await live(h, 'ledger_kit_entries'), ['account_id', 'kind'])).toBe(1);
  });

  it.runIf(available)('a table found without them gains them when the install runs again, and nothing is made twice', async () => {
    h = await installed();
    const db = await source(h);
    const before = await live(h, 'ledger_kit_postings');
    const drop = (name: string, table: string) => (dialect === 'mysql' ? sql.raw(`ALTER TABLE ${table} DROP INDEX ${name}`) : sql.raw(`DROP INDEX ${name}`)).execute(db);
    // Somebody dropped the index a timed job scans by, and the one a line's guard reads by.
    for (const columns of [['held_until'], ['line_table', 'source_line']]) {
      await drop(before.indexes.find((index) => !index.unique && same(index.columns, columns))!.name, 'ledger_kit_postings');
    }
    await h.introspect();
    const rows = manifestsRepo(h.meta, CRYPTO);
    const again = async () => {
      // The row says the install did not finish: the same call takes it up, over the tables that are there.
      await rows.setStatus((await rows.findByKey('ledger-kit'))!.row.id, 'installing');
      const reply = await install(h!);
      expect(reply.statusCode, reply.body).toBe(200);
      expect(reply.json().schema.created).toEqual([]);
    };
    await again();
    let postings = await live(h, 'ledger_kit_postings');
    expect(indexesOver(postings, ['held_until'])).toBe(1);
    expect(indexesOver(postings, ['line_table', 'source_line'])).toBe(1);
    expect(uniquesOver(postings, KEY)).toBe(1);
    const names = postings.indexes.map((index) => index.name).sort();
    // Once more, with nothing missing: not one index more.
    await again();
    postings = await live(h, 'ledger_kit_postings');
    expect(postings.indexes.map((index) => index.name).sort()).toEqual(names);
    expect((await live(h, 'ledger_kit_entries')).indexes.filter((index) => index.columns[0] === 'receipt_id')).toHaveLength(1);
  });
});
