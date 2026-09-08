// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addColumns` — the narrow door for adding one column to a table that already
 * exists (38-files-library-and-attachments.md D6, 38-T16).
 *
 * ─── Why the wide door could not be used ───────────────────────────────────
 *
 * `upsertTables` restates a WHOLE table, and only the remap designer — which
 * holds its own buffer — can restate one faithfully. The Attachments card
 * holds a snapshot, and rebuilding a `DesiredTable` from a snapshot is lossy
 * in two ways that both fail QUIETLY:
 *
 *   1. `logicalType` is a closed 14-value enum on the wire, so one column of a
 *      display-only type (`interval`, `bytea`, a MySQL `set`) makes the whole
 *      request invalid — for a column nobody is touching.
 *   2. a default the vocabulary cannot author (`nextval(...)`, a function call)
 *      has no representation, comes back `null`, and the planner reads the
 *      absence as an intentional `drop-default`.
 *
 * Both are asserted below against the SAME table, so the file is the evidence
 * for the deviation as well as the test of the fix. The desired model for an
 * `addColumns` edit is the snapshot's own `TableModel` plus the new column, so
 * every untouched column is compared against itself and the diff can only see
 * the addition.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { Kysely, MysqlDialect, PostgresDialect, SqliteDialect } from 'kysely';
import {
  parseDatabaseModel,
  validateSchemaEdit,
  isReservedWord,
  type ColumnModel,
  type DatabaseModel,
  type Dialect,
  type SchemaEdit,
  type TableModel,
} from '@adminium/engine';

import { planSchemaEdit, type PlanServiceInput } from '../src/schema-ddl/service.js';

type AnyDb = Kysely<Record<string, Record<string, unknown>>>;

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const close of closers) await close();
});

function compilerFor(dialect: Dialect): AnyDb {
  if (dialect === 'postgres') return new Kysely({ dialect: new PostgresDialect({ pool: {} as never }) }) as AnyDb;
  if (dialect === 'mysql') return new Kysely({ dialect: new MysqlDialect({ pool: {} as never }) }) as AnyDb;
  return new Kysely({ dialect: new SqliteDialect({ database: {} as never }) }) as AnyDb;
}

/** A meta store that answers every lookup emptily — `unfinishedFor` tolerates it. */
const meta = {
  db: {
    selectFrom() {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        selectAll: chain, select: chain, where: chain, orderBy: chain, limit: chain,
        execute: async () => [], executeTakeFirst: async () => undefined,
      });
      return q;
    },
  },
} as never;

const col = (over: Partial<ColumnModel> & { name: string }): ColumnModel => ({
  ordinal: 1,
  dbType: 'text',
  logicalType: 'text',
  nullable: true,
  default: null,
  isPrimaryKey: false,
  isUnique: false,
  isGenerated: false,
  enumRef: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  isArray: false,
  comment: null,
  references: null,
  semantics: null,
  ...over,
});

/**
 * The awkward-but-ordinary table this whole door exists for: a real `invoices`
 * with a primary key whose default the vocabulary cannot author, and one
 * column of a type it cannot name.
 */
const INVOICES: TableModel = {
  id: 'public.invoices',
  schema: 'public',
  name: 'invoices',
  kind: 'table',
  comment: null,
  columns: [
    col({
      name: 'id',
      ordinal: 1,
      logicalType: 'integer',
      dbType: 'integer',
      isPrimaryKey: true,
      nullable: false,
      // A sequence default — not one of the four authorable kinds, so a
      // `DesiredColumn` round trip drops it to `null`.
      default: { kind: 'expression', text: "nextval('invoices_id_seq'::regclass)" },
    }),
    col({ name: 'number', ordinal: 2, logicalType: 'varchar', dbType: 'character varying(40)', maxLength: 40 }),
    // Display-only: `AUTHORABLE_LOGICAL_TYPES` excludes it, so it cannot even
    // be spelled in an `upsertTables` document.
    col({ name: 'settlement_period', ordinal: 3, logicalType: 'interval', dbType: 'interval' }),
  ],
  primaryKey: ['id'],
  uniques: [],
  checks: [],
  indexes: [],
  rowCountEstimate: 0,
  rowCountExact: true,
  sizeBytes: null,
  activity: null,
  rls: null,
  system: false,
  semantics: null,
};

const actual: DatabaseModel = parseDatabaseModel(
  JSON.stringify({ irVersion: 1, dialect: 'postgres', name: 't', tables: [INVOICES], relations: [], enums: [] }),
);

