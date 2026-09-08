// SPDX-License-Identifier: AGPL-3.0-only
/**
 * 33-T10 — `{ "$generate": "uuid" | "now" }` in a public scope's `defaults`
 * (33-live-chat-add-on.md §7.1, D14; O5 ruled 2026-09-01 as D21).
 *
 * Three things are worth proving and they are proved in three different ways,
 * because they fail in three different places:
 *
 *   1. THE READING. A sentinel is recognised, a malformed one is caught, and a
 *      literal that merely looks like one is not mistaken for either. Pure, so
 *      it is exhaustive rather than representative.
 *   2. THE ROUND TRIP, ON ALL THREE DIALECTS. This is the one the design was
 *      most likely to get wrong, and 33 §12 says so in advance: `install-ddl`
 *      maps `timestamptz` to `datetime` on mysql, and `datetime` refuses the
 *      ISO instant with its `T` and `Z` that postgres and sqlite want. A test
 *      that ran on sqlite alone would be green and wrong.
 *   3. THE UPDATE PATH DOES NOT MINT. Asserted here at the unit level and in
 *      `public-api-isolation.test.ts` over the real route; a sentinel resolved
 *      on a PATCH would hand the row a new primary key on every message a
 *      visitor sends.
 *
 * The compile-time refusals live in `public-api-scope.test.ts`, beside the
 * other scope refusals, because that is the file somebody reads when they want
 * to know what a scope may not say.
 */

import { randomBytes } from 'node:crypto';

import BetterSqlite3 from 'better-sqlite3';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel, type Dialect } from '@adminium/engine/adapter';

import { applyOverrides } from '../src/connections/effective-schema.js';
import type { SourceDatabase } from '../src/connections/manager.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import {
  hasGeneratedDefault,
  instantFor,
  isPublicGenerator,
  PUBLIC_GENERATORS,
  readGenerator,
  resolveDefaults,
} from '../src/public-api/generate.js';
import { insertRow } from '../src/routes/data/index.js';

type AnyDb = Kysely<SourceDatabase>;

/* ------------------------------------------------------------- the reading */

describe('reading a defaults value as a sentinel', () => {
  it('leaves every ordinary literal alone', () => {
    for (const literal of ['open', 0, 1.5, true, false, null, [], ['$generate'], {}, { status: 'open' }]) {
      expect(readGenerator(literal), JSON.stringify(literal)).toBeNull();
    }
  });

  it('recognises both generators', () => {
    for (const name of PUBLIC_GENERATORS) {
      expect(readGenerator({ $generate: name })).toEqual({
        raw: name,
        problem: null,
        generator: name,
      });
    }
  });

  it('reports a typo as a broken sentinel rather than as data', () => {
    /*
     * The distinction this whole reading exists for. Treating
     * `{"$generate":"uuidv4"}` as an ordinary json literal would serialize the
     * object itself into the operator's column — a create that succeeds and
     * writes nonsense, which is worse than one that fails.
     */
    expect(readGenerator({ $generate: 'uuidv4' })?.problem).toBe('unknown-generator');
    expect(readGenerator({ $generate: 4 })?.problem).toBe('unknown-generator');
    expect(readGenerator({ $generate: null })?.problem).toBe('unknown-generator');
  });

  it('reports a sentinel with company as broken, not as a literal', () => {
    expect(readGenerator({ $generate: 'uuid', note: 'the row id' })?.problem).toBe('extra-keys');
  });

  it('knows an array is not an object here', () => {
    // `Object.hasOwnProperty` is true for index 0 of an array; the array guard
    // is what stops `['$generate']`-shaped data reading as a sentinel.
    expect(readGenerator(['$generate'])).toBeNull();
  });

  it('names the closed set', () => {
    expect([...PUBLIC_GENERATORS]).toEqual(['uuid', 'now']);
    expect(isPublicGenerator('uuid')).toBe(true);
    expect(isPublicGenerator('random')).toBe(false);
  });

  it('answers whether a defaults block carries any sentinel at all', () => {
    expect(hasGeneratedDefault({ status: 'open' })).toBe(false);
    expect(hasGeneratedDefault({ status: 'open', id: { $generate: 'uuid' } })).toBe(true);
  });
});

/* ------------------------------------------------------------- the instant */

