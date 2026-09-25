// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's tables accept the inserts an operator actually makes, on every engine.
 *
 * Until this, an `int` key was a bare `integer PRIMARY KEY` and every NOT NULL
 * column had no default. SQLite turns that key into its rowid alias, so the
 * suite was green; Postgres and MySQL refused every insert that left the id out
 * — which is every record added from a form — and every insert that left out a
 * column the form does not show.
 *
 * Each engine leg creates the tables for real, inserts WITHOUT an id and
 * without the defaulted columns, and reads back what the database filled. An
 * explicit id is still accepted (sample data and imports write them). A
 * `maxLength` column is a real `varchar(n)`, so the two engines that enforce a
 * width refuse a longer value.
 */
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { describe, expect, it } from 'vitest';

import { planInstall, validateManifest, type Manifest, type RequiredTable } from '@adminium/manifest';

import { applyInstall, defaultSqlFor, isNumberedKey } from '../src/add-ons/install-ddl.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const TABLES: RequiredTable[] = [
  {
    ref: 'menu_items',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'price', type: 'money', default: 0 },
      { ref: 'available', type: 'bool', default: true },
      { ref: 'status', type: 'enum', enum: ['on', 'off'], default: 'on' },
      { ref: 'label', type: 'text', maxLength: 12, default: 'new' },
      { ref: 'created_at', type: 'timestamptz', default: 'now' },
    ],
  },
  {
    ref: 'ticket_items',
    columns: [
      { ref: 'id', type: 'bigint', role: 'pk' },
      { ref: 'menu_item_id', type: 'fk', references: 'menu_items' },
      { ref: 'qty', type: 'int', default: 1 },
    ],
  },
];

function manifestOf(tables: RequiredTable[]): Manifest {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'pos',
    name: 'Point of Sale',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'd' },
    categories: ['hospitality'],
    compatibility: { minAdminiumVersion: '0.3.0' },
    requiredSchema: { tables },
    pages: [{ ref: 'menu', template: 'page-crud', title: { key: 't', fallback: 'Menu' }, nav: { group: 'library', icon: 'list', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
  } as Manifest;
}

async function install(db: AnyDb, dialect: 'sqlite' | 'postgres' | 'mysql'): Promise<void> {
  const manifest = manifestOf(TABLES);
  const result = await applyInstall({
    plan: planInstall(manifest, { tables: [] }),
    tables: TABLES,
    db,
    dialect,
    existing: [],
  });
  expect(result.created).toEqual(['menu_items', 'ticket_items']);
}

/** What every engine must do once the tables exist. */
async function exercise(db: AnyDb, dialect: 'sqlite' | 'postgres' | 'mysql'): Promise<void> {
  /*
   * No id, no defaulted column: exactly what a form that shows only the name
   * sends. But MySQL is given no `now`: its time column is a DATETIME kept on
   * the Adminium server's clock, which its UTC session could not fill, so
   * Adminium fills it on its own writes — and a row written outside Adminium
   * that leaves it out is refused rather than stamped hours off.
   */
  if (dialect === 'mysql') await expect(db.insertInto('menu_items').values({ name: 'Latte' }).execute()).rejects.toThrow(/created_at/);
  const when = dialect === 'mysql' ? { created_at: '2026-09-25 09:00:00' } : {};
  await db.insertInto('menu_items').values({ name: 'Latte', ...when }).execute();
  await db.insertInto('menu_items').values({ name: 'Mocha', ...when }).execute();
  const rows = await db.selectFrom('menu_items').selectAll().orderBy('id').execute();
  expect(rows.map((row) => Number(row['id']))).toEqual([1, 2]);
  const latte = rows[0]!;
  expect(Number(latte['price'])).toBe(0);
  expect(Boolean(Number(latte['available']) || latte['available'] === true)).toBe(true);
  expect(latte['status']).toBe('on');
  expect(latte['label']).toBe('new');
  expect(latte['created_at']).not.toBeNull();

  // An explicit id is still accepted (BY DEFAULT, not ALWAYS).
  await db.insertInto('menu_items').values({ id: 50, name: 'Flat white', ...when }).execute();
  const explicit = await db.selectFrom('menu_items').select('name').where('id', '=', 50).executeTakeFirst();
  expect(explicit?.['name']).toBe('Flat white');

  // A bigint key numbers itself too, and an FK to an identity key takes its type.
  await db.insertInto('ticket_items').values({ menu_item_id: 1 }).execute();
  const line = await db.selectFrom('ticket_items').selectAll().executeTakeFirstOrThrow();
  expect(Number(line['id'])).toBe(1);
  expect(Number(line['qty'])).toBe(1);

  if (dialect !== 'sqlite') {
    // A real varchar(80): the engines that enforce a width refuse 81.
    await expect(db.insertInto('menu_items').values({ name: 'x'.repeat(81), ...when }).execute()).rejects.toThrow();
  }
}

describe('the manifest column fields for defaults and widths', () => {
  const validate = (column: Record<string, unknown>) =>
    validateManifest(manifestOf([{ ref: 't', columns: [{ ref: 'id', type: 'int', role: 'pk' }, column as never] }]));

  it('accepts a default of the column type, and now on a timestamptz', () => {
    expect(validate({ ref: 'a', type: 'int', default: 3 }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'bool', default: false }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'money', default: 4.5 }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'enum', enum: ['x', 'y'], default: 'y' }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'timestamptz', default: 'now' }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'text', maxLength: 5, default: 'hi' }).ok).toBe(true);
  });

  it('refuses a default no engine can honour the same way', () => {
    expect(validate({ ref: 'a', type: 'text', default: 'hi' }).ok).toBe(false); // MySQL TEXT
    expect(validate({ ref: 'a', type: 'text', maxLength: 1, default: 'hi' }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'timestamptz', default: '2026-01-01' }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'enum', enum: ['x'], default: 'z' }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'int', default: 1.5 }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'bool', default: 'true' }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'json', default: '{}' }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'date', default: 'now' }).ok).toBe(false);
  });

  it('keeps maxLength to text, within the MySQL row budget', () => {
    expect(validate({ ref: 'a', type: 'text', maxLength: 1000 }).ok).toBe(true);
    expect(validate({ ref: 'a', type: 'text', maxLength: 1001 }).ok).toBe(false);
    expect(validate({ ref: 'a', type: 'int', maxLength: 10 }).ok).toBe(false);
  });

  it('numbers int and bigint keys only', () => {
    expect(isNumberedKey({ ref: 'id', type: 'int', role: 'pk' })).toBe(true);
    expect(isNumberedKey({ ref: 'id', type: 'bigint', role: 'pk' })).toBe(true);
    expect(isNumberedKey({ ref: 'id', type: 'id', role: 'pk' })).toBe(false);
    expect(isNumberedKey({ ref: 'id', type: 'text', role: 'pk' })).toBe(false);
    expect(isNumberedKey({ ref: 'n', type: 'int' })).toBe(false);
  });

  it('renders each default for its dialect', () => {
    expect(defaultSqlFor({ ref: 'a', type: 'bool', default: true }, 'postgres')).toBe('true');
    expect(defaultSqlFor({ ref: 'a', type: 'bool', default: true }, 'mysql')).toBe('1');
    expect(defaultSqlFor({ ref: 'a', type: 'timestamptz', default: 'now' }, 'sqlite')).toBe("(datetime('now', 'localtime'))");
    expect(defaultSqlFor({ ref: 'a', type: 'timestamptz', default: 'now' }, 'postgres')).toBe('CURRENT_TIMESTAMP');
    // A DATETIME on MySQL keeps this server's clock, which its UTC session cannot fill: Adminium does.
    expect(defaultSqlFor({ ref: 'a', type: 'timestamptz', default: 'now' }, 'mysql')).toBeNull();
    expect(defaultSqlFor({ ref: 'a', type: 'text', maxLength: 9, default: "it's" }, 'postgres')).toBe("'it''s'");
    expect(defaultSqlFor({ ref: 'a', type: 'int' }, 'postgres')).toBeNull();
  });
});

