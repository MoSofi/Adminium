// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `SchemaEdit` vocabulary + validator.
 *
 * The six named cases done-when are the `describe('the six refusals names')`
 * block below; the reserved-word cases are.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTHORABLE_LOGICAL_TYPES,
  desiredTableToModel,
  isAuthorableLogicalType,
  isReservedWord,
  schemaEditSchema,
  validateSchemaEdit,
  type DesiredColumn,
  type DesiredTable,
  type EditValidationContext,
  type SchemaEdit,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const column = (over: Partial<DesiredColumn> = {}): DesiredColumn => ({
  name: 'title',
  logicalType: 'text',
  nullable: true,
  default: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  comment: null,
  ...over,
});

const table = (over: Partial<DesiredTable> = {}): DesiredTable => ({
  id: null,
  schema: null,
  name: 'articles',
  comment: null,
  columns: [column({ name: 'id', logicalType: 'integer', nullable: false, default: { kind: 'autoincrement' } }), column()],
  primaryKey: ['id'],
  uniques: [],
  indexes: [],
  foreignKeys: [],
  enumValues: {},
  ...over,
});

const edit = (over: Partial<SchemaEdit> = {}): SchemaEdit => ({
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  dropTables: [],
  ...over,
});

const actualTable = (over: Partial<EditValidationContext['actual'][number]> = {}) => ({
  id: 'public.customers',
  schema: 'public',
  name: 'customers',
  kind: 'table' as const,
  system: false,
  columns: [
    { name: 'id', isPrimaryKey: true } as never,
    { name: 'email', isPrimaryKey: false } as never,
  ],
  primaryKey: ['id'],
  ...over,
});

const ctx = (over: Partial<EditValidationContext> = {}): EditValidationContext => ({
  dialect: 'postgres',
  maxIdentifierLength: 63,
  actual: [actualTable()],
  metaSharesDatabase: false,
  isReserved: isReservedWord,
  ...over,
});

const codes = (issues: { code: string }[]) => issues.map((i) => i.code).sort();

// ---------------------------------------------------------------------------

describe('the authorable vocabulary (D30)', () => {
  it('admits exactly fourteen logical types', () => {
    expect(AUTHORABLE_LOGICAL_TYPES).toHaveLength(14);
    expect([...AUTHORABLE_LOGICAL_TYPES].sort()).toEqual(
      [
        'bigint', 'boolean', 'date', 'decimal', 'enum', 'float', 'integer', 'json',
        'text', 'time', 'timestamp', 'timestamptz', 'uuid', 'varchar',
      ].sort(),
    );
  });

  it('excludes the five display-only types', () => {
    for (const t of ['binary', 'interval', 'geometry', 'inet', 'unknown'] as const) {
      expect(isAuthorableLogicalType(t)).toBe(false);
    }
  });

  it('rejects an expression default at the Zod gate, before validation runs', () => {
    const body = edit({
      upsertTables: [
        { ...table(), columns: [{ ...column(), default: { kind: 'expression', text: 'now()' } as never }] },
      ],
    });
    expect(schemaEditSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a free-text check by having no field for one', () => {
    const body = { ...edit({ upsertTables: [table()] }) } as Record<string, unknown>;
    (body['upsertTables'] as DesiredTable[])[0] = {
      ...table(),
      checks: [{ name: null, expression: '1=1' }],
    } as never;
    // `strictObject` — an unknown key is a parse failure, not a silent drop.
    expect(schemaEditSchema.safeParse(body).success).toBe(false);
  });

  it('rejects TableModel-only fields on the wire (dbType, system, rowCountEstimate)', () => {
    for (const field of ['dbType', 'system', 'rowCountEstimate', 'semantics', 'label']) {
      const body = edit({ upsertTables: [{ ...table(), [field]: 'x' } as never] });
      expect(schemaEditSchema.safeParse(body).success, field).toBe(false);
    }
  });
});

describe('the six refusals names', () => {
  it('1. refuses an adminium_ name when the meta store shares the database', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'adminium_x' })] }),
      ctx({ metaSharesDatabase: true }),
    );
    expect(codes(issues)).toContain('META_NAMESPACE');
  });

  it('   …and allows it when the meta store lives elsewhere', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'adminium_x' })] }),
      ctx({ metaSharesDatabase: false }),
    );
    expect(codes(issues)).not.toContain('META_NAMESPACE');
  });

  it('2. refuses a 64-character name on postgres', () => {
    const name = `a${'b'.repeat(63)}`;
    expect(name).toHaveLength(64);
    const issues = validateSchemaEdit(edit({ upsertTables: [table({ name })] }), ctx());
    expect(codes(issues)).toContain('IDENTIFIER_TOO_LONG');
  });

  it('3. refuses a 65-character name on mysql and accepts 64', () => {
    const at64 = `a${'b'.repeat(63)}`;
    const at65 = `a${'b'.repeat(64)}`;
    const mysql = ctx({ dialect: 'mysql', maxIdentifierLength: 64 });
    expect(codes(validateSchemaEdit(edit({ upsertTables: [table({ name: at64 })] }), mysql))).not.toContain(
      'IDENTIFIER_TOO_LONG',
    );
    expect(codes(validateSchemaEdit(edit({ upsertTables: [table({ name: at65 })] }), mysql))).toContain(
      'IDENTIFIER_TOO_LONG',
    );
  });

  it('4. refuses a display-only type as a create target', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          { ...table(), columns: [column({ name: 'shape', logicalType: 'geometry' as never })] },
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNSUPPORTED_TYPE');
  });

  it('5. refuses a literal default that is not a literal of that type', () => {
    const bad = validateSchemaEdit(
      edit({
        upsertTables: [
          { ...table(), columns: [column({ name: 'n', logicalType: 'integer', default: { kind: 'literal', text: 'abc' } })] },
        ],
      }),
      ctx(),
    );
    expect(codes(bad)).toContain('INVALID_DEFAULT_LITERAL');

    const good = validateSchemaEdit(
      edit({
        upsertTables: [
          { ...table(), columns: [column({ name: 'n', logicalType: 'integer', default: { kind: 'literal', text: '42' } })] },
        ],
      }),
      ctx(),
    );
    expect(codes(good)).not.toContain('INVALID_DEFAULT_LITERAL');
  });

  it('6. refuses a system table as any kind of target', () => {
    const withSystem = ctx({
      actual: [actualTable({ id: 'public.adminium_users', name: 'adminium_users', system: true })],
    });
    expect(codes(validateSchemaEdit(edit({ dropTables: ['public.adminium_users'] }), withSystem))).toContain(
      'SYSTEM_TABLE',
    );
    expect(
      codes(
        validateSchemaEdit(
          edit({ renames: { tables: [{ from: 'public.adminium_users', to: 'users2' }], columns: [] } }),
          withSystem,
        ),
      ),
    ).toContain('SYSTEM_TABLE');
  });
});

