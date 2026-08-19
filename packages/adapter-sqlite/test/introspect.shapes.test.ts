// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Introspection against the SCHEMA SHAPES a real SQLite file can hold that
 * `northwind` and the §4.3 extras database do not — 05-introspection-engine.md
 * §4.3. Every fixture here is DDL SQLite actually accepts, loaded into a temp
 * file through the better-sqlite3 driver, so the assertions are about the
 * pragma output the adapter really sees:
 *
 *   - expression and partial indexes (`pragma_index_info` reports a NULL
 *     column name for an expression part; a PARTIAL unique index does not
 *     make its column globally unique)
 *   - implicit foreign keys (`REFERENCES parent` with no column list) —
 *     resolved against the target primary key, and DROPPED when the target
 *     has none
 *   - composite foreign keys, referential actions, and the one-to-one
 *     refinement a UNIQUE foreign-key column triggers
 *   - CHECK scanning against DDL comments, bracket-quoted identifiers,
 *     non-string IN lists, duplicate checks on one column, and the 256-value
 *     enum cap
 *   - virtual (FTS5) tables, whose hidden `table_xinfo` columns are not part
 *     of the model
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine/adapter';

import {
  createTestDatabase,
  makeTempDir,
  removeTempDir,
  sqliteDriverAvailable,
} from './harness.js';

const driverReady = await sqliteDriverAvailable();

/** 300 values — past the 256 cap (05 §10). */
const CAPPED_ENUM_VALUES = Array.from({ length: 300 }, (_, i) => `v${i}`);

const SHAPES_SQL = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL,
    status TEXT CHECK (STATUS IN ('active', 'locked')),
    tier INTEGER CHECK (tier IN (1, 2, 3))
  );
  CREATE INDEX users_lower_email ON users (lower(email));

  CREATE TABLE profile (
    user_id INTEGER NOT NULL UNIQUE REFERENCES users (id)
      ON DELETE CASCADE ON UPDATE SET NULL,
    bio TEXT
  );

  -- tags has NO primary key, so an implicit reference to it cannot resolve.
  CREATE TABLE tags (label TEXT NOT NULL);
  CREATE TABLE tagged (tag TEXT REFERENCES tags);

  CREATE TABLE audit (id INTEGER PRIMARY KEY, actor INTEGER REFERENCES users);

  CREATE TABLE part_parent (a TEXT, b TEXT, PRIMARY KEY (a, b));
  CREATE TABLE part_child (
    x TEXT,
    y TEXT,
    note TEXT,
    FOREIGN KEY (x, y) REFERENCES part_parent (a, b) ON DELETE RESTRICT
  );

  CREATE TABLE docs_meta (slug TEXT, archived INTEGER NOT NULL DEFAULT 0);
  CREATE UNIQUE INDEX docs_meta_slug_live ON docs_meta (slug) WHERE archived = 0;
  CREATE INDEX docs_meta_pair ON docs_meta (slug, archived);

  CREATE TABLE [odd table] (
    [odd col] TEXT CHECK ([odd col] IN ('x', 'y')),
    "quoted col" TEXT
  );

  CREATE TABLE commented (
    -- CHECK (decoy IN ('nope')) lives in a comment and is not a constraint
    a TEXT
  );

  CREATE TABLE dup_check (kind TEXT CHECK (kind IN ('p', 'q')) CHECK (kind IN ('r')));

  CREATE TABLE big_enum (
    v TEXT CHECK (v IN (${CAPPED_ENUM_VALUES.map((v) => `'${v}'`).join(', ')}))
  );

  CREATE VIRTUAL TABLE notes USING fts5(title, body);