describe('the instant, per dialect', () => {
  const now = new Date('2026-09-06T12:34:56.789Z');

  it('hands postgres and sqlite the ISO instant', () => {
    expect(instantFor('postgres', now)).toBe('2026-09-06T12:34:56.789Z');
    expect(instantFor('sqlite', now)).toBe('2026-09-06T12:34:56.789Z');
  });

  it("strips the T and the Z for mysql's datetime, and keeps UTC", () => {
    // 33 §12's named risk. `datetime` has no zone to carry one, so the literal
    // must denote the same instant postgres and sqlite are holding.
    expect(instantFor('mysql', now)).toBe('2026-09-06 12:34:56.789');
  });
});

/* ------------------------------------------------------------- resolution */

describe('resolving a defaults block', () => {
  const now = new Date('2026-09-06T12:34:56.789Z');

  it('passes literals through untouched', () => {
    expect(resolveDefaults({ status: 'open', unread_count: 0 }, 'sqlite', now)).toEqual({
      status: 'open',
      unread_count: 0,
    });
  });

  it('mints a uuid', () => {
    const out = resolveDefaults({ id: { $generate: 'uuid' } }, 'sqlite', now);
    expect(out['id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('mints a DIFFERENT uuid each call', () => {
    const a = resolveDefaults({ id: { $generate: 'uuid' } }, 'sqlite', now)['id'];
    const b = resolveDefaults({ id: { $generate: 'uuid' } }, 'sqlite', now)['id'];
    expect(a).not.toBe(b);
  });

  it('gives every `now` column in one row the SAME instant', () => {
    /*
     * Not a nicety. A row whose `created_at` and `updated_at` differ by the
     * microsecond it took to walk an object is a row that looks edited the
     * moment it was written, and every inbox that sorts on one and shows the
     * other would disagree with itself.
     */
    const out = resolveDefaults(
      { created_at: { $generate: 'now' }, updated_at: { $generate: 'now' } },
      'postgres',
      now,
    );
    expect(out['created_at']).toBe('2026-09-06T12:34:56.789Z');
    expect(out['updated_at']).toBe(out['created_at']);
  });

  it('throws rather than writing a malformed sentinel through', () => {
    // Unreachable in production — `compileScope` refuses these — so the throw
    // is a bug report, not an operator's error message.
    expect(() => resolveDefaults({ id: { $generate: 'nope' } }, 'sqlite', now)).toThrow(
      /malformed \$generate/,
    );
    expect(() => resolveDefaults({ id: { $generate: 'uuid', x: 1 } }, 'sqlite', now)).toThrow(
      /malformed \$generate/,
    );
  });
});

/* ------------------------------------------------------- the round trip ×3 */

/**
 * The shape the live chat's `conversations` table has, reduced to the two
 * columns this feature exists for: an `id` nobody may choose and a
 * `created_at` nobody may backdate.
 */
function model(dialect: Dialect, schema: string) {
  return parseDatabaseModel({
    dialect,
    name: 'gendb',
    defaultSchema: schema,
    schemas: [schema],
    tables: [
      {
        schema,
        name: 'conversations',
        primaryKey: ['id'],
        columns: [
          { name: 'id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'status', logicalType: 'text', nullable: false },
          { name: 'created_at', logicalType: 'timestamptz', nullable: false },
        ],
      },
    ],
    relations: [],
  });
}

const DEFAULTS = {
  id: { $generate: 'uuid' },
  created_at: { $generate: 'now' },
  status: 'open',
} as const;

/**
 * Write one row the way `POST /public/records/:ref` does — resolve the scope's
 * defaults, then hand them to the same `insertRow` the route calls — and read
 * it back through the driver.
 */
async function roundTrip(db: AnyDb, dialect: Dialect, schema: string) {
  const view = new SnapshotView('conn_test', applyOverrides(model(dialect, schema), []));
  const table = view.table(`${schema}.conversations`);
  const at = new Date('2026-09-06T12:34:56.000Z');
  const values = resolveDefaults(DEFAULTS, dialect, at);
  const inserted = await insertRow(db, dialect, table, values);
  const stored = await db
    .selectFrom(`${schema}.conversations` as never)
    .selectAll()
    .where('id' as never, '=', values['id'] as never)
    .executeTakeFirstOrThrow();
  return { values, inserted, stored: stored as Record<string, unknown> };
}

/**
 * What the driver hands back for the timestamp differs by dialect — a `Date`
 * from pg and mysql2, the stored text from sqlite — so the assertion is on the
 * INSTANT rather than on the representation. That is the claim that matters:
 * the same moment came back out of all three.
 */
function millisOf(stored: unknown): number {
  if (stored instanceof Date) return stored.getTime();
  // sqlite hands back exactly what was written; mysql2 can be configured to.
  return new Date(String(stored).replace(' ', 'T') + (String(stored).endsWith('Z') ? '' : 'Z')).getTime();
}

const EXPECTED_MILLIS = new Date('2026-09-06T12:34:56.000Z').getTime();

describe('generated defaults round-trip on sqlite', () => {
  let db: AnyDb;

  beforeAll(() => {
    const sqlite = new BetterSqlite3(':memory:');
    sqlite.exec(
      'CREATE TABLE conversations (id text PRIMARY KEY, status text NOT NULL, created_at text NOT NULL)',
    );
    db = new Kysely<SourceDatabase>({ dialect: new SqliteDialect({ database: sqlite }) });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('writes a minted id and instant, and reads both back', async () => {
    const { values, stored } = await roundTrip(db, 'sqlite', 'main');
    expect(stored['id']).toBe(values['id']);
    expect(stored['status']).toBe('open');
    expect(millisOf(stored['created_at'])).toBe(EXPECTED_MILLIS);
  });
});

const POSTGRES_URL = process.env.TEST_POSTGRES_URL;

describe.skipIf(POSTGRES_URL === undefined)('generated defaults round-trip on postgres', () => {
  const schema = `adminium_test_generate_${randomBytes(4).toString('hex')}`;
  let db: AnyDb;

  beforeAll(async () => {
    const pg = await import('pg');
    db = new Kysely<SourceDatabase>({
      dialect: new PostgresDialect({ pool: new pg.default.Pool({ connectionString: POSTGRES_URL }) }),
    });
    await db.schema.createSchema(schema).execute();
    await db.schema
      .createTable(`${schema}.conversations`)
      .addColumn('id', 'varchar(36)', (c) => c.primaryKey())
      .addColumn('status', 'text', (c) => c.notNull())
      .addColumn('created_at', 'timestamptz', (c) => c.notNull())
      .execute();
  });

  afterAll(async () => {
    await db.schema.dropSchema(schema).cascade().execute();
    await db.destroy();
  });

  it('writes a minted id and instant, and reads both back', async () => {
    const { values, stored } = await roundTrip(db, 'postgres', schema);
    expect(stored['id']).toBe(values['id']);
    expect(millisOf(stored['created_at'])).toBe(EXPECTED_MILLIS);
  });
});

const MYSQL_URL = process.env.TEST_MYSQL_URL;

describe.skipIf(MYSQL_URL === undefined)('generated defaults round-trip on mysql', () => {
  const database = `adminium_test_generate_${randomBytes(4).toString('hex')}`;
  let admin: import('mysql2/promise').Connection;
  let db: AnyDb;

  beforeAll(async () => {
    const mysqlPromise = await import('mysql2/promise');
    admin = await mysqlPromise.default.createConnection(MYSQL_URL as string);
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.query(
      `CREATE TABLE \`${database}\`.conversations (id VARCHAR(36) PRIMARY KEY, status TEXT NOT NULL, created_at DATETIME(3) NOT NULL)`,
    );
    const mysql = await import('mysql2');
    db = new Kysely<SourceDatabase>({
      dialect: new MysqlDialect({
        pool: mysql.default.createPool({ uri: `${MYSQL_URL as string}/${database}`, timezone: 'Z' }),
      }),
    });
  });

  afterAll(async () => {
    await db.destroy();
    await admin.query(`DROP DATABASE \`${database}\``);
    await admin.end();
  });

  it('writes a minted id and instant that `datetime` accepts, and reads both back', async () => {
    /*
     * THE RISK 33 §12 NAMED. An ISO instant with its `T` and `Z` is what the
     * other two dialects want and what this column refuses; `instantFor`
     * reshapes it, and this is the only place that reshaping is checked
     * against a real MySQL rather than against a string.
     *
     * It also exercises `insertRow`'s mysql branch, which has no RETURNING and
     * re-selects by the primary key it was handed — reachable here precisely
     * BECAUSE the sentinel provided one. Before this feature there was nothing
     * to re-select by on a public create.
     */
    const { values, inserted, stored } = await roundTrip(db, 'mysql', database);
    expect(inserted['id']).toBe(values['id']);
    expect(stored['id']).toBe(values['id']);
    expect(millisOf(stored['created_at'])).toBe(EXPECTED_MILLIS);
  });
});