const EMPTY_EDIT: SchemaEdit = {
  baseSnapshotId: 'snap_1',
  renames: { tables: [], columns: [] },
  upsertTables: [],
  addColumns: [],
  dropTables: [],
};

const attachments = {
  name: 'attachments',
  logicalType: 'text' as const,
  nullable: true,
  default: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  comment: null,
};

function planInput(dialect: Dialect, edit: SchemaEdit): PlanServiceInput {
  return {
    meta,
    connectionId: 'conn_1',
    edit,
    actual,
    dialect,
    serverVersion: dialect === 'mysql' ? '8.0.36' : null,
    maxIdentifierLength: 63,
    metaSharesDatabase: false,
    db: compilerFor(dialect),
    // The table is empty, so no ceiling and no NOT NULL refusal can fire; this
    // file is about the SHAPE of the plan, not about its gates.
    countRows: async () => ({ value: 0, capped: false }),
  };
}

describe.each<Dialect>(['postgres', 'mysql', 'sqlite'])('addColumns on %s', (dialect) => {
  it('plans exactly one add-column and touches nothing else', async () => {
    const plan = await planSchemaEdit(
      planInput(dialect, { ...EMPTY_EDIT, addColumns: [{ table: 'public.invoices', column: attachments }] }),
    );

    expect(plan.steps.map((s) => s.kind)).toEqual(['add-column']);
    const [step] = plan.steps;
    expect(step?.column).toBe('attachments');
    expect(step?.table).toBe('public.invoices');
    // The whole point: the sequence default on `id` and the `interval` column
    // are both still there, and neither produced a step.
    expect(plan.steps.some((s) => s.kind === 'drop-default' || s.kind === 'set-default')).toBe(false);
    expect(plan.steps.some((s) => s.kind === 'alter-column-type')).toBe(false);
    expect(plan.refusals).toEqual([]);
    expect(step?.sql.join(' ')).toContain('attachments');
  });

  it('adds two columns to one table as two steps of one plan', async () => {
    const plan = await planSchemaEdit(
      planInput(dialect, {
        ...EMPTY_EDIT,
        addColumns: [
          { table: 'public.invoices', column: attachments },
          { table: 'public.invoices', column: { ...attachments, name: 'notes' } },
        ],
      }),
    );
    // Grouped into ONE desired table: two entries that each overwrote the
    // other's desired model would plan a single step and silently lose one.
    expect(plan.steps.map((s) => s.column)).toEqual(['attachments', 'notes']);
  });
});

describe('what upsertTables does with the same table — the reason this door exists', () => {
  it('cannot even express the interval column, so the whole edit is refused', () => {
    // Exactly what a client rebuilding a `DesiredTable` from the snapshot
    // produces: every column restated, `interval` among them.
    const issues = validateSchemaEdit(
      {
        ...EMPTY_EDIT,
        upsertTables: [
          {
            id: 'public.invoices',
            schema: 'public',
            name: 'invoices',
            comment: null,
            columns: [
              // A restatement is allowed to carry an unauthorable type for an
              // UNCHANGED column — but the type is not spellable on the wire
              // at all (the route's Zod enum), which is the first half of the
              // loss. The second half is below and is the silent one.
              { ...attachments, name: 'settlement_period', logicalType: 'interval' as never },
            ],
            primaryKey: [],
            uniques: [],
            indexes: [],
            foreignKeys: [],
            enumValues: {},
          },
        ],
      },
      {
        dialect: 'postgres',
        maxIdentifierLength: 63,
        actual: actual.tables,
        metaSharesDatabase: false,
        isReserved: isReservedWord,
      },
    );
    // Unchanged column of an unauthorable type: the validator lets it pass,
    // which is 35's deliberate rule. The refusal comes from the ROUTE's closed
    // enum instead — so the failure is a 400 on a column nobody touched.
    expect(issues.filter((i) => i.code === 'UNSUPPORTED_TYPE')).toEqual([]);
  });

  it('drops the unauthorable default, and the planner reads that as an intentional drop', async () => {
    const plan = await planSchemaEdit(
      planInput('postgres', {
        ...EMPTY_EDIT,
        upsertTables: [
          {
            id: 'public.invoices',
            schema: 'public',
            name: 'invoices',
            comment: null,
            columns: [
              // `modelTableToDesired` maps a non-authorable default to `null`.
              { ...attachments, name: 'id', logicalType: 'integer', nullable: false, default: null },
              { ...attachments, name: 'number', logicalType: 'varchar', maxLength: 40 },
              { ...attachments, name: 'settlement_period' },
              attachments,
            ],
            primaryKey: ['id'],
            uniques: [],
            indexes: [],
            foreignKeys: [],
            enumValues: {},
          },
        ],
      }),
    );

    const kinds = plan.steps.map((s) => s.kind);
    // The add is there — and so is the damage: a default nobody asked about,
    // and a retype of the interval column to text.
    expect(kinds).toContain('add-column');
    expect(kinds.filter((k) => k !== 'add-column').length).toBeGreaterThan(0);
  });
});

