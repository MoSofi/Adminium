// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Two ways a studio's overview reads its money, on every engine:
 *
 *  - a card window that reaches FORWARD from the venue's today ("not yet due",
 *    "proposals still in date"), on a date column and on time columns, with
 *    and without a zone;
 *  - a link that opens a records page FILTERED (`?f.balance=gt:0`), worked out
 *    on the server against the table and the venue's calendar, then read back
 *    through the list itself.
 *
 * The venue is in Tokyo and the clock is at one in the morning there, which is
 * still yesterday in UTC — so every "today" below is the venue's, not UTC's.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql, type Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { createSqliteMetaDb, firstRun, snapshotsRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager, type SourceDatabase } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import { runList } from '../src/crud/list.js';
import { venueClock } from '../src/crud/venue-time.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { aheadBounds, compileWidgetQuery } from '../src/widget-data/compiler.js';
import { resolveLinkFilters } from '../src/widget-data/link-filters.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';
import { TEST_SECRET } from './helpers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ZONE = 'Asia/Tokyo';
/** 01:00 on Friday 25 September in Tokyo; still Thursday the 24th in UTC. */
const NOW = new Date('2026-09-24T16:00:00Z');

const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

/**
 * Six invoices around the venue's midnight. `at` goes into two time columns:
 * `logged_at` keeps no zone, `sent_at` keeps one where the engine has it.
 */
const INVOICES = [
  { id: 1, due_on: '2026-09-24', at: '2026-09-24T14:59:00Z', balance: '10.00', status: 'sent', flagged: false }, // 23:59 yesterday in Tokyo
  { id: 2, due_on: '2026-09-25', at: '2026-09-24T15:01:00Z', balance: '100.00', status: 'sent', flagged: true }, // 00:01 today
  { id: 3, due_on: '2026-09-26', at: '2026-09-25T15:30:00Z', balance: '1000.00', status: 'draft', flagged: false }, // 00:30 tomorrow
  { id: 4, due_on: '2026-08-10', at: '2026-08-31T15:30:00Z', balance: '0.00', status: 'paid', flagged: false }, // 1 September in Tokyo, 31 August in UTC
  { id: 5, due_on: '2027-12-31', at: null, balance: '10000.00', status: 'sent', flagged: false },
  { id: 6, due_on: '2026-08-31', at: '2026-08-31T14:30:00Z', balance: '5.00', status: 'paid', flagged: false }, // 23:30 on 31 August in Tokyo
];