describe('reserved words', () => {
  it('rejects select, order and user on postgres', () => {
    for (const word of ['select', 'order', 'user']) {
      const issues = validateSchemaEdit(edit({ upsertTables: [table({ name: word })] }), ctx());
      expect(codes(issues), word).toContain('RESERVED_IDENTIFIER');
    }
  });

  it('rejects rank on mysql 8 (it was legal in 5.7)', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'rank' })] }),
      ctx({ dialect: 'mysql', maxIdentifierLength: 64 }),
    );
    expect(codes(issues)).toContain('RESERVED_IDENTIFIER');
  });

  it('accepts status on all three — a keyword list would have refused it', () => {
    for (const dialect of ['postgres', 'mysql', 'sqlite'] as const) {
      expect(isReservedWord('status', dialect), dialect).toBe(false);
      expect(isReservedWord('name', dialect), dialect).toBe(false);
      expect(isReservedWord('value', dialect), dialect).toBe(false);
    }
  });

  it('is case-insensitive', () => {
    expect(isReservedWord('SELECT', 'postgres')).toBe(true);
  });
});

describe('foreign-key coherence', () => {
  it('refuses a single-column FK at a composite-PK target', () => {
    const composite = ctx({
      actual: [
        actualTable({
          id: 'public.order_items',
          name: 'order_items',
          primaryKey: ['order_id', 'sku'],
          columns: [
            { name: 'order_id', isPrimaryKey: true } as never,
            { name: 'sku', isPrimaryKey: true } as never,
          ],
        }),
      ],
    });
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          {
            ...table(),
            columns: [column({ name: 'id', logicalType: 'integer' }), column({ name: 'item_id', logicalType: 'integer' })],
            foreignKeys: [
              { name: null, columns: ['item_id'], toTable: 'public.order_items', toColumns: ['order_id'], onDelete: null, onUpdate: null },
            ],
          },
        ],
      }),
      composite,
    );
    expect(codes(issues)).toContain('COMPOSITE_KEY_TARGET');
  });

  it('refuses a target with no primary key', () => {
    const keyless = ctx({ actual: [actualTable({ primaryKey: [] })] });
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          {
            ...table(),
            columns: [column({ name: 'id', logicalType: 'integer' }), column({ name: 'c_id', logicalType: 'integer' })],
            foreignKeys: [
              { name: null, columns: ['c_id'], toTable: 'public.customers', toColumns: ['id'], onDelete: null, onUpdate: null },
            ],
          },
        ],
      }),
      keyless,
    );
    expect(codes(issues)).toContain('NO_PRIMARY_KEY_TARGET');
  });

  it('resolves a target this same edit creates', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({ name: 'authors', columns: [column({ name: 'id', logicalType: 'integer' })], primaryKey: ['id'] }),
          {
            ...table(),
            columns: [column({ name: 'id', logicalType: 'integer' }), column({ name: 'author_id', logicalType: 'integer' })],
            foreignKeys: [
              { name: null, columns: ['author_id'], toTable: 'authors', toColumns: ['id'], onDelete: null, onUpdate: null },
            ],
          },
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).not.toContain('UNKNOWN_TABLE');
  });
});