describe('an app table on SQLite', () => {
  it('numbers its keys and fills its defaults', async () => {
    const db = new Kysely({ dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }) }) as AnyDb;
    try {
      await install(db, 'sqlite');
      await exercise(db, 'sqlite');
    } finally {
      await db.destroy();
    }
  });
});

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('an app table on PostgreSQL', () => {
  it('numbers its keys and fills its defaults', async () => {
    const require = createRequire(import.meta.url);
    const { Pool } = require('pg') as { Pool: new (config: unknown) => never };
    const schema = `adminium_app_ddl_${randomBytes(4).toString('hex')}`;
    // One connection, so the search_path below holds for every statement.
    const pool = new Pool({ connectionString: POSTGRES_URL, max: 1 });
    const db = new Kysely({ dialect: new PostgresDialect({ pool }) }) as AnyDb;
    await sql.raw(`create schema ${schema}`).execute(db);
    await sql.raw(`set search_path to ${schema}`).execute(db);
    try {
      await install(db, 'postgres');
      await exercise(db, 'postgres');
    } finally {
      await sql.raw(`drop schema ${schema} cascade`).execute(db);
      await db.destroy();
    }
  });
});

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

describe.skipIf(MYSQL_URL === undefined)('an app table on MySQL', () => {
  it('numbers its keys and fills its defaults', async () => {
    const mysql = await import('mysql2');
    const database = `adminium_app_ddl_${randomBytes(4).toString('hex')}`;
    const admin = mysql.createPool({ uri: MYSQL_URL as string, connectionLimit: 1 }).promise();
    await admin.query(`CREATE DATABASE \`${database}\``);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${database}`;
    const db = new Kysely({ dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url.toString() }) }) }) as AnyDb;
    try {
      await install(db, 'mysql');
      await exercise(db, 'mysql');
    } finally {
      await db.destroy();
      await admin.query(`DROP DATABASE \`${database}\``);
      await admin.end();
    }
  });
});
