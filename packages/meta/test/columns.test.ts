// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The portable column-type contract (07-meta-store.md §2.1).
 *
 * `columnHelpers` is one of the few modules allowed to branch on dialect, and
 * what it returns is not a value any repo can observe — it is DDL, emitted once
 * per table at migration time. So this compiles a table that uses every helper
 * through Kysely's real per-dialect query compilers (a `DummyDriver` means no
 * database is touched and the assertion is a pure string) and pins the SQL each
 * of the three dialects gets.
 *
 * Two of the rows in that table are load-bearing rather than cosmetic and are
 * called out again below: postgres `id` and the boolean literals.
 */
import {
  DummyDriver,
  Kysely,
  MysqlAdapter,
  MysqlIntrospector,
  MysqlQueryCompiler,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type DatabaseIntrospector,
  type Dialect,
  type DialectAdapter,
  type QueryCompiler,
} from 'kysely';
import { describe, expect, it } from 'vitest';

import { columnHelpers, type MetaDialect } from '../src/index.js';

const DIALECTS: Record<MetaDialect, Dialect> = {
  postgres: {
    createAdapter: (): DialectAdapter => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db): DatabaseIntrospector => new PostgresIntrospector(db),
    createQueryCompiler: (): QueryCompiler => new PostgresQueryCompiler(),
  },
  mysql: {
    createAdapter: (): DialectAdapter => new MysqlAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db): DatabaseIntrospector => new MysqlIntrospector(db),
    createQueryCompiler: (): QueryCompiler => new MysqlQueryCompiler(),
  },
  sqlite: {
    createAdapter: (): DialectAdapter => new SqliteAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db): DatabaseIntrospector => new SqliteIntrospector(db),
    createQueryCompiler: (): QueryCompiler => new SqliteQueryCompiler(),
  },
};

/** The DDL one dialect emits for a table that uses every helper in §2.1. */
function createTableSql(dialect: MetaDialect): string {
  const db = new Kysely<Record<string, never>>({ dialect: DIALECTS[dialect] });
  const c = columnHelpers(dialect);
  expect(c.dialect).toBe(dialect);
  return db.schema
    .createTable('probe')
    .addColumn('id', c.id, (col) => col.primaryKey())
    .addColumn('name', c.str(120))
    .addColumn('body', c.text)
    .addColumn('payload', c.json)
    .addColumn('flag', c.bool, (col) => col.defaultTo(c.boolDefault(true)))
    .addColumn('other_flag', c.bool, (col) => col.defaultTo(c.boolDefault(false)))
    .addColumn('n', c.int)
    .addColumn('big', c.bigint)
    .addColumn('at', c.ts)
    .compile().sql;
}

describe('columnHelpers emits the §2.1 type table', () => {
  it('postgres', () => {
    expect(createTableSql('postgres')).toBe(
      'create table "probe" (' +
        '"id" varchar(36) primary key, ' +
        '"name" varchar(120), ' +
        '"body" text, ' +
        '"payload" jsonb, ' +
        '"flag" boolean default true, ' +
        '"other_flag" boolean default false, ' +
        '"n" integer, ' +
        '"big" bigint, ' +
        '"at" bigint)',
    );
  });

  it('mysql', () => {
    expect(createTableSql('mysql')).toBe(
      'create table `probe` (' +
        '`id` char(36) primary key, ' +
        '`name` varchar(120), ' +
        '`body` text, ' +
        '`payload` json, ' +
        '`flag` tinyint(1) default 1, ' +
        '`other_flag` tinyint(1) default 0, ' +
        '`n` integer, ' +
        '`big` bigint, ' +
        '`at` bigint)',
    );
  });

  it('sqlite', () => {
    expect(createTableSql('sqlite')).toBe(
      'create table "probe" (' +
        '"id" char(36) primary key, ' +
        '"name" text, ' +
        '"body" text, ' +
        '"payload" text, ' +
        '"flag" integer default 1, ' +
        '"other_flag" integer default 0, ' +
        '"n" integer, ' +
        '"big" integer, ' +
        '"at" integer)',
    );
  });

  /**
   * The one deliberate deviation from the §2.1 table, and the reason it exists:
   * postgres `char(36)` is `bpchar`, which blank-pads on write and hands the
   * padding back on every read, so a 31-character `view_<ULID>` round-trips as
   * `'view_…     '` and stops matching itself. MySQL strips CHAR padding at
   * retrieval and SQLite ignores the length, so only postgres needs `varchar`.
   *
   * Pinned separately from the table above because "make the three dialects
   * agree" is exactly the tidy-up that would reintroduce the bug.
   */
  it('gives postgres varchar(36) ids, not the blank-padding char(36)', () => {
    expect(createTableSql('postgres')).toContain('"id" varchar(36)');
    // `\b` matters: `varchar(36)` contains `char(36)` as a substring.
    expect(createTableSql('postgres')).not.toMatch(/\bchar\(36\)/);
    expect(createTableSql('mysql')).toContain('`id` char(36)');
    expect(createTableSql('sqlite')).toContain('"id" char(36)');
  });

  /**
   * `boolDefault` exists because a DDL `DEFAULT` clause is not a bound
   * parameter: postgres rejects `default 1` on a boolean column and sqlite has
   * no `true` keyword in older builds, so each dialect needs its own literal.
   */
  it('emits a dialect-legal boolean literal in a DEFAULT clause', () => {
    expect(createTableSql('postgres')).toContain('"flag" boolean default true');
    expect(createTableSql('mysql')).toContain('`flag` tinyint(1) default 1');
    expect(createTableSql('sqlite')).toContain('"flag" integer default 1');
  });
});

describe('columnHelpers.str bounds', () => {
  it('accepts the whole documented range on every dialect', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      const c = columnHelpers(dialect);
      expect(() => c.str(1)).not.toThrow();
      expect(() => c.str(2048)).not.toThrow();
    }
    // The bound is a width, so only the non-sqlite dialects show it.
    expect(columnHelpers('postgres').str(2048)).toBe('varchar(2048)');
    expect(columnHelpers('mysql').str(1)).toBe('varchar(1)');
    expect(columnHelpers('sqlite').str(320)).toBe('text');
  });

  /**
   * Rejected rather than clamped: a caller asking for `str(4096)` wants an
   * indexable column wider than MySQL utf8mb4 can index, and silently handing
   * back `varchar(2048)` would truncate real data at write time on two of the
   * three dialects. Anything longer belongs in `text`.
   */
  it.each([0, -1, 2049, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects str(%s) instead of clamping it',
    (n) => {
      expect(() => columnHelpers('postgres').str(n)).toThrow(RangeError);
      expect(() => columnHelpers('sqlite').str(n)).toThrow(/\[1, 2048\]/);
    },
  );
});
