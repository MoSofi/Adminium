// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COLUMN RULES — what Adminium fills in, and what it refuses, before a row
 * reaches the database.
 *
 * The case this was written for: a `patients` table whose `created_at` is NOT
 * NULL with no database default could not take a new row at all. Here that is
 * a unit: the table's own facts produce a `now` fill, and the fill puts a
 * value there that the person filling in the form never had to type.
 *
 * Two things this file is careful about, both of them found by attacking the
 * design before the code was written:
 *
 *   · the CLOCK — a `date` or a naive `timestamp` carries no zone, so
 *     "now" in one of them is the server's wall clock, and a UTC instant would
 *     put a row written at 22:00 in UTC−5 on tomorrow's date;
 *   · the ENGINE — SQLite stores `'abc'` in an `integer` column and any
 *     string in a `uuid` column, so a shape check that ran there would refuse
 *     writes that succeed today.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { applyClassification, parseDatabaseModel, type Dialect } from '@adminium/engine';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import {
  checkRow,
  fillRow,
  tableRulesFor,
  type ColumnFill,
  type TableRules,
} from '../src/crud/column-rules.js';
import { instantFor, localDate, localTime, localTimestamp, renderNow } from '../src/crud/instants.js';
import type { WriteActor } from '../src/crud/write-service.js';

/* ------------------------------------------------------------- the fixture */

interface ColumnInput {
  name: string;
  logicalType: string;
  nullable?: boolean;
  isPrimaryKey?: boolean;
  isGenerated?: boolean;
  default?: { kind: string; text?: string } | null;
  enumRef?: string | null;
}

function viewOf(dialect: Dialect, columns: ColumnInput[], enums: { id: string; values: string[] }[] = []) {
  const model = applyClassification(
    parseDatabaseModel({
      dialect,
      name: 'clinic',
      defaultSchema: 'public',
      schemas: ['public'],
      enums: enums.map((e) => ({ id: e.id, name: e.id, values: e.values, source: 'native' })),
      tables: [
        {
          schema: 'public',
          name: 'patients',
          primaryKey: columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name),
          columns,
        },
      ],
      relations: [],
    }),
  );
  const view = new SnapshotView('conn_1', applyOverrides(model, []));
  return { view, table: view.table('public.patients') };
}

function target(dialect: Dialect, columns: ColumnInput[], enums?: { id: string; values: string[] }[]) {
  const { view, table } = viewOf(dialect, columns, enums);
  return { view, table } as { view: SnapshotView; table: ResolvedTable };
}

/** The same table with one column carrying a Studio `column.semanticType` row. */
function taggedView(dialect: Dialect, columns: ColumnInput[], column: string, semanticType: string) {
  const model = applyClassification(
    parseDatabaseModel({
      dialect,
      name: 'clinic',
      defaultSchema: 'public',
      schemas: ['public'],
      tables: [
        {
          schema: 'public',
          name: 'patients',
          primaryKey: columns.filter((c) => c.isPrimaryKey === true).map((c) => c.name),
          columns,
        },
      ],
      relations: [],
    }),
  );
  const override = {
    id: 'ovr_1',
    status: 'active',
    op: 'column.semanticType',
    tableName: 'public.patients',
    columnName: column,
    value: { semanticType },
  };
  const view = new SnapshotView('conn_1', applyOverrides(model, [override as never]));
  return { view, table: view.table('public.patients') } as { view: SnapshotView; table: ResolvedTable };
}

const NOW = new Date('2026-09-06T12:34:56.789Z');
const actor: WriteActor = { kind: 'user', id: 'usr_1', label: 'Ada Lovelace' };
const ctx = (dialect: Dialect) => ({ dialect, now: NOW, actor });

const OWNER_CASE: ColumnInput[] = [
  { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } },
  { name: 'full_name', logicalType: 'varchar', nullable: false },
  { name: 'created_at', logicalType: 'timestamptz', nullable: false },
];

/* ------------------------------------------------------------ the instants */

