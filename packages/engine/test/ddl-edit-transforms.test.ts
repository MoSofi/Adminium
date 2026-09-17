// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The two DesiredTable → TableModel transforms — (`desiredTableToModel`)
 * (`tableWithAddedColumns`).
 *
 * `test/ddl-edit.test.ts` covers the vocabulary and the validator: what a
 * caller may SAY. This file covers what comes out the other side — the IR the
 * planner then diffs. That distinction is why these assertions are on
 * structure (which columns, in what order, carrying which flags) rather than
 * on issue codes.
 *
 * The load-bearing pair is `tableWithAddedColumns`' two diff tests. D6's whole
 * claim is that the addColumns door is lossless where a `DesiredTable`
 * restatement is not, so both halves are asserted against the same table with
 * the same real diff: the transform's output shows the planner ONE addition,
 * and the restatement of that same table invents a `drop-default` on a column
 * nobody named.
 */
import { describe, expect, it } from 'vitest';

import {
  desiredTableToModel,
  diffTableDefinitions,
  tableWithAddedColumns,
  type ColumnModel,
  type DesiredColumn,
  type DesiredTable,
  type TableModel,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures — minimal by hand (the `ddl-diff.test.ts` convention), so a failure
// points at the transform and not at 800 lines of Northwind.
// ---------------------------------------------------------------------------

/** A snapshot column: what the INTROSPECTOR produced, native type and all. */
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

const tbl = (over: Partial<TableModel> & { name: string }): TableModel => ({
  id: `public.${over.name}`,
  schema: 'public',
  kind: 'table',
  comment: null,
  columns: [col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false })],
  primaryKey: ['id'],
  uniques: [],
  checks: [],
  indexes: [],
  rowCountEstimate: null,
  rowCountExact: false,
  sizeBytes: null,
  activity: null,
  rls: null,
  system: false,
  semantics: null,
  ...over,
});

/** An AUTHORED column: the closed vocabulary, no native type. */
const desiredColumn = (over: Partial<DesiredColumn> & { name: string }): DesiredColumn => ({
  logicalType: 'text',
  nullable: true,
  default: null,
  maxLength: null,
  numericPrecision: null,
  numericScale: null,
  comment: null,
  ...over,
});

const desiredTable = (over: Partial<DesiredTable> & { name: string }): DesiredTable => ({
  id: null,
  schema: null,
  comment: null,
  columns: [desiredColumn({ name: 'id', logicalType: 'integer', nullable: false })],
  primaryKey: ['id'],
  uniques: [],
  indexes: [],
  foreignKeys: [],
  enumValues: {},
  ...over,
});

/**
 * The snapshot table both `tableWithAddedColumns` blocks work on. Every column
 * after `id` is there to be UNAUTHORABLE in one specific way, because that is
 * what the round trip D6 replaces is lossy about:
 *
 *   `number`  a default the vocabulary has no kind for (`expression`)
 *   `span`    a display-only logical type (D30's five)
 *   `total`   a stored generated column, plus a precision/scale the authored
 *             form can state but the planner would have to re-derive
 *   `owner`   the FK mirror, which lives on the relation list, not the column
 */
const invoices = tbl({
  name: 'invoices',
  columns: [
    col({ name: 'id', ordinal: 1, dbType: 'bigint', logicalType: 'bigint', isPrimaryKey: true, nullable: false }),
    col({
      name: 'number',
      ordinal: 2,
      dbType: 'text',
      nullable: false,
      default: { kind: 'expression', text: "nextval('invoices_number_seq'::regclass)" },
    }),
    col({ name: 'span', ordinal: 3, dbType: 'interval', logicalType: 'interval' }),
    col({
      name: 'total',
      ordinal: 4,
      dbType: 'numeric(12,2)',
      logicalType: 'decimal',
      numericPrecision: 12,
      numericScale: 2,
      isGenerated: true,
    }),
    col({
      name: 'owner',
      ordinal: 5,
      dbType: 'bigint',
      logicalType: 'bigint',
      references: { tableId: 'public.customers', column: 'id' },
    }),
  ],
  primaryKey: ['id'],
  uniques: [{ name: 'invoices_number_key', columns: ['number'] }],
  // A real check, so the "carries it through" assertion below is falsifiable:
  // against the default `[]` it compared an empty array to an empty array and
  // passed for any implementation, including one that dropped checks entirely.
  checks: [{ name: 'invoices_total_nonneg', expression: 'total >= 0' }],
  indexes: [
    { name: 'invoices_owner_idx', columns: ['owner'], expression: null, unique: false, primary: false, method: 'btree', partial: false },
  ],
  rowCountEstimate: 4200,
  comment: 'billing',
});

