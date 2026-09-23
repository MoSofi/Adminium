// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Today" is the venue's day, and a chart's hours are the venue's hours — on
 * every engine. A café in Tokyo that sold a coffee at half past midnight sold
 * it today, though in UTC it was still yesterday.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { queryDescriptorSchema } from '@adminium/engine/config';
import { createSqliteMetaDb, firstRun, snapshotsRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { calendarBounds, compileWidgetQuery } from '../src/widget-data/compiler.js';
import { shapeRows } from '../src/widget-data/shapers.js';
import { TEST_SECRET } from './helpers.js';

describe('calendar windows on the venue clock', () => {
  const iso = (b: { start: Date; end: Date }) => [b.start.toISOString(), b.end.toISOString()];

  it('is today from the venue’s midnight, yesterday one back, this week from Monday', () => {
    const now = new Date('2026-09-25T03:00:00Z'); // noon in Tokyo, Friday
    expect(iso(calendarBounds(1, 'day', 0, now, 'Asia/Tokyo'))).toEqual(['2026-09-24T15:00:00.000Z', '2026-09-25T15:00:00.000Z']);
    expect(iso(calendarBounds(1, 'day', 1, now, 'Asia/Tokyo'))).toEqual(['2026-09-23T15:00:00.000Z', '2026-09-24T15:00:00.000Z']);
    expect(iso(calendarBounds(1, 'week', 0, now, 'Asia/Tokyo'))).toEqual(['2026-09-20T15:00:00.000Z', '2026-09-27T15:00:00.000Z']);
    expect(iso(calendarBounds(1, 'hour', 0, now, 'Asia/Tokyo'))).toEqual(['2026-09-25T03:00:00.000Z', '2026-09-25T04:00:00.000Z']);
    // The prior window is the same span before.
    const today = calendarBounds(1, 'day', 0, now, 'Asia/Tokyo');
    expect([today.priorStart.toISOString(), today.priorEnd.toISOString()]).toEqual([
      '2026-09-23T15:00:00.000Z',
      '2026-09-24T15:00:00.000Z',
    ]);
  });

  it('lives through a clock change as the venue did: a 25-hour day', () => {
    const bounds = calendarBounds(1, 'day', 0, new Date('2026-10-25T12:00:00Z'), 'Europe/London');
    expect(iso(bounds)).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z']);
  });
});

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;
const ZONE = 'Asia/Tokyo';
const NOW = new Date('2026-09-25T03:00:00Z'); // noon in Tokyo

/** Four sales: one just after the venue's midnight (UTC's yesterday), one just before it. */
const SALES = [
  { at: '2026-09-24T15:30:00Z', amount: 1 }, // 00:30 Tokyo, today
  { at: '2026-09-24T14:30:00Z', amount: 10 }, // 23:30 Tokyo, yesterday
  { at: '2026-09-25T02:10:00Z', amount: 100 }, // 11:10 Tokyo, today
  { at: '2026-09-25T02:50:00Z', amount: 1000 }, // 11:50 Tokyo, today
];

let close: (() => Promise<void>) | null = null;
afterEach(async () => {
  await close?.();
  close = null;
});

async function sales(dialect: Dialect) {
  const dataDir = await mkdtemp(join(tmpdir(), 'venue-day-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const name = `adminium_venue_${randomBytes(4).toString('hex')}`;
  let dsn: string;
  let drop: () => Promise<void> = async () => undefined;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'cafe.db');
    new BetterSqlite3(file).close();
    dsn = `sqlite:${file}`;
  } else if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = new Client({ connectionString: POSTGRES_URL });
      await again.connect();
      await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await again.end();
    };
  } else {
    const mysql = await import('mysql2/promise');
    const admin = await mysql.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${name}\``);
    await admin.end();
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${name}`;
    dsn = url.toString();
    drop = async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    };
  }
  const connection = await manager.connections.create({ name: 'Cafe', engine: dialect, introspectDsn: dsn, dataDsn: dsn });
  const { db } = await manager.data(connection.id);
  const at = dialect === 'postgres' ? 'timestamptz' : dialect === 'mysql' ? 'datetime' : 'timestamp';
  await sql.raw(`create table sales (id integer primary key, sold_at ${at} not null, amount integer not null)`).execute(db);
  await runIntrospection({ manager, meta, connectionId: connection.id });
  const snapshot = (await snapshotsRepo(meta).latest(connection.id))!;
  const view = new SnapshotView(connection.id, applyOverrides(parseDatabaseModel(snapshot.schema), []), new Map());
  const table = view.table(view.model.tables.find((t) => t.name === 'sales')!.id);
  const column = table.columns.get('sold_at')!;
  // Written as the write path writes: an instant, or this server's wall clock.
  for (const [i, sale] of SALES.entries()) {
    const value = column.logicalType === 'timestamp' ? normalizeWriteValue(column, sale.at) : dialect === 'mysql' ? sale.at.slice(0, 19).replace('T', ' ') : sale.at;
    await db.insertInto(table.id as never).values({ id: i + 1, sold_at: value, amount: sale.amount } as never).execute();
  }
  close = async () => {
    await manager.disposeAll().catch(() => undefined);
    await drop();
    await meta.db.destroy();
    await rm(dataDir, { recursive: true, force: true });
  };
  const read = async (input: Record<string, unknown>, params: Record<string, unknown> = {}, timezone: string | undefined = ZONE) => {
    const descriptor = queryDescriptorSchema.parse({ connectionId: connection.id, source: { name: 'sales', ...(table.id.includes('.') ? { schema: table.id.split('.')[0] } : {}) }, ...input });
    const compiled = compileWidgetQuery({ db, view, descriptor, params, canReadPii: true, dialect, now: () => NOW, timezone });
    const rows = (await compiled.query.execute()) as Record<string, unknown>[];
    return shapeRows({ compiled, rows, canReadPii: true }) as unknown as Record<string, unknown>;
  };
  return { read };
}

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`the venue’s day on ${dialect}`, () => {
    it('counts today and yesterday from the venue’s midnight, and buckets its hours', async () => {
      const cafe = await sales(dialect);
      const total = (window: Record<string, unknown>) =>
        cafe.read({ shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'amount', alias: 'sold' }], window: { column: 'sold_at', ...window } });
      // Today on the venue's clock: the half-past-midnight sale is in, the 23:30 one is not.
      expect(await total({ last: 1, unit: 'day', calendar: true })).toEqual({ shape: 'single-metric', value: 1101 });
      expect(await total({ last: 1, unit: 'day', calendar: true, offset: 1 })).toEqual({ shape: 'single-metric', value: 10 });

      // The venue's hours: midnight and eleven o'clock, as instants.
      const hours = await cafe.read({
        shape: 'timeseries',
        aggregations: [{ fn: 'sum', column: 'amount', alias: 'sold' }],
        bucket: { column: 'sold_at', unit: 'hour' },
        window: { column: 'sold_at', last: 1, unit: 'day', calendar: true },
      });
      expect(hours['points']).toEqual([
        { t: '2026-09-24T15:00:00.000Z', v: 1 },
        { t: '2026-09-25T02:00:00.000Z', v: 1100 },
      ]);

      // And its days: the half-past-midnight sale is Friday's, not Thursday's.
      const days = await cafe.read({
        shape: 'timeseries',
        aggregations: [{ fn: 'sum', column: 'amount', alias: 'sold' }],
        bucket: { column: 'sold_at', unit: 'day' },
        window: { column: 'sold_at', last: 2, unit: 'day', calendar: true },
      });
      expect(days['points']).toEqual([
        { t: '2026-09-23T15:00:00.000Z', v: 10 },
        { t: '2026-09-24T15:00:00.000Z', v: 1101 },
      ]);

      // The page's day control: the window follows the day it names.
      const followed = (day: string) =>
        cafe.read(
          {
            shape: 'timeseries',
            aggregations: [{ fn: 'sum', column: 'amount', alias: 'sold' }],
            bucket: { column: 'sold_at', unit: 'hour' },
            window: { column: 'sold_at', last: 1, unit: 'day', param: 'day' },
          },
          { day },
        );
      expect((await followed('yesterday'))['points']).toEqual([{ t: '2026-09-24T14:00:00.000Z', v: 10 }]);
      expect((await followed('2026-09-25'))['points']).toEqual([
        { t: '2026-09-24T15:00:00.000Z', v: 1 },
        { t: '2026-09-25T02:00:00.000Z', v: 1100 },
      ]);
      // This week is drawn in days.
      expect((await followed('week'))['points']).toEqual([
        { t: '2026-09-23T15:00:00.000Z', v: 10 },
        { t: '2026-09-24T15:00:00.000Z', v: 1101 },
      ]);
      // A day still to come, or not a day at all, is refused.
      await expect(followed('2026-09-26')).rejects.toThrow('not one this page can show');
    }, 60_000);
  });
}
