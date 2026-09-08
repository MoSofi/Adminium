// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `diffTableDefinitions` and `applyRenames` — 35-schema-authoring.md 35-T31,
 * 35-T03.
 *
 * The load-bearing assertion in the first block is the pair: the definition
 * diff SEES a `varchar(50) → varchar(100)` and `diffModels` does not. That is
 * the entire reason 35-T31 exists, so it is asserted directly rather than
 * described in a comment.
 */
import { describe, expect, it } from 'vitest';

import {
  applyRenames,
  diffModels,
  diffTableDefinitions,
  isEmptyDefinitionDiff,
  parseDatabaseModel,
  type ColumnModel,
  type DatabaseModel,
  type Relation,
  type TableModel,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures — minimal by hand, so a failure points at the diff and not at 800
// lines of Northwind.
// ---------------------------------------------------------------------------

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

const model = (tables: TableModel[], relations: Relation[] = []): DatabaseModel =>
  parseDatabaseModel(
    JSON.stringify({
      irVersion: 1,
      dialect: 'postgres',
      name: 'test',
      tables,
      relations,
      enums: [],
    }),
  );

const rel = (over: Partial<Relation> & { from: Relation['from']; to: Relation['to'] }): Relation => ({
  id: `fk:${over.from.tableId}(${over.from.columns.join(',')})->${over.to.tableId}(${over.to.columns.join(',')})`,
  kind: 'declared-fk',
  cardinality: 'one-to-many',
  through: null,
  onDelete: null,
  onUpdate: null,
  selfReferential: over.from.tableId === over.to.tableId,
  confidence: 1,
  constraintName: null,
  ...over,
});

// ---------------------------------------------------------------------------

describe('diffTableDefinitions — the gap diffModels leaves (35-T31)', () => {
  const before = tbl({
    name: 'articles',
    columns: [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({ name: 'title', logicalType: 'varchar', maxLength: 50, dbType: 'character varying(50)' }),
    ],
  });
  const after = tbl({
    name: 'articles',
    columns: [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({ name: 'title', logicalType: 'varchar', maxLength: 100, dbType: 'character varying(100)' }),
    ],
  });

  it('reports a varchar length change that diffModels cannot see', () => {
    const definition = diffTableDefinitions(before, after);
    expect(definition.changedColumns).toHaveLength(1);
    expect(definition.changedColumns[0]?.column).toBe('title');
    expect(definition.changedColumns[0]?.typeChanged).toEqual({
      from: { logicalType: 'varchar', maxLength: 50, numericPrecision: null, numericScale: null },
      to: { logicalType: 'varchar', maxLength: 100, numericPrecision: null, numericScale: null },
    });

    // The other half of the claim, asserted rather than assumed.
    const structural = diffModels(model([before]), model([after]));
    expect(structural.changedTables['public.articles']).toBeUndefined();
  });

  it('reports a decimal precision change', () => {
    const a = tbl({ name: 't', columns: [col({ name: 'amt', logicalType: 'decimal', numericPrecision: 10, numericScale: 2 })] });
    const b = tbl({ name: 't', columns: [col({ name: 'amt', logicalType: 'decimal', numericPrecision: 12, numericScale: 2 })] });
    expect(diffTableDefinitions(a, b).changedColumns[0]?.typeChanged?.to.numericPrecision).toBe(12);
  });

  it('reports a default change', () => {
    const a = tbl({ name: 't', columns: [col({ name: 'n', logicalType: 'integer', default: { kind: 'literal', text: '0' } })] });
    const b = tbl({ name: 't', columns: [col({ name: 'n', logicalType: 'integer', default: { kind: 'literal', text: '1' } })] });
    expect(diffTableDefinitions(a, b).changedColumns[0]?.defaultChanged).toEqual({
      from: 'literal:0',
      to: 'literal:1',
    });
  });

  it('distinguishes a structural default kind from an equivalent expression', () => {
    const a = tbl({ name: 't', columns: [col({ name: 'at', logicalType: 'timestamptz', default: { kind: 'now' } })] });
    const b = tbl({
      name: 't',
      columns: [col({ name: 'at', logicalType: 'timestamptz', default: { kind: 'expression', text: 'now()' } })],
    });
    expect(diffTableDefinitions(a, b).changedColumns[0]?.defaultChanged).toEqual({
      from: 'now',
      to: 'expression:now()',
    });
  });

  it('reports which columns the primary key moved between, not a boolean', () => {
    const a = tbl({ name: 't', primaryKey: ['id'] });
    const b = tbl({ name: 't', primaryKey: ['id', 'tenant_id'] });
    expect(diffTableDefinitions(a, b).pkChanged).toEqual({ from: ['id'], to: ['id', 'tenant_id'] });
  });

  it('reports unique, check and index changes', () => {
    const a = tbl({ name: 't' });
    const b = tbl({
      name: 't',
      uniques: [{ name: 'u_slug', columns: ['slug'] }],
      checks: [{ name: null, expression: "state in ('a')" }],
      indexes: [{ name: 'i_x', columns: ['x'], expression: null, unique: false, primary: false, method: null, partial: false }],
    });
    const d = diffTableDefinitions(a, b);
    expect(d.uniquesAdded).toHaveLength(1);
    expect(d.checksAdded).toHaveLength(1);
    expect(d.indexesAdded).toHaveLength(1);
    expect(d.uniquesRemoved).toHaveLength(0);
  });

  it('ignores the primary-key index — that is the PK’s business', () => {
    const a = tbl({
      name: 't',
      indexes: [{ name: 't_pkey', columns: ['id'], expression: null, unique: true, primary: true, method: null, partial: false }],
    });
    const b = tbl({ name: 't', indexes: [] });
    expect(diffTableDefinitions(a, b).indexesRemoved).toHaveLength(0);
  });

  it('reports an FK referential-action change as a change, not an add plus a remove', () => {
    const from = { tableId: 'public.orders', columns: ['customer_id'] };
    const to = { tableId: 'public.customers', columns: ['id'] };
    const d = diffTableDefinitions(tbl({ name: 'orders' }), tbl({ name: 'orders' }), {
      actualFks: [rel({ from, to, onDelete: 'cascade' })],
      desiredFks: [rel({ from, to, onDelete: 'restrict' })],
    });
    expect(d.fksAdded).toHaveLength(0);
    expect(d.fksRemoved).toHaveLength(0);
    expect(d.fksActionsChanged).toHaveLength(1);
    expect(d.fksActionsChanged[0]?.to.onDelete).toBe('restrict');
  });

  it('carries the catalog constraint name through, so a DROP is addressable (35-T33)', () => {
    const from = { tableId: 'public.orders', columns: ['customer_id'] };
    const to = { tableId: 'public.customers', columns: ['id'] };
    const d = diffTableDefinitions(tbl({ name: 'orders' }), tbl({ name: 'orders' }), {
      actualFks: [rel({ from, to, constraintName: 'orders_customer_id_fkey' })],
      desiredFks: [],
    });
    expect(d.fksRemoved[0]?.constraintName).toBe('orders_customer_id_fkey');
  });

  it('is empty for identical definitions', () => {
    expect(isEmptyDefinitionDiff(diffTableDefinitions(before, before))).toBe(true);
    expect(isEmptyDefinitionDiff(diffTableDefinitions(before, after))).toBe(false);
  });
});

describe('applyRenames (35-T03)', () => {
  const customers = tbl({ name: 'customers' });
  const orders = tbl({
    name: 'orders',
    columns: [
      col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
      col({
        name: 'customer_id',
        logicalType: 'integer',
        references: { tableId: 'public.customers', column: 'id' },
      }),
    ],
  });
  const base = model(
    [customers, orders],
    [
      rel({
        from: { tableId: 'public.orders', columns: ['customer_id'] },
        to: { tableId: 'public.customers', columns: ['id'] },
      }),
    ],
  );

  it('makes the diff see a rename instead of a drop plus an add', () => {
    const { model: renamed, applied } = applyRenames(base, {
      tables: [{ from: 'public.customers', to: 'clients' }],
      columns: [],
    });
    expect(applied).toHaveLength(1);

    // The desired model's mirror points at the NEW name — the IR validates
    // referential integrity, so a fixture that forgot would fail to parse.
    const ordersAfter = tbl({
      name: 'orders',
      columns: [
        col({ name: 'id', logicalType: 'integer', isPrimaryKey: true, nullable: false }),
        col({
          name: 'customer_id',
          logicalType: 'integer',
          references: { tableId: 'public.clients', column: 'id' },
        }),
      ],
    });
    const desired = model([tbl({ name: 'clients' }), ordersAfter]);
    const d = diffModels(renamed, desired);
    // The whole point: no drop, no add.
    expect(d.removedTables).toEqual([]);
    expect(d.addedTables).toEqual([]);

    // …and without pre-application it reads as exactly the drop+add diff.js warns about.
    const naive = diffModels(base, desired);
    expect(naive.removedTables).toEqual(['public.customers']);
    expect(naive.addedTables).toEqual(['public.clients']);
  });

  it('rewrites relation endpoints, the derived id, and the per-column references mirror', () => {
    const { model: renamed } = applyRenames(base, {
      tables: [{ from: 'public.customers', to: 'clients' }],
      columns: [],
    });
    const relation = renamed.relations[0]!;
    expect(relation.to.tableId).toBe('public.clients');
    expect(relation.id).toContain('public.clients');
    expect(relation.id).not.toContain('public.customers');

    const fkColumn = renamed.tables
      .find((t) => t.name === 'orders')!
      .columns.find((c) => c.name === 'customer_id')!;
    expect(fkColumn.references).toEqual({ tableId: 'public.clients', column: 'id' });
  });

  it('renames a column and follows it into the primary key and the relation', () => {
    const { model: renamed, applied } = applyRenames(base, {
      tables: [],
      columns: [{ table: 'public.customers', from: 'id', to: 'customer_id' }],
    });
    expect(applied[0]).toMatchObject({ kind: 'column', from: 'id', to: 'customer_id' });
    const clients = renamed.tables.find((t) => t.name === 'customers')!;
    expect(clients.primaryKey).toEqual(['customer_id']);
    expect(renamed.relations[0]?.to.columns).toEqual(['customer_id']);
  });

  it('leaves CHECK expressions alone — a string substitution there would corrupt them', () => {
    const withCheck = model([
      tbl({ name: 'orders', checks: [{ name: null, expression: "status in ('id', 'shipped')" }] }),
    ]);
    const { model: renamed } = applyRenames(withCheck, {
      tables: [],
      columns: [{ table: 'public.orders', from: 'id', to: 'order_id' }],
    });
    expect(renamed.tables[0]?.checks[0]?.expression).toBe("status in ('id', 'shipped')");
  });

  it('is a no-op that returns the same model when nothing resolves', () => {
    const { model: renamed, applied } = applyRenames(base, {
      tables: [{ from: 'public.nope', to: 'x' }],
      columns: [],
    });
    expect(applied).toEqual([]);
    expect(renamed).toBe(base);
  });

  it('still type-checks as a DatabaseModel after the rewrite', () => {
    const { model: renamed } = applyRenames(base, {
      tables: [{ from: 'public.customers', to: 'clients' }],
      columns: [{ table: 'public.orders', from: 'customer_id', to: 'client_id' }],
    });
    expect(() => parseDatabaseModel(JSON.stringify(renamed))).not.toThrow();
  });
});
