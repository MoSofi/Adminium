// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `DATE` reads as its `YYYY-MM-DD` text, whatever zone this process runs
 * in — as SQLite and Postgres hand it back — against a real server.
 *
 * mysql2 made a date a Date at the process's local midnight: `2026-08-14`
 * came back as `2026-08-13T22:00:00.000Z` on a server in Berlin. Run this
 * file under any `TZ`: the answer is the day the row holds. A `DATETIME` and
 * a `TIMESTAMP` are still Dates, and so is every statistic of a time.
 */
import { Kysely, sql, type Dialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseAdapter } from '@adminium/engine/adapter';

import { createTestDatabase, dropTestDatabase, dsnFor, mysqlDriverAvailable, runSql, TEST_MYSQL_URL } from './harness.js';

const liveReady = TEST_MYSQL_URL !== '' && (await mysqlDriverAvailable());

describe.skipIf(!liveReady)(`a date read from MySQL (TZ=${process.env['TZ'] ?? 'unset'})`, () => {
  let database = '';
  let db: Kysely<Record<string, never>>;
  let adapter: DatabaseAdapter<'data'>;

  beforeAll(async () => {
    database = await createTestDatabase(false);
    await runSql(
      `CREATE TABLE visits (id int AUTO_INCREMENT PRIMARY KEY, on_day date NULL, at timestamp NULL, wall datetime NULL);
       INSERT INTO visits (on_day, at, wall) VALUES ('2026-08-14', '2026-08-14 10:00:00', '2026-08-14 10:00:00'), ('2026-01-01', NULL, NULL);`,
      database,
    );
    const mod = await import('../src/index.js');
    db = new Kysely({ dialect: mod.createQueryEngine({ role: 'data', dsn: dsnFor(database) }).dialect as Dialect });
    adapter = new mod.MysqlAdapter<'data'>('data');
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
    expect(rows[0]!.wall).toBeInstanceOf(Date);
    const literal = (await sql<{ d: unknown }>`select cast('2026-12-31' as date) as d`.execute(db)).rows[0]!.d;
    expect(literal).toBe('2026-12-31');
  });

  it('gives a date column’s statistics as the same days', async () => {
    const stats = await adapter.collectTableStats({ schema: database, name: 'visits' }, { columns: [{ name: 'on_day', logicalType: 'date' }], sampling: { maxValuesPerColumn: 10 } });
    const column = stats.columns.find((c) => c.column === 'on_day')!;
    expect([column.min, column.max]).toEqual(['2026-01-01', '2026-08-14']);
  });
});