describe('D31 — a new table’s key must be readable back', () => {
  const uuidKeyTable = table({
    name: 'docs',
    columns: [column({ name: 'id', logicalType: 'uuid', nullable: false, default: { kind: 'uuid' } })],
    primaryKey: ['id'],
  });

  it('allows a database-generated uuid key on postgres', () => {
    const issues = validateSchemaEdit(edit({ upsertTables: [uuidKeyTable] }), ctx());
    expect(codes(issues)).not.toContain('UNADDRESSABLE_KEY');
  });

  it('refuses one on mysql and sqlite, where insert cannot read it back', () => {
    for (const dialect of ['mysql', 'sqlite'] as const) {
      const issues = validateSchemaEdit(
        edit({ upsertTables: [uuidKeyTable] }),
        ctx({ dialect, maxIdentifierLength: dialect === 'mysql' ? 64 : 128 }),
      );
      expect(codes(issues), dialect).toContain('UNADDRESSABLE_KEY');
    }
  });

  it('allows a table with no primary key at all — the consequence is stated, not refused', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'events_log', primaryKey: [] })] }),
      ctx(),
    );
    expect(codes(issues)).not.toContain('UNADDRESSABLE_KEY');
    expect(issues).toHaveLength(0);
  });
});

describe('enum columns (D32)', () => {
  it('requires a value list on an enum column', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [{ ...table(), columns: [column({ name: 'state', logicalType: 'enum' })], enumValues: {} }],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('ENUM_ON_NON_ENUM_COLUMN');
  });

  it('refuses a value list on a non-enum column', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [{ ...table(), enumValues: { title: ['a', 'b'] } }] }),
      ctx(),
    );
    expect(codes(issues)).toContain('ENUM_ON_NON_ENUM_COLUMN');
  });
});

describe('desiredTableToModel', () => {
  it('produces an IR table whose PK columns are never nullable', () => {
    const model = desiredTableToModel(
      table({ columns: [column({ name: 'id', logicalType: 'integer', nullable: true })], primaryKey: ['id'] }),
      { dbTypeFor: () => 'integer', defaultSchema: 'public' },
    );
    expect(model.columns[0]?.nullable).toBe(false);
    expect(model.columns[0]?.isPrimaryKey).toBe(true);
  });

  it('emits the one authorable CHECK shape from enumValues', () => {
    const model = desiredTableToModel(
      {
        ...table(),
        columns: [column({ name: 'state', logicalType: 'enum' })],
        primaryKey: [],
        enumValues: { state: ['draft', 'sent'] },
      },
      { dbTypeFor: () => 'varchar(64)', defaultSchema: 'public' },
    );
    expect(model.checks).toHaveLength(1);
    expect(model.checks[0]?.expression).toBe('state in ("draft", "sent")');
    expect(model.system).toBe(false);
  });

  it('marks a single-column unique as isUnique on the column', () => {
    const model = desiredTableToModel(
      { ...table(), uniques: [{ name: null, columns: ['title'] }] },
      { dbTypeFor: () => 'text', defaultSchema: 'public' },
    );
    expect(model.columns.find((c) => c.name === 'title')?.isUnique).toBe(true);
  });
});