describe('the clock a fill reads', () => {
  const TZ = process.env.TZ;
  afterEach(() => {
    if (TZ === undefined) delete process.env.TZ;
    else process.env.TZ = TZ;
  });

  it('writes a zoned instant in UTC and a naive one in the server’s own zone', () => {
    process.env.TZ = 'America/New_York'; // UTC−4 on this date: 08:34 local
    expect(renderNow({ logicalType: 'timestamptz' }, 'postgres', NOW)).toBe('2026-09-06T12:34:56.789Z');
    expect(renderNow({ logicalType: 'timestamptz' }, 'mysql', NOW)).toBe('2026-09-06 12:34:56.789');
    expect(renderNow({ logicalType: 'timestamp' }, 'postgres', NOW)).toBe('2026-09-06 08:34:56.789');
    expect(renderNow({ logicalType: 'date' }, 'postgres', NOW)).toBe('2026-09-06');
    expect(renderNow({ logicalType: 'time' }, 'postgres', NOW)).toBe('08:34:56');
  });

  it('puts a late evening on the LOCAL day, not tomorrow’s UTC one', () => {
    // 2026-09-06T03:30Z is 2026-09-05 at 23:30 in New York. A `date` column
    // filled with the UTC day would be off by one for every evening write.
    process.env.TZ = 'America/New_York';
    const evening = new Date('2026-09-06T03:30:00.000Z');
    expect(localDate(evening)).toBe('2026-09-05');
    expect(localTime(evening)).toBe('23:30:00');
    expect(instantFor('postgres', evening)).toBe('2026-09-06T03:30:00.000Z');
  });

  it('spells a naive timestamp the way the ordinary write path spells one', () => {
    process.env.TZ = 'UTC';
    // write-values.ts drops `.000`, so a filled value and an echoed one are
    // the same bytes.
    expect(localTimestamp(new Date('2026-09-06T12:34:56.000Z'))).toBe('2026-09-06 12:34:56');
    expect(localTimestamp(new Date('2026-09-06T12:34:56.700Z'))).toBe('2026-09-06 12:34:56.700');
  });

  it('writes nothing into a column that cannot hold an instant', () => {
    expect(renderNow({ logicalType: 'varchar' }, 'postgres', NOW)).toBeNull();
    expect(renderNow({ logicalType: 'integer' }, 'postgres', NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------- the derivation */

describe('the rules a table carries', () => {
  it('fills a NOT NULL created_at that nothing else fills — the owner’s case', () => {
    const rules = tableRulesFor(target('sqlite', OWNER_CASE));
    expect(rules?.fills).toEqual([
      { column: 'created_at', logicalType: 'timestamptz', kind: 'now', onUpdate: false, implicit: true },
    ]);
  });

  it('moves an updated_at on an update and a created_at never', () => {
    const rules = tableRulesFor(
      target('postgres', [
        ...OWNER_CASE,
        { name: 'updated_at', logicalType: 'timestamptz', nullable: false },
      ]),
    );
    const byColumn = new Map(rules?.fills.map((fill) => [fill.column, fill]));
    expect(byColumn.get('created_at')?.onUpdate).toBe(false);
    expect(byColumn.get('updated_at')?.onUpdate).toBe(true);
  });

  it('mints a uuid primary key, and leaves an integer one to the database', () => {
    const uuidKey = tableRulesFor(
      target('postgres', [
        { name: 'id', logicalType: 'uuid', nullable: false, isPrimaryKey: true },
        { name: 'full_name', logicalType: 'varchar' },
      ]),
    );
    expect(uuidKey?.fills.map((f) => [f.column, f.kind])).toEqual([['id', 'uuid']]);
    const serialKey = tableRulesFor(target('postgres', OWNER_CASE));
    expect(serialKey?.fills.some((f) => f.column === 'id')).toBe(false);
  });

  it('leaves a column the database already fills alone', () => {
    const rules = tableRulesFor(
      target('postgres', [
        ...OWNER_CASE.slice(0, 2),
        { name: 'created_at', logicalType: 'timestamptz', nullable: false, default: { kind: 'now' } },
      ]),
    );
    expect(rules?.fills).toEqual([]);
  });

  it('leaves a generated column alone', () => {
    const rules = tableRulesFor(
      target('postgres', [
        ...OWNER_CASE.slice(0, 2),
        { name: 'created_at', logicalType: 'timestamptz', nullable: false, isGenerated: true },
      ]),
    );
    expect(rules?.fills).toEqual([]);
  });

  it('needs a temporal TYPE, not just the tag', () => {
    /*
     * The heuristic classifier gates `created-at` on the timestamp family
     * (`classify/columns.ts` r09), but the `column.semanticType` OVERRIDE does
     * not: Studio's remap editor and an accepted LLM suggestion write the tag
     * straight onto whatever column an admin pointed at. Tag a `varchar` and
     * a tag-only fill would write an ISO string into it on every create.
     */
    const columns: ColumnInput[] = [
      ...OWNER_CASE.slice(0, 2),
      { name: 'reference', logicalType: 'varchar', nullable: false },
    ];
    const tagged = taggedView('postgres', columns, 'reference', 'created-at');
    expect(tagged.table.table.columns.find((c) => c.name === 'reference')?.semantics?.primary).toBe(
      'created-at',
    );
    expect(tableRulesFor(tagged)?.fills).toEqual([]);
  });

  it('answers null for a table with nothing to fill and nothing to check', () => {
    expect(
      tableRulesFor(
        target('postgres', [
          { name: 'id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'note', logicalType: 'text' },
        ]),
      ),
    ).toBeNull();
  });

  it('answers null for a hand-built table with no effective model behind it', () => {
    const bare = {
      view: {} as SnapshotView,
      table: { columns: new Map(), table: undefined } as unknown as ResolvedTable,
    };
    expect(tableRulesFor(bare)).toBeNull();
  });
});

/* ------------------------------------------------------------------ filling */

describe('filling a row', () => {
  const rulesOf = (dialect: Dialect, columns: ColumnInput[]) => tableRulesFor(target(dialect, columns));

  it('puts the instant in an absent created_at', () => {
    const rules = rulesOf('postgres', OWNER_CASE);
    expect(fillRow(rules, 'create', { full_name: 'Ada' }, ctx('postgres'))).toEqual({
      full_name: 'Ada',
      created_at: '2026-09-06T12:34:56.789Z',
    });
  });

  it('never overrides a supplied value, an explicit null included', () => {
    const rules = rulesOf('postgres', OWNER_CASE);
    const supplied = { full_name: 'Ada', created_at: null };
    expect(fillRow(rules, 'create', supplied, ctx('postgres'))).toBe(supplied);
  });

  it('returns the SAME object when there is nothing to add', () => {
    const values = { full_name: 'Ada', created_at: '2020-01-01T00:00:00.000Z' };
    expect(fillRow(rulesOf('postgres', OWNER_CASE), 'create', values, ctx('postgres'))).toBe(values);
    expect(fillRow(null, 'create', values, ctx('postgres'))).toBe(values);
  });

  it('fills only the onUpdate columns on an update, and nothing on a delete', () => {
    const rules = rulesOf('postgres', [
      ...OWNER_CASE,
      { name: 'updated_at', logicalType: 'timestamptz', nullable: false },
    ]);
    expect(fillRow(rules, 'update', { full_name: 'Ada' }, ctx('postgres'))).toEqual({
      full_name: 'Ada',
      updated_at: '2026-09-06T12:34:56.789Z',
    });
    const forDelete = {};
    expect(fillRow(rules, 'delete', forDelete, ctx('postgres'))).toBe(forDelete);
  });

  it('gives every column of one row the same instant', () => {
    const rules = rulesOf('postgres', [
      ...OWNER_CASE,
      { name: 'updated_at', logicalType: 'timestamptz', nullable: false },
    ]);
    const filled = fillRow(rules, 'create', { full_name: 'Ada' }, ctx('postgres'));
    expect(filled['created_at']).toBe(filled['updated_at']);
  });

  it('writes the other four kinds an explicit rule can ask for', () => {
    const fills: ColumnFill[] = [
      { column: 'ref', logicalType: 'uuid', kind: 'uuid', onUpdate: false, implicit: false },
      { column: 'tier', logicalType: 'varchar', kind: 'literal', text: 'standard', onUpdate: false, implicit: false },
      { column: 'author', logicalType: 'varchar', kind: 'current-user', userField: 'name', onUpdate: false, implicit: false },
      { column: 'author_id', logicalType: 'varchar', kind: 'current-user', onUpdate: false, implicit: false },
    ];
    const rules: TableRules = { fills, checks: [] };
    const filled = fillRow(rules, 'create', {}, ctx('postgres'));
    expect(filled['ref']).toMatch(/^[0-9a-f-]{36}$/);
    expect(filled['tier']).toBe('standard');
    expect(filled['author']).toBe('Ada Lovelace');
    expect(filled['author_id']).toBe('usr_1');
  });

  it('writes nothing for `database` and `none`', () => {
    // `database` says a trigger fills the column; `none` switches the implicit
    // fill off. Both are things an admin SAYS, and neither writes a value.
    const rules: TableRules = {
      fills: [
        { column: 'created_at', logicalType: 'timestamptz', kind: 'database', onUpdate: false, implicit: false },
        { column: 'code', logicalType: 'varchar', kind: 'none', onUpdate: false, implicit: false },
      ],
      checks: [],
    };
    const values = { full_name: 'Ada' };
    expect(fillRow(rules, 'create', values, ctx('postgres'))).toBe(values);
  });
});

/* ----------------------------------------------------------------- checking */

describe('checking a row', () => {
  const ENUM = [{ id: 'public.mood', values: ['calm', 'tense'] }];
  const COLUMNS: ColumnInput[] = [
    { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true, default: { kind: 'autoincrement' } },
    { name: 'mood', logicalType: 'enum', enumRef: 'public.mood' },
    { name: 'age', logicalType: 'integer' },
    { name: 'active', logicalType: 'boolean' },
    { name: 'meta', logicalType: 'json' },
    { name: 'ref', logicalType: 'uuid' },
  ];
  const rulesFor = (dialect: Dialect) => tableRulesFor(target(dialect, COLUMNS, ENUM));
  const check = (dialect: Dialect, values: Record<string, unknown>) =>
    checkRow(rulesFor(dialect), 'create', values, { dialect });

  it('refuses a value the database’s enum does not have — on every engine', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(check(dialect, { mood: 'wibble' })).toEqual({ mood: { code: 'not-allowed' } });
      expect(check(dialect, { mood: 'calm' })).toBeNull();
    }
  });

  it('accepts the numeric strings every caller already sends', () => {
    expect(check('postgres', { age: '42' })).toBeNull();
    expect(check('postgres', { age: 42 })).toBeNull();
    expect(check('postgres', { age: ' 42 ' })).toBeNull();
    expect(check('postgres', { age: 'abc' })).toEqual({ age: { code: 'invalid' } });
    expect(check('postgres', { age: '' })).toEqual({ age: { code: 'invalid' } });
  });

  it('accepts 0 / 1 and the spellings a boolean column takes', () => {
    for (const value of [true, false, 0, 1, 'true', 'FALSE', 'yes', 'no']) {
      expect(check('mysql', { active: value }), JSON.stringify(value)).toBeNull();
    }
    expect(check('mysql', { active: 'maybe' })).toEqual({ active: { code: 'invalid' } });
  });

  it('judges a shape only where the engine itself would', () => {
    // SQLite stores 'abc' in an integer column and any string in a uuid one.
    expect(check('sqlite', { age: 'abc', ref: 'not-a-uuid', meta: '{oops' })).toBeNull();
    expect(check('postgres', { age: 'abc' })).toEqual({ age: { code: 'invalid' } });
    expect(check('postgres', { ref: 'not-a-uuid' })).toEqual({ ref: { code: 'invalid' } });
    expect(check('postgres', { meta: '{oops' })).toEqual({ meta: { code: 'invalid' } });
    // MySQL has no uuid type — the column is char/varchar and takes anything.
    expect(check('mysql', { ref: 'not-a-uuid' })).toBeNull();
    expect(check('mysql', { meta: '{oops' })).toEqual({ meta: { code: 'invalid' } });
  });

  it('leaves null and an absent key alone — what they mean is the database’s business', () => {
    expect(check('postgres', { age: null, mood: null })).toBeNull();
    expect(check('postgres', {})).toBeNull();
  });

  it('reports every bad column at once, not just the first', () => {
    expect(check('postgres', { age: 'abc', mood: 'wibble' })).toEqual({
      age: { code: 'invalid' },
      mood: { code: 'not-allowed' },
    });
  });
});