/** `dbTypeFor` that also records what it was asked about (D30: the planner owns native types). */
const recordingTypeMap = (answer = 'text') => {
  const asked: DesiredColumn[] = [];
  return {
    asked,
    dbTypeFor: (column: DesiredColumn) => {
      asked.push(column);
      return answer;
    },
  };
};

// ---------------------------------------------------------------------------

describe('tableWithAddedColumns — the snapshot’s own table, extended', () => {
  it('appends the new columns after every existing one, in the order given', () => {
    const result = tableWithAddedColumns(
      invoices,
      [desiredColumn({ name: 'note' }), desiredColumn({ name: 'archived', logicalType: 'boolean' })],
      { dbTypeFor: () => 'text' },
    );
    expect(result.columns.map((c) => c.name)).toEqual([
      'id', 'number', 'span', 'total', 'owner', 'note', 'archived',
    ]);
  });

  it('numbers the appended columns after the existing ones, in order', () => {
    const result = tableWithAddedColumns(
      invoices,
      [desiredColumn({ name: 'note' }), desiredColumn({ name: 'archived', logicalType: 'boolean' })],
      { dbTypeFor: () => 'text' },
    );
    // Five existing columns, so the additions are 6 and 7 — appended, never
    // inserted (MySQL 8.0.12+ can do an instant ADD only at the end).
    expect(result.columns.slice(5).map((c) => c.ordinal)).toEqual([6, 7]);
  });

  it('passes every existing column through by IDENTITY, not by reconstruction', () => {
    const result = tableWithAddedColumns(invoices, [desiredColumn({ name: 'note' })], {
      dbTypeFor: () => 'text',
    });
    // `toBe`, not `toEqual`: the docblock's "byte-for-byte" is the whole point,
    // and object identity is the only assertion no future rebuild can satisfy
    // by accident.
    for (const [index, before] of invoices.columns.entries()) {
      expect(result.columns[index]).toBe(before);
    }
  });

  it('shows the definition diff ONE addition and no change to anything else', () => {
    const result = tableWithAddedColumns(invoices, [desiredColumn({ name: 'note' })], {
      dbTypeFor: () => 'text',
    });
    const diff = diffTableDefinitions(invoices, result);
    expect(diff.addedColumns).toEqual(['note']);
    expect(diff.changedColumns).toEqual([]);
    expect(diff.removedColumns).toEqual([]);
    expect(diff.pkChanged).toBeNull();
    expect(diff.uniquesAdded).toEqual([]);
    expect(diff.uniquesRemoved).toEqual([]);
    expect(diff.indexesAdded).toEqual([]);
    expect(diff.indexesRemoved).toEqual([]);
    expect(diff.commentChanged).toBeNull();
  });

  it('is lossless where a DesiredTable restatement of the same table is not', () => {
    /*
     * The other half of the pair above, and D6's actual justification. A caller
     * who has only the snapshot rebuilds a `DesiredTable` from it — faithfully,
     * every column restated — but `expression` is not one of the five authorable
     * default kinds, so `number`'s `nextval(…)` has nowhere to go and comes back
     * `null`. The planner then reads the absence as intent.
     */
    const restated = desiredTableToModel(
      desiredTable({
        id: 'public.invoices',
        schema: 'public',
        name: 'invoices',
        comment: 'billing',
        columns: [
          desiredColumn({ name: 'id', logicalType: 'bigint', nullable: false }),
          desiredColumn({ name: 'number', nullable: false, default: null }),
          desiredColumn({ name: 'span', logicalType: 'interval' }),
          desiredColumn({ name: 'total', logicalType: 'decimal', numericPrecision: 12, numericScale: 2 }),
          desiredColumn({ name: 'owner', logicalType: 'bigint' }),
          desiredColumn({ name: 'note' }),
        ],
        uniques: [{ name: 'invoices_number_key', columns: ['number'] }],
      }),
      { dbTypeFor: () => 'text', defaultSchema: 'public' },
    );
    const diff = diffTableDefinitions(invoices, restated);
    expect(diff.addedColumns).toEqual(['note']);
    expect(diff.changedColumns).toEqual([
      {
        column: 'number',
        typeChanged: null,
        nullabilityChanged: null,
        defaultChanged: { from: "expression:nextval('invoices_number_seq'::regclass)", to: null },
        commentChanged: null,
      },
    ]);
  });

  it('never marks an added column as keyed, unique, generated, enum-backed or an array', () => {
    const [added] = tableWithAddedColumns(
      invoices,
      [desiredColumn({ name: 'note' })],
      { dbTypeFor: () => 'text' },
    ).columns.slice(-1);
    // A column that does not exist yet cannot already be covered by the table's
    // key or by one of its constraints, and `addColumns` has no field to ask for
    // one — so these are facts, not defaults a caller could override.
    expect(added?.isPrimaryKey).toBe(false);
    expect(added?.isUnique).toBe(false);
    expect(added?.isGenerated).toBe(false);
    expect(added?.isArray).toBe(false);
    expect(added?.enumRef).toBeNull();
    expect(added?.references).toBeNull();
    expect(added?.semantics).toBeNull();
  });

  it('carries the authored nullability verbatim — no primary-key correction', () => {
    const result = tableWithAddedColumns(
      invoices,
      [
        desiredColumn({ name: 'note' }),
        desiredColumn({ name: 'archived', logicalType: 'boolean', nullable: false }),
      ],
      { dbTypeFor: () => 'text' },
    );
    // `desiredTableToModel` forces `nullable: false` on a column named by the
    // primary key. This transform deliberately does not: a NEW column is never
    // in the EXISTING key, so a correction here could only ever be wrong.
    expect(result.columns.slice(5).map((c) => c.nullable)).toEqual([true, false]);
  });

  it('carries the authored default, length, precision, scale and comment onto the new column', () => {
    const [added] = tableWithAddedColumns(
      invoices,
      [
        desiredColumn({
          name: 'code',
          logicalType: 'varchar',
          maxLength: 120,
          default: { kind: 'literal', text: 'draft' },
          comment: 'the short code',
        }),
      ],
      { dbTypeFor: () => 'varchar(120)' },
    ).columns.slice(-1);
    expect(added?.logicalType).toBe('varchar');
    expect(added?.maxLength).toBe(120);
    expect(added?.default).toEqual({ kind: 'literal', text: 'draft' });
    expect(added?.comment).toBe('the short code');
    expect(added?.numericPrecision).toBeNull();
    expect(added?.numericScale).toBeNull();
  });

  it('asks the injected type map about each NEW column and about no existing one', () => {
    const map = recordingTypeMap('varchar(64)');
    const columns = [desiredColumn({ name: 'note' }), desiredColumn({ name: 'archived', logicalType: 'boolean' })];
    const result = tableWithAddedColumns(invoices, columns, { dbTypeFor: map.dbTypeFor });

    // D30: a native type string is produced in exactly one place, the planner's
    // forward map. Two additions, two questions — and the five existing columns
    // keep the type the CATALOG reported, never a re-derived one.
    expect(map.asked).toEqual(columns);
    expect(result.columns.slice(5).map((c) => c.dbType)).toEqual(['varchar(64)', 'varchar(64)']);
    expect(result.columns.map((c) => c.dbType)).toEqual([
      'bigint', 'text', 'interval', 'numeric(12,2)', 'bigint', 'varchar(64)', 'varchar(64)',
    ]);
  });

  it('keeps every table-level fact the snapshot carried, and mutates nothing', () => {
    const result = tableWithAddedColumns(invoices, [desiredColumn({ name: 'note' })], {
      dbTypeFor: () => 'text',
    });
    expect(result.id).toBe('public.invoices');
    expect(result.primaryKey).toEqual(['id']);
    expect(result.uniques).toEqual(invoices.uniques);
    expect(result.indexes).toEqual(invoices.indexes);
    expect(result.checks).toEqual(invoices.checks);
    expect(result.comment).toBe('billing');
    // Introspection facts a client may not assert survive too — they are read
    // off the desired model by the planner's hazard analysis.
    expect(result.rowCountEstimate).toBe(4200);
    expect(result.system).toBe(false);
    // And the snapshot itself is untouched: the planner diffs it afterwards.
    expect(invoices.columns).toHaveLength(5);
  });

  it('returns a distinct copy, and appends nothing, when no column is added', () => {
    const map = recordingTypeMap();
    const result = tableWithAddedColumns(invoices, [], { dbTypeFor: map.dbTypeFor });
    expect(result.columns).toEqual(invoices.columns);
    expect(map.asked).toEqual([]);
    expect(diffTableDefinitions(invoices, result).addedColumns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('desiredTableToModel — the authored index list', () => {
  const withIndexes = (indexes: DesiredTable['indexes']) =>
    desiredTableToModel(
      desiredTable({
        name: 'orders',
        columns: [
          desiredColumn({ name: 'id', logicalType: 'integer', nullable: false }),
          desiredColumn({ name: 'status' }),
          desiredColumn({ name: 'created_at', logicalType: 'timestamptz' }),
          desiredColumn({ name: 'email' }),
        ],
        indexes,
      }),
      { dbTypeFor: () => 'text', defaultSchema: 'public' },
    );

  it('derives an unnamed index’s name from the table and its columns', () => {
    const model = withIndexes([{ name: null, columns: ['status', 'created_at'], unique: false }]);
    expect(model.indexes.map((i) => i.name)).toEqual(['orders_status_created_at_idx']);
  });

  it('keeps the authored name when the caller gave one', () => {
    const model = withIndexes([{ name: 'orders_open_lookup', columns: ['status'], unique: false }]);
    expect(model.indexes[0]?.name).toBe('orders_open_lookup');
  });

  it('derives the name from the table’s NAME, not from its qualified id', () => {
    // A rename arrives as the old id plus the new name (the server maps the id
    // through `applyRenames`), so an index created in the same edit has to be
    // named after where the table is GOING.
    const model = desiredTableToModel(
      desiredTable({
        id: 'reporting.orders',
        schema: 'reporting',
        name: 'sales',
        columns: [desiredColumn({ name: 'status' })],
        primaryKey: [],
        indexes: [{ name: null, columns: ['status'], unique: false }],
      }),
      { dbTypeFor: () => 'text', defaultSchema: 'public' },
    );
    expect(model.indexes[0]?.name).toBe('sales_status_idx');
    expect(model.id).toBe('reporting.orders');
  });

  it('carries `unique` through and invents no expression, method, partiality or primacy', () => {
    const model = withIndexes([
      { name: null, columns: ['email'], unique: true },
      { name: null, columns: ['status'], unique: false },
    ]);
    expect(model.indexes.map((i) => i.unique)).toEqual([true, false]);
    // The four fields the closed vocabulary has no way to author (D30). An
    // authored index is never the primary key's, never an expression index,
    // never partial, and never picks an access method — the planner's per-dialect
    // renderer chooses that.
    for (const index of model.indexes) {
      expect(index.expression).toBeNull();
      expect(index.method).toBeNull();
      expect(index.partial).toBe(false);
      expect(index.primary).toBe(false);
    }
  });

  it('marks a single-column UNIQUE index on the column, but not a composite one', () => {
    const model = withIndexes([
      { name: null, columns: ['email'], unique: true },
      { name: null, columns: ['status', 'created_at'], unique: true },
      { name: null, columns: ['id'], unique: false },
    ]);
    // `isUnique` on a ColumnModel means "covered by a SINGLE-column unique",
    // which a composite index does not provide — a row may repeat either half.
    const isUnique = Object.fromEntries(model.columns.map((c) => [c.name, c.isUnique]));
    expect(isUnique).toEqual({ id: false, status: false, created_at: false, email: true });
  });
});