describe('the refusals a STALE plan earns', () => {
  /*
   * Every one of these is a real sequence, not a hypothetical: two admins in
   * Studio at once, or one admin with a tab open from this morning. The plan
   * was built against a snapshot, the database has moved, and the edit now
   * names things that are not there. Refusing by NAME is what makes the next
   * screen actionable — "public.gone is not in the active snapshot" tells the
   * operator to re-read the schema; a bare 422 tells them to guess.
   */
  it('refuses a rename of a table that is no longer in the snapshot', () => {
    const issues = validateSchemaEdit(
      edit({ renames: { tables: [{ from: 'public.gone', to: 'still_here' }], columns: [] } }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_TABLE');
  });

  it('refuses a rename of a column that table does not have', () => {
    const issues = validateSchemaEdit(
      edit({
        renames: {
          tables: [],
          columns: [{ table: 'public.customers', from: 'nickname', to: 'handle' }],
        },
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_COLUMN');
  });

  it('refuses a rename onto a name the table already uses', () => {
    const issues = validateSchemaEdit(
      edit({
        renames: {
          tables: [],
          columns: [{ table: 'public.customers', from: 'email', to: 'id' }],
        },
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_COLUMN');
  });

  it('refuses a rename that renames nothing', () => {
    const issues = validateSchemaEdit(
      edit({
        renames: {
          tables: [],
          columns: [{ table: 'public.customers', from: 'email', to: 'email' }],
        },
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('INVALID_RENAME');
  });

  it('refuses a table renamed onto one that already exists', () => {
    const issues = validateSchemaEdit(
      edit({ renames: { tables: [{ from: 'public.customers', to: 'customers' }], columns: [] } }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_TABLE');
  });

  it('refuses a view as an upsert target — Adminium cannot author one', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ id: 'public.v_top', name: 'v_top' })] }),
      ctx({ actual: [actualTable({ id: 'public.v_top', name: 'v_top', kind: 'view' })] }),
    );
    expect(codes(issues)).toContain('NOT_A_TABLE');
  });

  it('refuses the same table twice in one edit', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ name: 'notes' }), table({ name: 'notes' })] }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_TABLE');
  });

  it('refuses a duplicate column inside one table', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({ columns: [column({ name: 'title' }), column({ name: 'title' })], primaryKey: [] }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('DUPLICATE_COLUMN');
  });

  it('refuses a primary key naming a column the table does not have', () => {
    const issues = validateSchemaEdit(
      edit({ upsertTables: [table({ primaryKey: ['nope'] })] }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_COLUMN');
  });

  it('refuses an index over a column the table does not have', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [table({ indexes: [{ name: null, columns: ['nope'], unique: false }] })],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_COLUMN');
  });
});

describe('foreign-key coherence (the link the owner asked for)', () => {
  it('refuses a target that exists neither in the edit nor in the database', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({
            columns: [column({ name: 'id' }), column({ name: 'client_id' })],
            primaryKey: ['id'],
            foreignKeys: [
              { name: null, columns: ['client_id'], toTable: 'public.ghosts', toColumns: ['id'], onDelete: null, onUpdate: null },
            ],
          }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_TABLE');
  });

  it('refuses a link whose two sides name different numbers of columns', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({
            columns: [column({ name: 'id' }), column({ name: 'client_id' })],
            primaryKey: ['id'],
            foreignKeys: [
              { name: null, columns: ['client_id'], toTable: 'public.customers', toColumns: ['id', 'email'], onDelete: null, onUpdate: null },
            ],
          }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('NO_PRIMARY_KEY_TARGET');
  });

  it('refuses a link from a column the table does not have', () => {
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({
            primaryKey: [],
            foreignKeys: [
              { name: null, columns: ['nope'], toTable: 'public.customers', toColumns: ['id'], onDelete: null, onUpdate: null },
            ],
          }),
        ],
      }),
      ctx(),
    );
    expect(codes(issues)).toContain('UNKNOWN_COLUMN');
  });

  it('accepts a link to a table this same edit is creating', () => {
    // The reservations→clients case, where BOTH are new: the target is not in
    // the snapshot yet and must still be a legal target.
    const issues = validateSchemaEdit(
      edit({
        upsertTables: [
          table({ name: 'clients', columns: [column({ name: 'id' })], primaryKey: ['id'] }),
          table({
            name: 'reservations',
            columns: [column({ name: 'id' }), column({ name: 'client_id' })],
            primaryKey: ['id'],
            foreignKeys: [
              { name: null, columns: ['client_id'], toTable: 'clients', toColumns: ['id'], onDelete: 'cascade', onUpdate: null },
            ],
          }),
        ],
      }),
      ctx(),
    );
    expect(issues).toEqual([]);
  });
});
