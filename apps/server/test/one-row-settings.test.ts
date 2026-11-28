// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A TABLE AN APP KEEPS TO ONE ROW (its settings): one row, and every reader
 * reading the same one.
 *
 *  - the write service refuses a create there while the table holds a row,
 *    and a batch of more than one row outright, on every create path (a
 *    save, a batch check, a before step, a tree); a change of the row, and a
 *    table that is not kept to one row, are let through;
 *  - a table that holds more rows anyway (rows from before the refusal, or
 *    written outside Adminium) is read by its first row by key on every
 *    reader: a rule's setting, a moment, a booking limit, a public switch, a
 *    guest's list maximum. Here the row with the lowest key is written LAST,
 *    so the database's own order hands back the other one first.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SourceDatabase } from '../src/connections/manager.js';
import { settingOf } from '../src/crud/capacity-guard.js';
import { Reads } from '../src/crud/capacity/count.js';
import type { ResolvedColumn, ResolvedTable, SnapshotView } from '../src/crud/identifiers.js';
import { momentSettings } from '../src/crud/moments.js';
import { settingValue } from '../src/crud/rule-settings.js';
import { settingsColumn, settingsKey, settingsRow } from '../src/crud/settings-row.js';
import { createWriteService, ONE_ROW_REFUSAL, type WriteContext, type WriteTarget } from '../src/crud/write-service.js';
import { createSwitches } from '../src/public-api/switches.js';
import { judgeSumMax } from '../src/public-api/tree-checks.js';

function column(name: string, logicalType: ResolvedColumn['logicalType'], extra: Partial<ResolvedColumn> = {}): ResolvedColumn {
  return { name, logicalType, nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: false, ...extra };
}

function tableOf(name: string): ResolvedTable {
  return {
    id: `main.${name}`,
    schema: 'main',
    name,
    primaryKey: ['id'],
    columns: new Map([column('id', 'integer', { isPrimaryKey: true, nullable: false }), column('name', 'text')].map((c) => [c.name, c])),
    readOnly: false,
    table: {} as ResolvedTable['table'],
  };
}

const person: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_1', label: 'Ada' }, request: null };
const throughKey: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'public:key_1' }, request: null, publicKey: 'key_1' };

let raw: BetterSqlite3.Database;
let db: Kysely<SourceDatabase>;

beforeEach(() => {
  raw = new BetterSqlite3(':memory:');
  db = new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: raw }) });
});

afterEach(async () => {
  await db.destroy();
});

const announce = async (): Promise<void> => {};
const count = (name: string): number => (raw.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get() as { n: number }).n;

describe('a create in a table kept to one row', () => {
  const settings = tableOf('settings');
  const notes = tableOf('notes');
  const view = { table: (name: string) => (name === 'notes' || name === 'main.notes' ? notes : settings), linkTable: () => null } as unknown as SnapshotView;
  const on = (table: ResolvedTable): WriteTarget => ({ connectionId: 'conn_1', view, table, db, dialect: 'sqlite' });
  const writes = createWriteService({ oneRow: async (connectionId, tableId) => connectionId === 'conn_1' && tableId === 'main.settings' });

  beforeEach(() => {
    raw.exec('CREATE TABLE settings (id INTEGER PRIMARY KEY, name TEXT)');
    raw.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, name TEXT)');
  });

  it('makes the first row, and refuses a second by name, whoever asks', async () => {
    await writes.create({ target: on(settings), values: { name: 'Birch Row' }, context: person, announce });
    expect(count('settings')).toBe(1);
    for (const context of [person, throughKey]) {
      await expect(writes.create({ target: on(settings), values: { name: 'Fernlight' }, context, announce })).rejects.toMatchObject({
        statusCode: 409,
        code: 'ONE_ROW_TABLE',
        message: "This table holds the app's settings: it has one row. Edit that row.",
        details: { table: 'main.settings' },
      });
    }
    expect(ONE_ROW_REFUSAL).toBe("This table holds the app's settings: it has one row. Edit that row.");
    expect(count('settings')).toBe(1);
  });

  it('refuses a file brought in or a bulk create: its check and its before step', async () => {
    // Two rows into an empty table would make two settings rows: refused outright.
    await expect(writes.check('create', on(settings), { ...person, origin: 'import' }, [{ name: 'a' }, { name: 'b' }])).rejects.toMatchObject({ code: 'ONE_ROW_TABLE' });
    await expect(writes.beforeEach('create', on(settings), { ...person, origin: 'bulk' }, [{ values: { name: 'a' } }, { values: { name: 'b' } }])).rejects.toMatchObject({ code: 'ONE_ROW_TABLE' });
    // One row into an empty table is the first: let through.
    const first = await writes.check('create', on(settings), { ...person, origin: 'import' }, [{ name: 'a' }]);
    expect(first.rows[0]).not.toBeNull();
    raw.exec("INSERT INTO settings (id, name) VALUES (1, 'Birch Row')");
    await expect(writes.check('create', on(settings), { ...person, origin: 'import' }, [{ name: 'b' }])).rejects.toMatchObject({ code: 'ONE_ROW_TABLE' });
    await expect(writes.beforeEach('create', on(settings), { ...person, origin: 'automation' }, [{ values: { name: 'b' } }])).rejects.toMatchObject({ code: 'ONE_ROW_TABLE' });
    // Sample data's values for the row that is there (`@fillEmpty`) are no new row.
    const filling = await writes.check('create', on(settings), { ...person, origin: 'import' }, [{ name: 'b' }], { fillsHeldRow: true });
    expect(filling.rows[0]).not.toBeNull();
    expect(count('settings')).toBe(1);
  });

  it('changes the row it holds, and leaves every other table as it was', async () => {
    raw.exec("INSERT INTO settings (id, name) VALUES (1, 'Birch Row')");
    await writes.update({ target: on(settings), pk: { id: 1 }, values: { name: 'Fernlight' }, context: person, announce });
    expect(raw.prepare('SELECT name FROM settings').all()).toEqual([{ name: 'Fernlight' }]);
    await writes.create({ target: on(notes), values: { name: 'one' }, context: person, announce });
    await writes.create({ target: on(notes), values: { name: 'two' }, context: person, announce });
    expect(count('notes')).toBe(2);
    // A service with no one-row answer (a test's, an older caller's) keeps every create.
    await createWriteService().create({ target: on(settings), values: { name: 'second' }, context: person, announce });
    expect(count('settings')).toBe(2);
  });
});

