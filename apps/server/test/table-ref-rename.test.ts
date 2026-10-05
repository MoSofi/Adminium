// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A column that keeps a table's name, after that table is renamed. A table
 * nobody made is kept by its id, which is its name: those rows are rewritten.
 * A table a manifest made is kept by its maker and short name, which a rename
 * does not change: those rows are left alone.
 */
import { appTablesRepo, manifestsRepo, overridesRepo, snapshotsRepo } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';

import { countTableRefs, repairTableRefs, tableRefRewrites } from '../src/schema-ddl/rename-repair.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEGS } from './invoicing-install.helpers.js';

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

describe.each(LEGS)('rows that name a renamed table — %s', (dialect, available) => {
  /** An owner's `notes`, and a log whose `source_table` keeps a table's name. Answers the ids and the handle. */
  async function world() {
    h = await addOnHarness(dialect);
    const db = (await h.manager.data(h.connectionId)).db as unknown as Kysely<unknown>;
    await sql.raw('CREATE TABLE notes (id INT PRIMARY KEY, body VARCHAR(40))').execute(db);
    await sql.raw('CREATE TABLE kit_log (id INT PRIMARY KEY, source_table VARCHAR(120), said VARCHAR(120))').execute(db);
    await h.introspect();
    const model = (await snapshotsRepo(h.meta).latest(h.connectionId))!.schema as { tables: { id: string; name: string }[] };
    const idOf = (name: string) => model.tables.find((table) => table.name === name)!.id;
    const notes = idOf('notes');
    const moved = notes.replace(/notes$/, 'memos');
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.tableRef', tableName: idOf('kit_log'), columnName: 'source_table', value: { tableRef: true }, origin: 'app' });
    // `said` carries a rule too, of another kind: only the mark makes a column one that keeps a table's name.
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.label', tableName: idOf('kit_log'), columnName: 'said', value: { label: 'Said' }, origin: 'user' });
    const rows: [number, string | null, string][] = [[1, notes, notes], [2, notes, 'x'], [3, 'shop:orders', 'x'], [4, null, 'x'], [5, `${notes}x`, 'x']];
    for (const [id, source, said] of rows) await sql`insert into kit_log (id, source_table, said) values (${id}, ${source}, ${said})`.execute(db);
    const read = async () => (await h!.rows('SELECT source_table, said FROM kit_log ORDER BY id')).map((row) => [row['source_table'], row['said']]);
    return { db, notes, moved, log: idOf('kit_log'), read, meta: h.meta, connectionId: h.connectionId };
  }

  it.runIf(available)('are counted before the rename and rewritten after it, in the marked column only', async () => {
    const w = await world();
    expect(await countTableRefs({ meta: w.meta, connectionId: w.connectionId, tableId: w.notes, db: w.db })).toBe(2);
    expect(await tableRefRewrites({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }] })).toEqual([{ table: w.log, column: 'source_table', from: w.notes, to: w.moved }]);
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }], db: w.db })).toEqual({ rows: 2, failed: 0 });
    expect(await w.read()).toEqual([[w.moved, w.notes], [w.moved, 'x'], ['shop:orders', 'x'], [null, 'x'], [`${w.notes}x`, 'x']]);
    // Nothing names the old id any more: a second run rewrites nothing.
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }], db: w.db })).toEqual({ rows: 0, failed: 0 });
  });

  it.runIf(available)('are left alone when a manifest made the table: its stored name is its maker\'s, and the record followed the rename', async () => {
    const w = await world();
    const app = await manifestsRepo(w.meta, { encrypt: (v: string) => v, decrypt: (v: string) => v }).install({ manifestKey: 'shop', version: '0.3.0', kind: 'app', source: 'file', document: { kind: 'app', key: 'shop' }, connectionId: w.connectionId });
    // The record already carries the table's new name, as it does once Adminium's own references followed.
    const record = await appTablesRepo(w.meta).record({ appKey: 'shop', manifestId: app.row.id, connectionId: w.connectionId, ref: 'notes', tableName: 'memos', owned: true, state: 'created', prefix: null });
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }], db: w.db })).toEqual({ rows: 0, failed: 0 });
    expect((await w.read())[0]).toEqual([w.notes, w.notes]);
    // A table the app only found and took has no maker: its rows are kept by id, and follow.
    await appTablesRepo(w.meta).setState(record.id, 'dropped');
    await appTablesRepo(w.meta).record({ appKey: 'shop', manifestId: app.row.id, connectionId: w.connectionId, ref: 'memos', tableName: 'memos', owned: false, state: 'adopted', prefix: null });
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }], db: w.db })).toEqual({ rows: 2, failed: 0 });
  });

  it.runIf(available)('a column that cannot be rewritten is counted, and the others still are', async () => {
    const w = await world();
    await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.tableRef', tableName: w.log.replace(/kit_log$/, 'gone'), columnName: 'source_table', value: { tableRef: true }, origin: 'app' });
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }], db: w.db })).toEqual({ rows: 2, failed: 1 });
  });

  it.runIf(available)('nothing is asked of the database when no column keeps a table\'s name, or nothing was renamed', async () => {
    const w = await world();
    expect(await repairTableRefs({ meta: w.meta, connectionId: w.connectionId, renames: [], db: w.db })).toEqual({ rows: 0, failed: 0 });
    for (const row of await overridesRepo(w.meta).listForConnection(w.connectionId)) await overridesRepo(w.meta).delete(row.id);
    expect(await tableRefRewrites({ meta: w.meta, connectionId: w.connectionId, renames: [{ from: w.notes, to: w.moved }] })).toEqual([]);
  });
});