/** Where a database for one engine lives, and how to drop it again. */
async function freshDatabase(dialect: Dialect, dir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `adminium_links_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dir, 'studio.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

async function createInvoices(dialect: Dialect, db: Kysely<SourceDatabase>): Promise<void> {
  const zoned = dialect === 'postgres' ? 'timestamptz' : dialect === 'mysql' ? 'timestamp null' : 'timestamp';
  const plain = dialect === 'mysql' ? 'datetime' : 'timestamp';
  const flag = 'boolean';
  await sql
    .raw(
      `create table invoices (id integer primary key, due_on date not null, logged_at ${plain} null, sent_at ${zoned}, balance decimal(12,2) not null, status varchar(20) not null, flagged ${flag} not null)`,
    )
    .execute(db);
}

/** Write the rows as the write path spells each column. */
async function insertInvoices(dialect: Dialect, db: Kysely<SourceDatabase>, table: ResolvedTable, rows: readonly (typeof INVOICES)[number][] = INVOICES): Promise<void> {
  const logged = table.columns.get('logged_at')!;
  const sent = table.columns.get('sent_at')!;
  const spell = (column: typeof logged, at: string | null) =>
    at === null ? null : column.logicalType === 'timestamp' ? normalizeWriteValue(column, at) : dialect === 'mysql' ? at.slice(0, 19).replace('T', ' ') : at;
  for (const row of rows) {
    await db
      .insertInto(table.id as never)
      .values({
        id: row.id,
        due_on: row.due_on,
        logged_at: spell(logged, row.at),
        sent_at: spell(sent, row.at),
        balance: row.balance,
        status: row.status,
        flagged: dialect === 'sqlite' ? (row.flagged ? 1 : 0) : row.flagged,
      } as never)
      .execute();
  }
}

describe('a window that reaches ahead, as bounds', () => {
  it('starts at the venue’s midnight, Monday or first of the month, and has no end', () => {
    const day = aheadBounds('day', NOW, ZONE);
    expect(day.start.toISOString()).toBe('2026-09-24T15:00:00.000Z');
    expect(day.end).toBeNull();
    expect(aheadBounds('week', NOW, ZONE).start.toISOString()).toBe('2026-09-20T15:00:00.000Z');
    expect(aheadBounds('month', NOW, ZONE).start.toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });
});

describe('the pieces of a link, before any engine sees them', () => {
  const column = (name: string, logicalType: string, extra: Record<string, unknown> = {}) =>
    [name, { name, logicalType, nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: false, ...extra }] as const;
  const table = {
    id: 'invoices',
    schema: '',
    name: 'invoices',
    primaryKey: ['id'],
    readOnly: false,
    table: {},
    columns: new Map([
      column('id', 'uuid'),
      column('email', 'text', { masked: true }),
      column('token', 'text', { secret: true }),
      column('status', 'enum'),
      column('notes', 'json'),
      column('due_on', 'date'),
    ]),
  } as unknown as ResolvedTable;
  const resolve = (pieces: [string, string][], canReadPii = false) =>
    resolveLinkFilters({ pieces: pieces.map(([c, raw]) => ({ column: c, raw })), table, canReadPii, dialect: 'postgres', timezone: ZONE, now: NOW });
  const reasons = (pieces: [string, string][], canReadPii = false) =>
    resolve(pieces, canReadPii).filters.map((filter) => (filter.status === 'ignored' ? filter.reason : filter.status));

  it('never filters on what the reader may not see, or a column that is secret', () => {
    expect(reasons([['email', 'eq:a@b.c'], ['token', 'set']])).toEqual(['masked-column', 'unknown-column']);
    // Someone who may see the column may filter on it.
    expect(reasons([['email', 'eq:a@b.c']], true)).toEqual(['applied']);
  });

  it('refuses an operator it does not know, and one the column cannot take', () => {
    expect(reasons([['status', 'like:%x%'], ['status', 'gt:a'], ['notes', 'eq:{}'], ['status', 'before:today']])).toEqual([
      'unknown-operator',
      'wrong-operator',
      'wrong-operator',
      'wrong-operator',
    ]);
  });

  it('refuses a value the column cannot hold, before an engine fails the read on it', () => {
    expect(
      reasons([
        ['id', 'eq:not-a-uuid'],
        ['due_on', 'eq:2026-02-30'],
        ['due_on', 'before:yesterday'],
        ['status', 'set:yes'],
        ['status', 'eq:'],
        ['status', `in:${Array.from({ length: 51 }, (_, i) => `s${i}`).join(',')}`],
        ['status', 'in:a,,b'],
      ]),
    ).toEqual(['bad-value', 'bad-value', 'bad-value', 'bad-value', 'bad-value', 'bad-value', 'bad-value']);
    expect(reasons([['id', 'eq:0b9a2c3e-4d5f-4a6b-8c7d-9e0f1a2b3c4d']])).toEqual(['applied']);
  });

  it('counts days from today no further than ten years, and names no moment on a date', () => {
    expect(
      reasons([
        ['due_on', 'gte:today-3660'],
        ['due_on', 'lt:today+3660'],
        ['due_on', 'gte:today-3661'],
        ['due_on', 'lt:today+99999'],
        ['due_on', 'gte:today-'],
        ['due_on', 'gte:today+1.5'],
        ['due_on', 'gte:yesterday-1'],
      ]),
    ).toEqual(['applied', 'applied', 'bad-value', 'bad-value', 'bad-value', 'bad-value', 'bad-value']);
    expect(reasons([['due_on', 'before:now'], ['due_on', 'gt:now'], ['status', 'before:now']])).toEqual([
      'wrong-operator',
      'wrong-operator',
      'wrong-operator',
    ]);
    // Today is Tokyo's 25th; the bounds are days, spelled as the date column keeps them.
    expect(resolve([['due_on', 'gte:today-30'], ['due_on', 'lt:today+7']]).where).toEqual({
      and: [
        { column: 'due_on', op: 'gte', value: '2026-08-26' },
        { column: 'due_on', op: 'lt', value: '2026-10-02' },
      ],
    });
  });

  it('uses the first eight pieces and says the rest were left out', () => {
    const many = Array.from({ length: 10 }, () => ['status', 'eq:sent'] as [string, string]);
    const resolution = resolve(many);
    expect(resolution.filters.map((filter) => filter.status)).toEqual([...Array(8).fill('applied'), 'ignored', 'ignored']);
    expect((resolution.where as { and: unknown[] }).and).toHaveLength(8);
  });

  it('applies nothing at all when nothing is usable — the chips say so, the tree is empty', () => {
    expect(resolve([['ghost', 'eq:1']]).where).toBeNull();
  });
});

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

/** One engine's studio, read straight through the compiler and the list. */
async function studio(dialect: Dialect) {
  const dir = await mkdtemp(join(tmpdir(), 'links-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const { dsn, drop } = await freshDatabase(dialect, dir);
  const connection = await manager.connections.create({ name: 'Studio', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  const { db } = await manager.data(connection.id);
  await createInvoices(dialect, db);
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const snapshot = (await snapshotsRepo(meta).latest(connection.id))!;
  const view = new SnapshotView(connection.id, applyOverrides(parseDatabaseModel(snapshot.schema), []), new Map());
  const table = view.table(view.model.tables.find((t) => t.name === 'invoices')!.id);
  await insertInvoices(dialect, db, table);
  close = async () => {
    await manager.disposeAll().catch(() => undefined);
    await drop();
    await meta.db.destroy();
    await rm(dir, { recursive: true, force: true });
  };

  const source = { name: 'invoices', ...(table.id.includes('.') ? { schema: table.id.split('.')[0] } : {}) };
  const compile = (input: Record<string, unknown>) =>
    compileWidgetQuery({
      db,
      view,
      descriptor: queryDescriptorSchema.parse({ connectionId: connection.id, source, ...input }),
      canReadPii: true,
      dialect,
      now: () => NOW,
      timezone: ZONE,
    });
  /** The ids a card's window lets through. */
  const aheadIds = async (window: Record<string, unknown>): Promise<number[]> => {
    const compiled = compile({ shape: 'record-list', select: ['id'], window, orderBy: [{ column: 'id', dir: 'asc' }] });
    const rows = (await compiled.query.execute()) as { id: unknown }[];
    return rows.map((row) => Number(row.id));
  };
  const metric = async (input: Record<string, unknown>) => {
    const compiled = compile(input);
    const rows = (await compiled.query.execute()) as Record<string, unknown>[];
    return shapeRows({ compiled, rows, canReadPii: true }) as unknown as Record<string, unknown>;
  };
  /**
   * The ids a link lets through: its pieces worked out, the tree sent as the
   * page sends it (JSON in `where=`), read by the list itself.
   */
  const linked = async (link: Record<string, string> | [column: string, raw: string][]) => {
    const resolution = resolveLinkFilters({
      pieces: (Array.isArray(link) ? link : Object.entries(link)).map(([column, raw]) => ({ column, raw })),
      table,
      canReadPii: true,
      dialect,
      timezone: ZONE,
      now: NOW,
    });
    const where = resolution.where === null ? undefined : JSON.stringify(resolution.where);
    const result = await runList({ db, view, table, params: { where, order: 'id.asc', limit: 50 }, canReadPii: true, dialect });
    return { ids: result.data.map((row) => Number(row['id'])), resolution };
  };
  return { aheadIds, metric, linked };
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`reaching ahead and linking filtered on ${dialect}`, () => {
    it('counts from the venue’s today on, with no end, on a date and on time columns', async () => {
      const s = await studio(dialect);
      const ahead = (column: string, unit = 'day') => s.aheadIds({ column, ahead: true, last: 1, unit });
      // Due today or later: today, tomorrow and next year — not yesterday.
      expect(await ahead('due_on')).toEqual([2, 3, 5]);
      // A time just after the venue's midnight is today's; one just before is not.
      expect(await ahead('logged_at')).toEqual([2, 3]);
      expect(await ahead('sent_at')).toEqual([2, 3]);
      // This month on: from the 1st where the venue is (row 4 is 1 September in Tokyo).
      expect(await ahead('due_on', 'month')).toEqual([1, 2, 3, 5]);
      expect(await ahead('sent_at', 'month')).toEqual([1, 2, 3, 4]);
      // What "Not yet due" sums.
      const owed = await s.metric({
        shape: 'single-metric',
        aggregations: [{ fn: 'sum', column: 'balance', alias: 'owed' }],
        window: { column: 'due_on', ahead: true, last: 1, unit: 'day' },
      });
      expect(Number(owed['value'])).toBe(11100);
      // The next one due is today's.
      const next = await s.metric({
        shape: 'record-list',
        select: ['id', 'due_on'],
        window: { column: 'due_on', ahead: true, last: 1, unit: 'day' },
        orderBy: [{ column: 'due_on', dir: 'asc' }],
        limit: 1,
      });
      expect((next['rows'] as { id: unknown }[]).map((row) => Number(row.id))).toEqual([2]);
    }, 60_000);

    it('refuses every knob that would read "ahead" a second way', async () => {
      const s = await studio(dialect);
      const base = { column: 'due_on', ahead: true, last: 1, unit: 'day' };
      await expect(s.aheadIds({ ...base, last: 7 })).rejects.toThrow('takes no `last` other than 1');
      await expect(s.aheadIds({ ...base, offset: 1 })).rejects.toThrow('takes no `offset`');
      await expect(s.aheadIds({ ...base, param: 'day' })).rejects.toThrow('takes no `param`');
      await expect(s.aheadIds({ ...base, calendar: false })).rejects.toThrow('takes no `calendar`');
      await expect(
        s.metric({ shape: 'metric+delta', aggregations: [{ fn: 'sum', column: 'balance', alias: 'owed' }], window: { ...base, compareToPrior: true } }),
      ).rejects.toThrow('takes no `compareToPrior`');
    }, 60_000);

    it('opens a list filtered by every operator, on the venue’s calendar', async () => {
      const s = await studio(dialect);
      const ids = async (link: Record<string, string>) => (await s.linked(link)).ids;
      // A date column: plain days, "today" is Tokyo's 25th.
      expect(await ids({ due_on: 'eq:2026-09-25' })).toEqual([2]);
      expect(await ids({ due_on: 'eq:today' })).toEqual([2]);
      expect(await ids({ due_on: 'neq:today' })).toEqual([1, 3, 4, 5, 6]);
      expect(await ids({ due_on: 'before:today' })).toEqual([1, 4, 6]);
      expect(await ids({ due_on: 'after:today' })).toEqual([3, 5]);
      expect(await ids({ due_on: 'gte:today' })).toEqual([2, 3, 5]);
      expect(await ids({ due_on: 'gt:today' })).toEqual([3, 5]);
      expect(await ids({ due_on: 'lt:2026-09-25' })).toEqual([1, 4, 6]);
      expect(await ids({ due_on: 'lte:today' })).toEqual([1, 2, 4, 6]);
      expect(await ids({ due_on: 'in:2026-09-24,2026-09-26' })).toEqual([1, 3]);
      expect(await ids({ due_on: 'month:this' })).toEqual([1, 2, 3]);
      expect(await ids({ due_on: 'month:last' })).toEqual([4, 6]);
      // Time columns, with a zone and without: a day is the venue's whole day.
      for (const column of ['logged_at', 'sent_at']) {
        expect(await ids({ [column]: 'before:today' }), column).toEqual([1, 4, 6]);
        expect(await ids({ [column]: 'after:today' }), column).toEqual([3]);
        expect(await ids({ [column]: 'eq:today' }), column).toEqual([2]);
        expect(await ids({ [column]: 'gte:2026-09-25' }), column).toEqual([2, 3]);
        expect(await ids({ [column]: 'lte:2026-09-25' }), column).toEqual([1, 2, 4, 6]);
        expect(await ids({ [column]: 'month:this' }), column).toEqual([1, 2, 3, 4]);
        expect(await ids({ [column]: 'month:last' }), column).toEqual([6]);
        expect(await ids({ [column]: 'set' }), column).toEqual([1, 2, 3, 4, 6]);
        expect(await ids({ [column]: 'unset' }), column).toEqual([5]);
      }
      // Numbers, text and yes/no.
      expect(await ids({ balance: 'gt:0' })).toEqual([1, 2, 3, 5, 6]);
      expect(await ids({ balance: 'gte:100' })).toEqual([2, 3, 5]);
      expect(await ids({ balance: 'lt:100' })).toEqual([1, 4, 6]);
      expect(await ids({ balance: 'lte:100' })).toEqual([1, 2, 4, 6]);
      expect(await ids({ balance: 'eq:0' })).toEqual([4]);
      expect(await ids({ balance: 'neq:0' })).toEqual([1, 2, 3, 5, 6]);
      expect(await ids({ balance: 'in:10,1000' })).toEqual([1, 3]);
      expect(await ids({ status: 'eq:sent' })).toEqual([1, 2, 5]);
      expect(await ids({ status: 'neq:sent' })).toEqual([3, 4, 6]);
      expect(await ids({ status: 'in:draft,paid' })).toEqual([3, 4, 6]);
      expect(await ids({ flagged: 'eq:true' })).toEqual([2]);
      expect(await ids({ flagged: 'eq:false' })).toEqual([1, 3, 4, 5, 6]);
      // The overview's "Overdue" tile: sent, owing, due before today.
      expect(await ids({ status: 'eq:sent', balance: 'gt:0', due_on: 'before:today' })).toEqual([1]);
    }, 120_000);

    it('counts days from today, either way, on the venue’s calendar — a time column by the venue’s midnight', async () => {
      const s = await studio(dialect);
      const ids = async (...pieces: [string, string][]) => (await s.linked(pieces)).ids;
      // A date column: plain days. Today is Tokyo's 25th.
      expect(await ids(['due_on', 'gte:today-1'])).toEqual([1, 2, 3, 5]);
      expect(await ids(['due_on', 'lt:today+1'])).toEqual([1, 2, 4, 6]);
      expect(await ids(['due_on', 'before:today-30'])).toEqual([4]);
      expect(await ids(['due_on', 'after:today+1'])).toEqual([5]);
      // Two pieces on one column: a band of days — the overview's 1–30 days late.
      expect(await ids(['due_on', 'gte:today-30'], ['due_on', 'lt:today'])).toEqual([1, 6]);
      expect(await ids(['due_on', 'eq:today-1'])).toEqual([1]);
      // Time columns, with a zone and without: the day starts at the venue's midnight.
      for (const column of ['logged_at', 'sent_at']) {
        // From the 24th's midnight in Tokyo: 23:59 on the 24th is in, 31 August is not.
        expect(await ids([column, 'gte:today-1']), column).toEqual([1, 2, 3]);
        // Before the 26th's midnight: 00:30 on the 26th is out.
        expect(await ids([column, 'lt:today+1']), column).toEqual([1, 2, 4, 6]);
        expect(await ids([column, 'after:today-1']), column).toEqual([2, 3]);
        expect(await ids([column, 'before:today-24']), column).toEqual([6]);
      }
    }, 120_000);

    it('compares a time column with this very moment, not with the day', async () => {
      const s = await studio(dialect);
      const ids = async (...pieces: [string, string][]) => (await s.linked(pieces)).ids;
      // Now is 01:00 on the 25th in Tokyo: 00:01 today has passed, 00:30 tomorrow has not.
      for (const column of ['logged_at', 'sent_at']) {
        expect(await ids([column, 'before:now']), column).toEqual([1, 2, 4, 6]);
        expect(await ids([column, 'after:now']), column).toEqual([3]);
        expect(await ids([column, 'lte:now']), column).toEqual([1, 2, 4, 6]);
        expect(await ids([column, 'gt:now']), column).toEqual([3]);
      }
      // "Before today" is a different list: the row at 00:01 today is not in it.
      expect(await ids(['sent_at', 'before:today'])).toEqual([1, 4, 6]);
    }, 60_000);

    it('leaves out a piece it cannot use, says why, and never widens the rest', async () => {
      const s = await studio(dialect);
      const { ids, resolution } = await s.linked({ status: 'eq:sent', nope: 'eq:1', balance: 'gt:abc', flagged: 'gt:1', due_on: 'month:next' });
      // Only the good piece applies — the list is the sent ones, not everything.
      expect(ids).toEqual([1, 2, 5]);
      expect(resolution.filters).toEqual([
        { column: 'status', raw: 'eq:sent', status: 'applied', op: 'eq', value: 'sent' },
        { column: 'nope', raw: 'eq:1', status: 'ignored', reason: 'unknown-column' },
        { column: 'balance', raw: 'gt:abc', status: 'ignored', reason: 'bad-value' },
        { column: 'flagged', raw: 'gt:1', status: 'ignored', reason: 'wrong-operator' },
        { column: 'due_on', raw: 'month:next', status: 'ignored', reason: 'bad-value' },
      ]);
    }, 60_000);
  });
}

/*
 * ─── THE ROUTE ─────────────────────────────────────────────────────────────
 * What the records page actually calls, on every engine, with the real clock:
 * the rows are dated years away from today so the answer does not move (the
 * far one stays inside 2038: a MySQL `timestamp` holds nothing later).
 */
const FAR = [
  { id: 1, due_on: '2020-01-15', at: '2020-01-15T12:00:00Z', balance: '10.00', status: 'sent', flagged: false },
  { id: 2, due_on: '2037-06-15', at: '2037-06-15T12:00:00Z', balance: '20.00', status: 'sent', flagged: false },
  { id: 3, due_on: '2020-02-15', at: null, balance: '0.00', status: 'paid', flagged: false },
];

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`the link-filters route on ${dialect}`, () => {
    let t: DataTestContext;
    let connectionId: string;
    let tableId: string;
    let drop: () => Promise<void> = async () => undefined;
    let dir: string;

    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'links-route-'));
      const fresh = await freshDatabase(dialect, dir);
      drop = fresh.drop;
      t = await buildDataTestApp();
      connectionId = await createConnectionViaApi(t, fresh.dsn, 'studio', dialect);
      const { db } = await t.manager.data(connectionId);
      await createInvoices(dialect, db);
      await introspectViaApi(t, connectionId);
      const snapshot = (await snapshotsRepo(t.meta).latest(connectionId))!;
      const model = parseDatabaseModel(snapshot.schema) as DatabaseModel;
      tableId = model.tables.find((table) => table.name === 'invoices')!.id;
      const view = new SnapshotView(connectionId, applyOverrides(model, []), new Map());
      await insertInvoices(dialect, db, view.table(tableId), FAR);
      await t.meta.db.updateTable('adminium_connections').set({ timezone: ZONE }).where('id', '=', connectionId).execute();
      await t.grantTable(t.roles.viewer, connectionId, tableId, { read: true });
    }, 120_000);

    afterAll(async () => {
      await t?.app.close();
      await drop();
      await rm(dir, { recursive: true, force: true });
    });

    const resolve = (filters: { column: string; raw: string }[], user: DataTestContext['users']['viewer'] | null = t.users.viewer, table = tableId) =>
      t.app.inject({
        method: 'POST',
        url: '/api/v1/widget-data/link-filters',
        headers: user === null ? {} : asUser(user),
        payload: { connectionId, table, filters },
      });

    it('hands back a tree the list reads, and a line per piece', async () => {
      const reply = await resolve([
        { column: 'due_on', raw: 'before:today' },
        { column: 'balance', raw: 'gt:0' },
        { column: 'ghost', raw: 'set' },
      ]);
      expect(reply.statusCode).toBe(200);
      const body = reply.json() as { where: unknown; filters: { status: string }[] };
      expect(body.filters.map((filter) => filter.status)).toEqual(['applied', 'applied', 'ignored']);
      const today = venueClock(new Date(), ZONE).day;
      expect(body.where).toEqual({
        and: [
          { column: 'due_on', op: 'lt', value: today },
          { column: 'balance', op: 'gt', value: 0 },
        ],
      });
      const list = await t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${connectionId}/${encodeURIComponent(tableId)}?where=${encodeURIComponent(JSON.stringify(body.where))}&order=id.asc`,
        headers: asUser(t.users.viewer),
      });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { data: { id: unknown }[] }).data.map((row) => Number(row.id))).toEqual([1]);
    }, 60_000);

    it('asks who is reading, and whether they may read the table', async () => {
      expect((await resolve([{ column: 'status', raw: 'eq:sent' }], null)).statusCode).toBe(401);
      const denied = await resolve([{ column: 'status', raw: 'eq:sent' }], t.users.editor);
      expect(denied.statusCode).toBe(403);
      expect((denied.json() as { error: { code: string } }).error.code).toBe('TABLE_FORBIDDEN');
      expect((await resolve([{ column: 'status', raw: 'eq:sent' }], t.users.viewer, 'no_such_table')).statusCode).toBe(422);
    }, 60_000);
  });
}