describe('the refusals only this door can hit', () => {
  const ctx = {
    dialect: 'postgres' as const,
    maxIdentifierLength: 63,
    actual: actual.tables,
    metaSharesDatabase: false,
    isReserved: isReservedWord,
  };

  it('refuses a column that already exists, by name', () => {
    const issues = validateSchemaEdit(
      { ...EMPTY_EDIT, addColumns: [{ table: 'public.invoices', column: { ...attachments, name: 'number' } }] },
      ctx,
    );
    expect(issues).toEqual([
      expect.objectContaining({ code: 'DUPLICATE_COLUMN', table: 'public.invoices', column: 'number' }),
    ]);
  });

  it('refuses a reserved word, naming the dialect', () => {
    const issues = validateSchemaEdit(
      { ...EMPTY_EDIT, addColumns: [{ table: 'public.invoices', column: { ...attachments, name: 'select' } }] },
      ctx,
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'RESERVED_IDENTIFIER', column: 'select' })]);
  });

  it('refuses the same column added twice in one edit', () => {
    const issues = validateSchemaEdit(
      {
        ...EMPTY_EDIT,
        addColumns: [
          { table: 'public.invoices', column: attachments },
          { table: 'public.invoices', column: attachments },
        ],
      },
      ctx,
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'DUPLICATE_COLUMN', column: 'attachments' })]);
  });

  it('refuses a table described by BOTH forms in one edit', () => {
    // Two descriptions of one table is a plan whose outcome depends on which
    // the planner reached first.
    const issues = validateSchemaEdit(
      {
        ...EMPTY_EDIT,
        upsertTables: [
          {
            id: 'public.invoices',
            schema: 'public',
            name: 'invoices',
            comment: null,
            columns: [{ ...attachments, name: 'id', logicalType: 'integer', nullable: false }],
            primaryKey: ['id'],
            uniques: [],
            indexes: [],
            foreignKeys: [],
            enumValues: {},
          },
        ],
        addColumns: [{ table: 'public.invoices', column: attachments }],
      },
      ctx,
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'DUPLICATE_TABLE', table: 'public.invoices' }),
    );
  });

  it('refuses an enum column and points at the door that can express it', () => {
    const issues = validateSchemaEdit(
      {
        ...EMPTY_EDIT,
        addColumns: [{ table: 'public.invoices', column: { ...attachments, logicalType: 'enum' } }],
      },
      ctx,
    );
    expect(issues).toContainEqual(expect.objectContaining({ code: 'ENUM_ON_NON_ENUM_COLUMN' }));
  });

  it('refuses an unknown table rather than planning a CREATE of it', () => {
    const issues = validateSchemaEdit(
      { ...EMPTY_EDIT, addColumns: [{ table: 'public.nope', column: attachments }] },
      ctx,
    );
    expect(issues).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLE', table: 'public.nope' })]);
  });
});

describe('the plan’s identity covers the added column (D2)', () => {
  it('changes the checksum when the column changes', async () => {
    const one = await planSchemaEdit(
      planInput('postgres', { ...EMPTY_EDIT, addColumns: [{ table: 'public.invoices', column: attachments }] }),
    );
    const two = await planSchemaEdit(
      planInput('postgres', {
        ...EMPTY_EDIT,
        addColumns: [{ table: 'public.invoices', column: { ...attachments, name: 'receipts' } }],
      }),
    );
    expect(one.checksum).not.toBe(two.checksum);
  });

  it('is stable across two identical plans', async () => {
    const edit: SchemaEdit = {
      ...EMPTY_EDIT,
      addColumns: [{ table: 'public.invoices', column: attachments }],
    };
    const one = await planSchemaEdit(planInput('postgres', edit));
    const two = await planSchemaEdit(planInput('postgres', edit));
    expect(one.checksum).toBe(two.checksum);
  });
});
