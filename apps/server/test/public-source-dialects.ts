// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The PUBLIC API served over a real source database on each dialect.
 *
 * A write's scope lives in the statement's own WHERE, and whether a delete
 * with a predicate and a foreign key behaves the same on SQLite, Postgres and
 * MySQL is exactly what SQLite alone cannot say. Each leg creates a fresh
 * source database from `ddl` + `seed`, registers it as a connection of a
 * fixture install, introspects it, and composes a server over it with the
 * public API switched on.
 *
 * Postgres and MySQL gate on TEST_POSTGRES_URL / TEST_MYSQL_URL (`''` counts
 * as absent) and skip green without them.
 */

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createFirstSuperAdmin, settingsRepo, type MetaDb } from '@adminium/meta';

import { composeServer, type ComposedServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import type { MetaStoreHandle } from '../src/meta/store.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { makeEnv } from './helpers.js';
import { INSTALL_SECRET, makeInstall, type Install } from './project-fixtures.js';

export const PUBLIC_ORIGIN = 'https://shop.example.com';

export type SourceDialect = 'sqlite' | 'postgres' | 'mysql';

export interface SourceSpec {
  ddl: Record<SourceDialect, readonly string[]>;
  /** Plain INSERTs, valid on all three. */
  seed: readonly string[];
}

export interface ServedSource {
  app: ComposedServer['app'];
  meta: MetaDb;
  cookie: string;
  connectionId: string;
  /** Run SQL against the source, for assertions. */
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}

export interface SourceLeg {
  dialect: SourceDialect;
  available: boolean;
  serve: (spec: SourceSpec) => Promise<ServedSource>;
}

const PG = process.env['TEST_POSTGRES_URL'] || undefined;
const MYSQL = process.env['TEST_MYSQL_URL'] || undefined;

function withDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

function memoryStore(meta: MetaDb): MetaStoreHandle {
  return { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() };
}

interface MadeSource {
  engine: SourceDialect;
  dsn: string;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  drop: () => Promise<void>;
}

async function makeSource(dialect: SourceDialect, spec: SourceSpec, dir: string): Promise<MadeSource> {
  const statements = [...spec.ddl[dialect], ...spec.seed];
  if (dialect === 'sqlite') {
    const file = join(dir, `src_${randomBytes(3).toString('hex')}.db`);
    const db = new BetterSqlite3(file);
    for (const sql of statements) db.exec(sql);
    db.close();
    return {
      engine: 'sqlite',
      dsn: `sqlite:${file}`,
      query: async (sql) => {
        const read = new BetterSqlite3(file);
        try {
          return Promise.resolve(read.prepare(sql).all() as Record<string, unknown>[]);
        } finally {
          read.close();
        }
      },
      drop: async () => Promise.resolve(),
    };
  }
  const database = `adminium_pubsrc_${randomBytes(4).toString('hex')}`;
  if (dialect === 'postgres') {
    const { default: pg } = await import('pg');
    const admin = new pg.Client({ connectionString: PG as string });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    const dsn = withDatabase(PG as string, database);
    const client = new pg.Client({ connectionString: dsn });
    await client.connect();
    for (const sql of statements) await client.query(sql);
    await client.end();
    return {
      engine: 'postgres',
      dsn,
      query: async (sql) => {
        const c = new pg.Client({ connectionString: dsn });
        await c.connect();
        try {
          return (await c.query(sql)).rows as Record<string, unknown>[];
        } finally {
          await c.end();
        }
      },
      drop: async () => {
        const c = new pg.Client({ connectionString: PG as string });
        await c.connect();
        await c.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await c.end();
      },
    };
  }
  const mysqlP = await import('mysql2/promise');
  const admin = await mysqlP.createConnection({ uri: MYSQL as string });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.end();
  const dsn = withDatabase(MYSQL as string, database);
  const conn = await mysqlP.createConnection({ uri: dsn });
  for (const sql of statements) await conn.query(sql);
  await conn.end();
  return {
    engine: 'mysql',
    dsn,
    query: async (sql) => {
      const c = await mysqlP.createConnection({ uri: dsn });
      try {
        const [rows] = await c.query(sql);
        return rows as Record<string, unknown>[];
      } finally {
        await c.end();
      }
    },
    drop: async () => {
      const c = await mysqlP.createConnection({ uri: MYSQL as string });
      await c.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await c.end();
    },
  };
}

function leg(dialect: SourceDialect, available: boolean): SourceLeg {
  return {
    dialect,
    available,
    async serve(spec) {
      const install: Install = await makeInstall();
      const { meta, manager } = install;
      const source = await makeSource(dialect, spec, install.dir);
      const connection = await manager.connections.create({
        name: `Source ${dialect}`,
        engine: dialect,
        introspectDsn: source.dsn,
        dataDsn: source.dsn,
      });
      // A derived scope inherits its zone from the connection.
      await meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' }).where('id', '=', connection.id).execute();
      await runIntrospection({ manager, meta, connectionId: connection.id });
      const runService = createRunService({ meta });
      const composed = await composeServer({
        env: makeEnv({ ADMINIUM_PUBLIC_API_ORIGINS: PUBLIC_ORIGIN, HOST: '127.0.0.1', ADMINIUM_SECRET: INSTALL_SECRET }),
        metaStore: memoryStore(meta),
        manager,
        runService,
        applyService: createApplyService({ meta, runService }),
        allowed: null,
        logger: false,
        telemetry: false,
      });
      await composed.app.ready();
      await createFirstSuperAdmin(meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
      const { cookie } = await login(composed.app, ADMIN_EMAIL, ADMIN_PASSWORD);
      await settingsRepo(meta).set('publicApi.enabled', true);
      return {
        app: composed.app,
        meta,
        cookie: cookie ?? '',
        connectionId: connection.id,
        query: source.query,
        close: async () => {
          await composed.app.close();
          await install.close();
          await source.drop();
        },
      };
    },
  };
}

export const SOURCE_LEGS: SourceLeg[] = [
  leg('sqlite', true),
  leg('postgres', PG !== undefined),
  leg('mysql', MYSQL !== undefined),
];