describe('a settings table holding two rows is read by its first row by key, everywhere', () => {
  beforeEach(() => {
    // A text key: the database hands rows back in the order they were written, so `b` comes first.
    raw.exec('CREATE TABLE settings (code TEXT PRIMARY KEY, name TEXT, cancel_hours INTEGER, online_on INTEGER, most INTEGER)');
    raw.exec("INSERT INTO settings (code, name, cancel_hours, online_on, most) VALUES ('b', 'Stray', 48, 0, 9)");
    raw.exec("INSERT INTO settings (code, name, cancel_hours, online_on, most) VALUES ('a', 'Fernlight', 24, 1, 3)");
  });

  it('the database alone hands back the stray row first (what the readers used to take)', async () => {
    expect((await db.selectFrom('main.settings').select('name').limit(1).executeTakeFirst())?.['name']).toBe('Stray');
  });

  it('the key comes from the catalog, in key order; a table with none, or none at all, has none', async () => {
    expect(await settingsKey(db, 'main.settings')).toEqual(['code']);
    raw.exec('CREATE TABLE pairs (b TEXT, a TEXT, v TEXT, PRIMARY KEY (b, a))');
    expect(await settingsKey(db, 'main.pairs')).toEqual(['b', 'a']);
    raw.exec('CREATE TABLE loose (v TEXT)');
    expect(await settingsKey(db, 'main.loose')).toEqual([]);
    expect(await settingsKey(db, 'main.nowhere')).toEqual([]);
    // Made since it was asked: found the next time.
    raw.exec('CREATE TABLE nowhere (id INTEGER PRIMARY KEY)');
    expect(await settingsKey(db, 'main.nowhere')).toEqual(['id']);
  });

  it('the shared reader: the whole row, some columns, one column', async () => {
    expect(await settingsRow(db, 'main.settings')).toMatchObject({ code: 'a', name: 'Fernlight' });
    expect(await settingsRow(db, 'main.settings', ['name'])).toEqual({ name: 'Fernlight' });
    expect(await settingsColumn(db, 'main.settings', 'name')).toBe('Fernlight');
    raw.exec('CREATE TABLE empty_settings (id INTEGER PRIMARY KEY, name TEXT)');
    expect(await settingsRow(db, 'main.empty_settings')).toBeUndefined();
    expect(await settingsColumn(db, 'main.empty_settings', 'name')).toBeUndefined();
  });

  it('inside a transaction, as a write reads it', async () => {
    await db.transaction().execute(async (trx) => {
      expect(await settingsColumn(trx as unknown as Kysely<SourceDatabase>, 'main.settings', 'name')).toBe('Fernlight');
    });
  });

  it("a rule's setting (a fill, a prefix, a number's start)", async () => {
    expect(await settingValue(db, { table: 'main.settings', column: 'name' }, undefined)).toBe('Fernlight');
  });

  it('a moment: the row the page edits, where it used to read nothing at all with two rows', async () => {
    const read = momentSettings(db);
    expect(await read({ table: 'main.settings', column: 'cancel_hours' })).toBe(24);
    // What cannot be read is still nothing.
    expect(await read({ table: 'main.settings', column: 'missing' })).toBeUndefined();
  });

  it('a booking limit, read alone or once per judge call', async () => {
    expect(await settingOf(db, { table: 'main.settings', column: 'cancel_hours' })).toBe(24);
    const reads = new Reads(db);
    expect(await reads.setting({ table: 'main.settings', column: 'cancel_hours' })).toBe(24);
    expect(await reads.setting({ table: 'main.settings', column: 'name' })).toBe('Fernlight');
  });

  it("a public switch: the row's own, not 'on only when every row is on'", async () => {
    expect(await createSwitches(async () => db).isOn('c1', 'main.settings', 'online_on')).toBe(true);
    raw.exec("UPDATE settings SET online_on = 0 WHERE code = 'a'");
    raw.exec("UPDATE settings SET online_on = 1 WHERE code = 'b'");
    expect(await createSwitches(async () => db).isOn('c1', 'main.settings', 'online_on')).toBe(false);
  });

  it("a guest's list adds up to the maximum the settings row says", async () => {
    const rows = [{ qty: 2 }, { qty: 2 }];
    // 4 is over the row's 3 (and under the stray row's 9).
    await expect(judgeSumMax(db, 'items', { column: 'qty', max: { table: 'main.settings', column: 'most' } } as never, rows)).rejects.toBeDefined();
    await expect(judgeSumMax(db, 'items', { column: 'qty', max: { table: 'main.settings', column: 'most' } } as never, [{ qty: 3 }])).resolves.toBeUndefined();
  });
});
