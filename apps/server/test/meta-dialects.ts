// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A throwaway meta store on each dialect, for server suites whose claim is
 * about what gets COMMITTED — transactions, compare-and-set, JSON columns.
 * SQLite alone hides exactly those (it has one connection, and hands JSON back
 * as text).
 *
 * The postgres and mysql legs gate on TEST_POSTGRES_URL / TEST_MYSQL_URL and
 * skip green without them; `''` counts as absent (CI leaves mysql empty on a
 * push). Each `make()` creates a fresh database and `destroy()` drops it.
 */

import { randomBytes } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import {
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  firstRun,
  postgresInt8AsNumber,
  type MetaDb,
} from '@adminium/meta';

export interface MetaHandle {
  meta: MetaDb;
  destroy: () => Promise<void>;
}

export interface MetaEngine {
  name: 'sqlite' | 'postgres' | 'mysql';
  available: boolean;
  /** A migrated, first-run meta store in a database of its own. */
  make: () => Promise<MetaHandle>;
}

const freshDbName = (): string => `adminium_srv_${randomBytes(4).toString('hex')}`;

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

export const META_ENGINES: MetaEngine[] = [
  {
    name: 'sqlite',
    available: true,
    async make() {
      const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
      await firstRun(meta);
      return { meta, destroy: async () => meta.db.destroy() };
    },
  },
  {
    name: 'postgres',
    available: PG !== undefined,
    async make() {
      const base = PG as string;
      const { default: pg } = await import('pg');
      const database = freshDbName();
      const admin = new pg.Client({ connectionString: base });
      await admin.connect();
      await admin.query(`CREATE DATABASE "${database}"`);
      await admin.end();
      const meta = createPostgresMetaDb({
        pool: new pg.Pool({
          connectionString: withDatabase(base, database),
          max: 4,
          types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>),
        }),
      });
      await firstRun(meta);
      return {
        meta,
        destroy: async () => {
          await meta.db.destroy();
          const drop = new pg.Client({ connectionString: base });
          await drop.connect();
          await drop.query(`DROP DATABASE IF EXISTS "${database}"`);
          await drop.end();
        },
      };
    },
  },
  {
    name: 'mysql',
    available: MYSQL !== undefined,
    async make() {
      const base = MYSQL as string;
      const mysqlP = await import('mysql2/promise');
      const database = freshDbName();
      const admin = await mysqlP.createConnection({ uri: base });
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.end();
      const { createPool } = await import('mysql2');
      const meta = createMysqlMetaDb({ pool: createPool({ uri: withDatabase(base, database), connectionLimit: 4 }) });
      await firstRun(meta);
      return {
        meta,
        destroy: async () => {
          await meta.db.destroy();
          const drop = await mysqlP.createConnection({ uri: base });
          await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
          await drop.end();
        },
      };
    },
  },
];
