// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `crud/links.ts` — which table, which columns, which way round, and whether
 * this relation may be a field at all.
 *
 * Every refusal here is one the browser would otherwise meet as a broken
 * field: a hidden join table, a guess nobody trusts, a column the link write
 * would have to invent a value for. They are unit tests because each is a
 * decision about the MODEL, and building five databases to ask five questions
 * about a shape would test the introspector instead.
 */
import { describe, expect, it } from 'vitest';

import { applyClassification, parseDatabaseModel } from '@adminium/engine';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { diffLinks, linkableRelations, resolveLink, sameKeys } from '../src/crud/links.js';

interface TableInput {
  name: string;
  columns: { name: string; logicalType?: string; nullable?: boolean; isPrimaryKey?: boolean; default?: { kind: string; text?: string } | null }[];
  primaryKey?: string[];
  excluded?: boolean;
  system?: boolean;
}

const M2M = {
  id: 'm2m',
  kind: 'inferred-join-table' as const,
  cardinality: 'many-to-many' as const,
  from: { tableId: 'public.bookings', columns: ['id'] },
  to: { tableId: 'public.services', columns: ['id'] },
  through: {
    tableId: 'public.booking_services',
    fromColumns: ['booking_id'],
    toColumns: ['service_id'],
  },
  confidence: 0.9,
};

function viewOf(tables: TableInput[], relations: Record<string, unknown>[] = [M2M]) {
  const model = applyClassification(
    parseDatabaseModel({
      dialect: 'postgres',
      name: 'clinic',
      defaultSchema: 'public',
      schemas: ['public'],
      enums: [],
      tables: tables.map((table) => ({
        schema: 'public',
        name: table.name,
        primaryKey: table.primaryKey ?? ['id'],
        columns: table.columns,
        ...(table.system === true ? { system: true } : {}),
      })),
      relations: relations as never,
    }),
  );
  // `excluded` is an override, the same way Studio sets it.
  const overrides = tables
    .filter((table) => table.excluded === true)
    .map((table, index) => ({
      id: `ovr_${String(index)}`,
      status: 'active',
      op: 'table.exclude',
      tableName: `public.${table.name}`,
      columnName: null,
      value: { excluded: true },
    }));
  return new SnapshotView('conn_1', applyOverrides(model, overrides as never));
}

const KEY = { name: 'id', logicalType: 'integer', nullable: false, isPrimaryKey: true };

const TABLES: TableInput[] = [
  { name: 'bookings', columns: [KEY, { name: 'who', logicalType: 'varchar', nullable: false }] },
  { name: 'services', columns: [KEY, { name: 'name', logicalType: 'varchar', nullable: false }] },
  {
    name: 'booking_services',
    columns: [
      { name: 'booking_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
      { name: 'service_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
    ],
    primaryKey: ['booking_id', 'service_id'],
  },
];

describe('resolving a link', () => {
  it('reads the same relation from either side, with the columns swapped', () => {
    const view = viewOf(TABLES);
    const forward = resolveLink(view, view.table('public.bookings'), 'm2m');
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    expect(forward.link.ownColumn).toBe('booking_id');
    expect(forward.link.targetColumn).toBe('service_id');
    expect(forward.link.target.id).toBe('public.services');

    // The SAME relation, edited from the other table. Read the pair backwards
    // and the field writes correct-looking rows into the wrong column.
    const backward = resolveLink(view, view.table('public.services'), 'm2m');
    expect(backward.ok).toBe(true);
    if (!backward.ok) return;
    expect(backward.link.ownColumn).toBe('service_id');
    expect(backward.link.targetColumn).toBe('booking_id');
    expect(backward.link.target.id).toBe('public.bookings');
  });

  it('works when the join table is HIDDEN, which is the tidy case', () => {
    /*
     * `SnapshotView` skips excluded tables, so a relation field would otherwise
     * break on exactly the schemas somebody had kept neat.
     */
    const view = viewOf(TABLES.map((t) => (t.name === 'booking_services' ? { ...t, excluded: true } : t)));
    expect(() => view.table('public.booking_services')).toThrow();
    const resolved = resolveLink(view, view.table('public.bookings'), 'm2m');
    expect(resolved.ok).toBe(true);
  });

  it('refuses a system join table, whatever the relation says', () => {
    const view = viewOf(
      TABLES.map((t) => (t.name === 'booking_services' ? { ...t, system: true } : t)),
    );
    const resolved = resolveLink(view, view.table('public.bookings'), 'm2m');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal.reason).toMatch(/may write to/);
  });

  it('refuses a guess nothing else trusts', () => {
    const view = viewOf(TABLES, [{ ...M2M, confidence: 0.7 }]);
    const resolved = resolveLink(view, view.table('public.bookings'), 'm2m');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal.reason).toMatch(/not sure enough/);
  });

  it('refuses a join table carrying a column nobody fills, and names it', () => {
    const view = viewOf(
      TABLES.map((t) =>
        t.name === 'booking_services'
          ? { ...t, columns: [...t.columns, { name: 'note', logicalType: 'varchar', nullable: false }] }
          : t,
      ),
    );
    const resolved = resolveLink(view, view.table('public.bookings'), 'm2m');
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.refusal.reason).toMatch(/booking_services\.note/);
  });

  it('accepts one whose extra column has a default', () => {
    // A framework's join table with `created_at DEFAULT now()` is the common
    // case, and refusing it would rule out most of them.
    const view = viewOf(
      TABLES.map((t) =>
        t.name === 'booking_services'
          ? {
              ...t,
              columns: [
                ...t.columns,
                { name: 'created_at', logicalType: 'timestamptz', nullable: false, default: { kind: 'expression', text: 'now()' } },
              ],
            }
          : t,
      ),
    );
    expect(resolveLink(view, view.table('public.bookings'), 'm2m').ok).toBe(true);
  });

  it('refuses a relation that does not touch this table, and one that is a plain FK', () => {
    const view = viewOf(TABLES, [
      M2M,
      {
        id: 'fk',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'public.booking_services', columns: ['booking_id'] },
        to: { tableId: 'public.bookings', columns: ['id'] },
        through: null,
        confidence: 1,
      },
    ]);
    const plain = resolveLink(view, view.table('public.bookings'), 'fk');
    expect(plain.ok).toBe(false);
    if (plain.ok) return;
    expect(plain.refusal.reason).toMatch(/plain foreign key/);
    const elsewhere = resolveLink(view, view.table('public.services'), 'nothing');
    expect(elsewhere.ok).toBe(false);
  });

  it('lists the relations a table can offer', () => {
    const view = viewOf(TABLES);
    expect(linkableRelations(view, view.table('public.bookings')).map((link) => link.relationId)).toEqual(['m2m']);
    // A table with no link relation offers none, rather than throwing.
    expect(linkableRelations(view, view.table('public.booking_services'))).toEqual([]);
  });
});

describe('the diff', () => {
  it('adds what is new and removes what is gone, comparing keys as strings', () => {
    // A bigint key arrives as "12" and must not read as a different link from
    // the 12 already stored.
    expect(diffLinks([12, 13], ['12', '14'])).toEqual({ add: ['14'], remove: ['13'] });
    expect(diffLinks([], ['1', '1'])).toEqual({ add: ['1'], remove: [] });
    expect(diffLinks(['1'], [])).toEqual({ add: [], remove: ['1'] });
  });

  it('compares sets for the undo conflict check', () => {
    expect(sameKeys(['1', '2'], ['2', '1'])).toBe(true);
    expect(sameKeys(['1'], ['1', '2'])).toBe(false);
    expect(sameKeys([], [])).toBe(true);
  });
});
