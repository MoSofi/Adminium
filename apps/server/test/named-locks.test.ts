// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Named locks, all of a write's in one call: taken once each, in name order,
 * held until the commit, and recorded against the handle the write goes
 * through — on SQLite, Postgres and MySQL. And the write's clock, which
 * judges only inside a transaction.
 *
 * Postgres and MySQL legs gate on TEST_POSTGRES_URL / TEST_MYSQL_URL (`''`
 * counts as absent) and skip green without them. Neither leg needs a table:
 * the locks are the database's own.
 */
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../src/connections/manager.js';
import { heldNames, inTransaction, withNamedLocks, type NamedLock } from '../src/crud/capacity/locks.js';
import { withNamedLock } from '../src/crud/capacity-guard.js';
import { withSeriesLocks } from '../src/crud/gapless.js';
import { writeClock } from '../src/crud/write-clock.js';

type Db = Kysely<SourceDatabase>;

const POSTGRES_URL = process.env.TEST_POSTGRES_URL || undefined;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const lock = (name: string): NamedLock => ({ name, busy: 'CAPACITY_BUSY' });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Leg {
  dialect: Dialect;
  available: boolean;
  open: () => Promise<Db>;
}

const LEGS: Leg[] = [
  {
    dialect: 'sqlite',
    available: true,
    open: async () => new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }),
  },
  {
    dialect: 'postgres',
    available: POSTGRES_URL !== undefined,
    open: async () => {
      const pg = await import('pg');
      return new Kysely<SourceDatabase>({ dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: POSTGRES_URL, max: 4 }) }) });
    },
  },
  {
    dialect: 'mysql',
    available: MYSQL_URL !== undefined,
    open: async () => {
      const mysql = await import('mysql2');
      return new Kysely<SourceDatabase>({ dialect: new MysqlDialect({ pool: mysql.default.createPool({ uri: MYSQL_URL!, connectionLimit: 4 }) }) });
    },
  },
];

for (const leg of LEGS) {
  describe.skipIf(!leg.available)(`named locks on ${leg.dialect}`, () => {
    let db: Db;
    const target = () => ({ db, dialect: leg.dialect });
    // Names no other test on the same server takes.
    const unique = `named-locks-test-${String(process.pid)}-${leg.dialect}`;

    beforeAll(async () => {
      db = await leg.open();
    });

    afterAll(async () => {
      await db.destroy();
    });

    it('holds every name once, inside one transaction, and says which it holds', async () => {
      const seen = await withNamedLocks(target(), [lock(`${unique}:b`), lock(`${unique}:a`), lock(`${unique}:b`)], async (trx) => ({
        held: [...heldNames(trx)].sort(),
        open: inTransaction(trx),
      }));
      expect(seen).toEqual({ held: [`${unique}:a`, `${unique}:b`], open: true });
    });

    it('makes a second writer of the same name wait until the first has committed', async () => {
      const order: string[] = [];
      const first = withNamedLocks(target(), [lock(`${unique}:same`)], async () => {
        order.push('first in');
        await pause(150);
        order.push('first out');
      });
      await pause(30);
      const second = withNamedLocks(target(), [lock(`${unique}:other`), lock(`${unique}:same`)], async () => {
        order.push('second in');
      });
      await Promise.all([first, second]);
      expect(order).toEqual(['first in', 'first out', 'second in']);
    });

    it('opens a plain transaction when there is nothing to lock', async () => {
      const seen = await withNamedLocks(target(), [], async (trx) => ({ held: heldNames(trx).size, open: inTransaction(trx) }));
      expect(seen).toEqual({ held: 0, open: true });
    });

    it('keeps the one-name and the series helpers answering as before', async () => {
      expect(await withNamedLock(target(), `${unique}:one`, 'NUMBER_BUSY', async (trx) => [...heldNames(trx)])).toEqual([`${unique}:one`]);
      // A series is locked by name on MySQL only: Postgres takes it at the INSERT, SQLite has one writer.
      const series = await withSeriesLocks(db, leg.dialect, [`${unique}:s2`, `${unique}:s1`], async (trx) => [...heldNames(trx)].sort());
      expect(series).toEqual(leg.dialect === 'mysql' ? [`${unique}:s1`, `${unique}:s2`] : []);
    });

    it('treats a transaction already open as each engine can', async () => {
      const inside = db.transaction().execute(async (trx) => {
        if (leg.dialect === 'mysql') {
          // A named lock cannot be held until a commit somebody else makes.
          await expect(withNamedLocks({ db: trx, dialect: leg.dialect }, [lock(`${unique}:open`)], async () => 'ran')).rejects.toThrow(/cannot join one already open/);
          return withNamedLocks({ db: trx, dialect: leg.dialect }, [lock(`${unique}:open`)], async (joined) => heldNames(joined).size, { openTransaction: 'run' });
        }
        return withNamedLocks({ db: trx, dialect: leg.dialect }, [lock(`${unique}:open`)], async (joined) => heldNames(joined).size);
      });
      expect(await inside).toBe(leg.dialect === 'mysql' ? 0 : 1);
    });

    it("judges by one instant of the write's clock, read inside the transaction", async () => {
      const ticks = [new Date('2026-07-01T09:59:59.000Z'), new Date('2026-07-01T10:00:00.300Z'), new Date('2026-07-01T10:00:05.000Z')];
      const clock = writeClock({ occurredAt: undefined }, () => ticks.shift()!);
      expect(clock.startedAt.toISOString()).toBe('2026-07-01T09:59:59.000Z');
      expect(() => clock.locked(db)).toThrow(/inside its transaction/);
      const judged = await withNamedLocks(target(), [lock(`${unique}:clock`)], async (trx) => [clock.locked(trx), clock.locked(trx)]);
      expect(judged.map((at) => at.toISOString())).toEqual(['2026-07-01T10:00:00.300Z', '2026-07-01T10:00:00.300Z']);
    });
  });
}
