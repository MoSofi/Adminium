// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `date` reads as its `YYYY-MM-DD` text, whatever zone this process runs in
 * — as SQLite and MySQL hand it back — against a real server.
 *
 * `pg` made a date a Date at the process's local midnight: `2026-08-14` came
 * back as `2026-08-13T22:00:00.000Z` on a server in Berlin, and as
 * `2026-08-14T07:00:00.000Z` in Los Angeles. Run this file under any `TZ`:
 * the answer is the day the row holds. A time (`timestamptz`) is still a
 * Date, and so is a wall clock (`timestamp`).
 */
import { Kysely, sql, type Dialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseAdapter } from '@adminium/engine/adapter';

import { createQueryEngine } from '../src/query-engine.js';
import { DATES_AS_TEXT } from '../src/session.js';
import { createTestDatabase, dropTestDatabase, dsnFor, pgDriverAvailable, psql, psqlAvailable } from './harness.js';

const driverReady = psqlAvailable && (await pgDriverAvailable());

describe('the date reader', () => {
  it('reads a date (OID 1082) as its text, and hands every other type to pg', () => {
    const parse = DATES_AS_TEXT.getTypeParser(1082, 'text') as (value: string) => unknown;
    expect(parse('2026-08-14')).toBe('2026-08-14');
    const instant = DATES_AS_TEXT.getTypeParser(1184, 'text') as (value: string) => unknown;
    expect(instant('2026-08-14 10:00:00+00')).toBeInstanceOf(Date);
  });
});

describe.skipIf(!driverReady)(`a date read from Postgres (TZ=${process.env['TZ'] ?? 'unset'})`, () => {
  let database = '';
  let db: Kysely<Record<string, never>>;
  let adapter: DatabaseAdapter<'data'>;

  beforeAll(async () => {
    database = await createTestDatabase(false);
    await psql(`CREATE TABLE visits (id serial PRIMARY KEY, on_day date, at timestamptz, wall timestamp);
                INSERT INTO visits (on_day, at, wall) VALUES ('2026-08-14', '2026-08-14T10:00:00Z', '2026-08-14 10:00:00'), ('2026-01-01', NULL, NULL);`, { db: database });
    db = new Kysely({ dialect: createQueryEngine(dsnFor(database)).dialect as Dialect });
    const mod = await import('../src/index.js');
    adapter = new mod.PostgresAdapter<'data'>('data');
    await adapter.connect({ role: 'data', dsn: dsnFor(database) });
  }, 60_000);

  afterAll(async () => {
    await db?.destroy();
    await adapter?.close();
    if (database !== '') await dropTestDatabase(database);
  });

  it('is the day the row holds, as text; a time stays a Date', async () => {
    const rows = (await sql<{ on_day: unknown; at: unknown; wall: unknown }>`select on_day, at, wall from visits order by id`.execute(db)).rows;
    expect(rows[0]!.on_day).toBe('2026-08-14');
    expect(rows[1]!.on_day).toBe('2026-01-01');
    expect(rows[0]!.at).toBeInstanceOf(Date);
    expect((rows[0]!.at as Date).toISOString()).toBe('2026-08-14T10:00:00.000Z');
    expect(rows[0]!.wall).toBeInstanceOf(Date);
    const literal = (await sql<{ d: unknown }>`select date '2026-12-31' as d`.execute(db)).rows[0]!.d;
    expect(literal).toBe('2026-12-31');
  });

  it('gives a date column’s statistics as the same days', async () => {
    const stats = await adapter.collectTableStats({ schema: 'public', name: 'visits' }, { columns: [{ name: 'on_day', logicalType: 'date' }], sampling: { maxValuesPerColumn: 10 } });
    const column = stats.columns.find((c) => c.column === 'on_day')!;
    expect([column.min, column.max]).toEqual(['2026-01-01', '2026-08-14']);
  });
});
