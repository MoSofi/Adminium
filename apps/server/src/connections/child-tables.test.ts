// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The collection picker's seed.
 *
 * Asked here rather than only through `/automations/sources`, because two of
 * the four exclusions cannot be built in that route's fixture at all: the
 * schema model refuses a relation naming a table it does not carry, so an edge
 * from a system or excluded table has to be assembled by hand.
 */
import { describe, expect, it } from 'vitest';

import { addressableTables, childTablesFor } from './child-tables.js';
import type { EffectiveModel } from './effective-schema.js';

function table(id: string, over: Record<string, unknown> = {}) {
  const [schema, name] = id.split('.');
  return {
    id,
    schema,
    name,
    kind: 'table',
    primaryKey: ['id'],
    columns: [],
    semantics: null,
    ...over,
  };
}

function relation(id: string, from: [string, string[]], to: [string, string[]]) {
  return {
    id,
    kind: 'declared-fk',
    cardinality: 'one-to-many',
    from: { tableId: from[0], columns: from[1] },
    to: { tableId: to[0], columns: to[1] },
  };
}

const MODEL = {
  defaultSchema: 'public',
  tables: [
    table('public.orders'),
    table('public.order_lines', { semantics: { role: 'line-items' } }),
    // One FK and no qty × rate numerics, so the classifier does NOT tag it —
    // and it still has to be pickable (client-portal case).
    table('public.invoice_items'),
    table('public.audit_ledger', { system: true }),
    table('public.archived_notes', { excluded: true }),
    // A view: no primary key of its own to be joined against.
    table('public.order_summary', { kind: 'view', primaryKey: [] }),
  ],
  relations: [
    relation('r1', ['public.order_lines', ['order_id']], ['public.orders', ['id']]),
    relation('r2', ['public.invoice_items', ['invoice_id']], ['public.orders', ['id']]),
    // Composite — one `fkColumn` cannot express it.
    relation('r3', ['public.order_lines', ['order_id', 'tenant']], ['public.orders', ['id', 'tenant']]),
    // Points at a unique column that is not the primary key.
    relation('r4', ['public.invoice_items', ['order_ref']], ['public.orders', ['reference']]),
    relation('r5', ['public.audit_ledger', ['order_id']], ['public.orders', ['id']]),
    relation('r6', ['public.archived_notes', ['order_id']], ['public.orders', ['id']]),
  ],
} as unknown as EffectiveModel;

const OFFERED = addressableTables(MODEL);

describe('the child tables a document mapping can actually read', () => {
  it('offers a plain single-column foreign key', () => {
    const edges = childTablesFor(MODEL, 'public.orders', OFFERED);
    expect(edges).toContainEqual({
      table: 'public.order_lines',
      column: 'order_id',
      lineItems: true,
    });
  });

  it('offers a child the CLASSIFIER did not tag, which is most of them', () => {
    // The `line-items` rule needs two foreign keys plus qty × rate numerics.
    // A picker that listed only tagged children would hide `invoice_items` —
    // the exact table names as the case that must be picked explicitly.
    const edges = childTablesFor(MODEL, 'public.orders', OFFERED);
    expect(edges).toContainEqual({
      table: 'public.invoice_items',
      column: 'invoice_id',
      lineItems: false,
    });
  });

  it('leaves out a COMPOSITE key, which one stored column cannot express', () => {
    const edges = childTablesFor(MODEL, 'public.orders', OFFERED);
    expect(edges.filter((edge) => edge.column === 'tenant')).toEqual([]);
    // …and the same child is still offered by its single-column edge, so the
    // filter drops an edge and never a table.
    expect(edges.some((edge) => edge.table === 'public.order_lines')).toBe(true);
  });

  it('leaves out a key pointing somewhere other than the primary key', () => {
    // `readSource` joins on `row[primaryKey[0]]`, so this edge would match
    // rows by a value the pipeline never reads — a collection full of the
    // wrong lines, which looks like it worked.
    const edges = childTablesFor(MODEL, 'public.orders', OFFERED);
    expect(edges.map((edge) => edge.column)).not.toContain('order_ref');
  });

  it('leaves out system and operator-excluded children', () => {
    const edges = childTablesFor(MODEL, 'public.orders', OFFERED);
    const tables = edges.map((edge) => edge.table);
    expect(tables).not.toContain('public.audit_ledger');
    expect(tables).not.toContain('public.archived_notes');
  });

  it('says nothing at all about a parent with no primary key', () => {
    // A view has no key to join children against. Returning [] rather than
    // every edge is the difference between an empty picker and a picker full
    // of choices that cannot work.
    expect(childTablesFor(MODEL, 'public.order_summary', OFFERED)).toEqual([]);
  });

  it('returns an empty list for a table nothing points at', () => {
    expect(childTablesFor(MODEL, 'public.order_lines', OFFERED)).toEqual([]);
  });
});