`;

describe.skipIf(!driverReady)('exotic-but-real schema shapes', () => {
  let dir = '';
  let model: DatabaseModel;

  beforeAll(async () => {
    const mod = await import('../src/index.js');
    dir = makeTempDir();
    const file = await createTestDatabase(dir, false, SHAPES_SQL);
    const adapter = new mod.SqliteAdapter<'introspect'>('introspect');
    await adapter.connect({ role: 'introspect', file });
    try {
      model = await adapter.introspect();
    } finally {
      await adapter.close();
    }
  }, 60_000);

  afterAll(() => {
    if (dir !== '') removeTempDir(dir);
  });

  const table = (name: string) => model.tables.find((t) => t.name === name);
  const column = (tableName: string, columnName: string) =>
    table(tableName)?.columns.find((c) => c.name === columnName);
  const index = (tableName: string, indexName: string) =>
    table(tableName)?.indexes.find((i) => i.name === indexName);

  it('stays a valid DatabaseModel across all of them', () => {
    expect(() => parseDatabaseModel(JSON.stringify(model))).not.toThrow();
  });

  it('an expression index surfaces with NO columns (v1 limitation, not a crash)', () => {
    // pragma_index_info reports cid -2 / name NULL for the expression part;
    // dropping it is what keeps `columns` a list of real column names.
    expect(index('users', 'users_lower_email')).toMatchObject({
      columns: [],
      expression: null,
      unique: false,
      partial: false,
    });
  });

  it('a PARTIAL unique index does not make its column unique', () => {
    // `UNIQUE … WHERE archived = 0` only constrains the matching subset, so
    // treating the column as globally unique would let the UI offer it as a
    // lookup key it is not (05 §2.1).
    expect(index('docs_meta', 'docs_meta_slug_live')).toMatchObject({
      columns: ['slug'],
      unique: true,
      partial: true,
    });
    expect(column('docs_meta', 'slug')?.isUnique).toBe(false);
    expect(table('docs_meta')?.uniques).toEqual([]);
  });

  it('a multi-column index keeps its declared column order', () => {
    expect(index('docs_meta', 'docs_meta_pair')?.columns).toEqual(['slug', 'archived']);
    expect(column('docs_meta', 'archived')?.isUnique).toBe(false);
  });

  it('an implicit FK resolves against the target primary key', () => {
    // `actor INTEGER REFERENCES users` — pragma_foreign_key_list reports
    // to = NULL, and the target PK supplies the column.
    expect(model.relations.find((r) => r.id.startsWith('fk:main.audit'))).toMatchObject({
      from: { tableId: 'main.audit', columns: ['actor'] },
      to: { tableId: 'main.users', columns: ['id'] },
    });
    expect(column('audit', 'actor')?.references).toEqual({
      tableId: 'main.users',
      column: 'id',
    });
  });

  it('an implicit FK to a table with no primary key is dropped, not guessed', () => {
    expect(model.relations.some((r) => r.to.tableId === 'main.tags')).toBe(false);
    expect(column('tagged', 'tag')?.references).toBeNull();
  });

  it('a composite FK keeps column pairing and its referential action', () => {
    expect(model.relations.find((r) => r.id.startsWith('fk:main.part_child'))).toMatchObject({
      from: { tableId: 'main.part_child', columns: ['x', 'y'] },
      to: { tableId: 'main.part_parent', columns: ['a', 'b'] },
      onDelete: 'restrict',
      onUpdate: 'no-action',
      cardinality: 'one-to-many',
    });
    expect(column('part_child', 'y')?.references).toEqual({
      tableId: 'main.part_parent',
      column: 'b',
    });
  });

  it('a UNIQUE FK column refines the relation to one-to-one, with actions mapped', () => {
    expect(model.relations.find((r) => r.id.startsWith('fk:main.profile'))).toMatchObject({
      cardinality: 'one-to-one',
      onDelete: 'cascade',
      onUpdate: 'set-null',
      selfReferential: false,
    });
    expect(column('profile', 'user_id')?.isUnique).toBe(true);
  });

  it('a CHECK inside a `--` comment is not a constraint', () => {
    expect(table('commented')?.checks).toEqual([]);
    expect(model.enums.some((e) => e.values.includes('nope'))).toBe(false);
  });

  it('a non-string IN list is a CHECK but never an enum', () => {
    expect(table('users')?.checks).toContainEqual({
      name: null,
      expression: 'tier IN (1, 2, 3)',
    });
    expect(column('users', 'tier')?.enumRef).toBeNull();
    expect(model.enums.some((e) => e.id === 'main.users.tier')).toBe(false);
  });

  it('CHECK column names are matched case-insensitively, like SQLite itself', () => {
    // `CHECK (STATUS IN …)` on a column declared `status` is the SAME column —
    // SQLite identifiers are case-insensitive — and the synthesized enum is
    // keyed by the DECLARED spelling.
    expect(model.enums.find((e) => e.id === 'main.users.status')).toEqual({
      id: 'main.users.status',
      name: 'status',
      values: ['active', 'locked'],
      source: 'check',
    });
    expect(column('users', 'status')?.enumRef).toBe('main.users.status');
  });

  it('the first CHECK on a column wins; a second does not overwrite the enum', () => {
    expect(table('dup_check')?.checks).toHaveLength(2);
    expect(model.enums.filter((e) => e.id === 'main.dup_check.kind')).toHaveLength(1);
    expect(model.enums.find((e) => e.id === 'main.dup_check.kind')?.values).toEqual(['p', 'q']);
  });

  it('bracket-quoted identifiers are scanned, and a spaced name yields no enum', () => {
    // `[odd col]` is a real SQLite identifier; the CHECK is captured verbatim.
    // The enum-head pattern only accepts word characters, so a name with a
    // space synthesizes NOTHING — which is the safe outcome: the value list is
    // never attributed to a different column.
    expect(table('odd table')?.checks).toEqual([
      { name: null, expression: "[odd col] IN ('x', 'y')" },
    ]);
    expect(column('odd table', 'odd col')?.enumRef).toBeNull();
    expect(model.enums.some((e) => e.values.includes('x'))).toBe(false);
  });

  it('caps a synthesized enum at 256 values and says so', () => {
    const capped = model.enums.find((e) => e.id === 'main.big_enum.v');
    expect(capped?.values).toHaveLength(256);
    expect(capped?.values[0]).toBe('v0');
    expect(capped?.values.at(-1)).toBe('v255');
    expect(
      model.warnings.find(
        (w) => w.code === 'enum-capped' && w.tableId === 'main.big_enum',
      )?.message,
    ).toContain('300');
  });

  it('a virtual (FTS5) table exposes its declared columns only', () => {
    // table_xinfo also lists the hidden `notes` and `rank` columns; hidden
    // columns are not addressable, so they are not part of the model.
    expect(table('notes')?.columns.map((c) => c.name)).toEqual(['title', 'body']);
    expect(table('notes')?.kind).toBe('table');
  });

  it('counts every table exactly, including the FTS5 shadow tables', () => {
    for (const t of model.tables) {
      expect(t.rowCountExact).toBe(true);
      expect(t.rowCountEstimate).not.toBeNull();
    }
    expect(table('users')?.rowCountEstimate).toBe(0);
    // The FTS5 shadow tables are ordinary tables to sqlite_master, so they are
    // introspected and counted like any other.
    expect(model.tables.map((t) => t.name)).toEqual(expect.arrayContaining(['notes_data']));
  });
});
