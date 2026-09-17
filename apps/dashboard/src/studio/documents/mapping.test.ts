// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The mapping editor's rules (steps 2–4).
 *
 * The page is a form; these are its decisions, and they are tested apart from
 * it because they are what a later change is most likely to get wrong — in
 * particular the difference between a slot nobody mapped and a slot somebody
 * typed a value into, which look identical on the screen and mean opposite
 * things in the stored profile.
 */
import { describe, expect, it } from 'vitest';

import { pick } from './api.js';
import {
  columnsForSlot,
  fromMapping,
  mayTypeValue,
  rankTables,
  tablesRead,
  toLiterals,
  toMapping,
  unboundRequiredSlots,
  type Bindings,
  type ColumnFacts,
  type TableFacts,
} from './mapping.js';

const columns: ColumnFacts[] = [
  { name: 'id', label: 'ID', logicalType: 'integer', nullable: false, primaryKey: true },
  { name: 'customer', label: 'Customer', logicalType: 'varchar', nullable: false },
  { name: 'total', label: 'Total', logicalType: 'decimal', semantic: 'money', nullable: false },
  { name: 'contact', label: 'Contact', logicalType: 'varchar', semantic: 'email', nullable: true },
  { name: 'raised_on', label: 'Raised', logicalType: 'timestamp', nullable: false },
];

describe('which columns a slot offers', () => {
  it('puts the semantically right column first WITHOUT hiding the rest', () => {
    /*
     * The editor has no opinion about the operator's data: a document draws
     * whatever somebody points at it, and refusing a `varchar` for a money
     * slot would be this page overruling them. What the tags buy is ORDER.
     */
    const money = columnsForSlot({ type: 'money' }, columns);
    expect(money.preferred.map((c) => c.name)).toEqual(['total']);
    expect(money.preferred.length + money.rest.length).toBe(columns.length);

    const email = columnsForSlot({ type: 'email' }, columns);
    expect(email.preferred.map((c) => c.name)).toEqual(['contact']);
  });

  it('prefers a timestamp for a date and a text column for text', () => {
    expect(columnsForSlot({ type: 'date' }, columns).preferred.map((c) => c.name)).toEqual([
      'raised_on',
    ]);
    expect(columnsForSlot({ type: 'text' }, columns).preferred.map((c) => c.name)).toEqual([
      'customer',
      'contact',
    ]);
  });

  it('offers everything, in some order, for a type it has no tag for', () => {
    const collection = columnsForSlot({ type: 'collection' }, columns);
    expect(collection.preferred).toEqual([]);
    expect(collection.rest).toHaveLength(columns.length);
  });
});

describe('which table to offer as the header', () => {
  it('ranks a money column and a child table up, and hides nothing', () => {
    const tables: TableFacts[] = [
      { id: 'public.notes', label: 'Notes', columns: [] },
      {
        id: 'public.orders',
        label: 'Orders',
        columns,
        children: [{ table: 'public.order_lines', column: 'order_id' }],
      },
      { id: 'public.quotes', label: 'Quotes', columns },
    ];
    const ranked = rankTables(tables).map((table) => table.id);
    expect(ranked[0]).toBe('public.orders');
    // A deployment whose documents come from a table with no money column is
    // unusual, not wrong — an editor that hid it would be unusable there.
    expect(ranked).toContain('public.notes');
    expect(ranked).toHaveLength(3);
  });
});

describe('what blocks a save', () => {
  const slots = [
    { id: 'customerName', label: {}, type: 'text' as const, required: true },
    { id: 'number', label: {}, type: 'text' as const, required: true, default: 'sequence' as const },
    { id: 'taxRate', label: {}, type: 'percent' as const, required: false },
  ];

  it('blocks on a required slot nobody bound', () => {
    expect(unboundRequiredSlots(slots, {})).toEqual(['customerName']);
  });

  it('does NOT block on a required slot the ENGINE fills', () => {
    // Getting this backwards would block every save on a document number
    // nobody has minted yet — which is all of them, at authoring time.
    expect(unboundRequiredSlots(slots, { customerName: { kind: 'column', column: 'customer' } }))
      .toEqual([]);
  });

  it('counts a typed literal as bound', () => {
    expect(unboundRequiredSlots(slots, { customerName: { kind: 'literal', value: 'Acme' } }))
      .toEqual([]);
  });
});

describe('unmapped and literal are different things', () => {
  const bindings: Bindings = {
    customerName: { kind: 'column', column: 'customer' },
    customerEmail: { kind: 'lookup', ref: 'customer_id', column: 'email' },
    taxRate: { kind: 'literal', value: '20' },
    discountRate: { kind: 'unmapped' },
    items: {
      kind: 'collection',
      table: 'public.order_lines',
      fkColumn: 'order_id',
      columns: { desc: 'description', qty: 'quantity', rate: 'unit_price' },
    },
  };

  it('puts only READ-FROM-A-COLUMN bindings in the mapping', () => {
    /*
     * `mapping` says which columns are read. A literal is read from nothing,
     * and an unmapped slot is the provider's business — for the invoices
     * provider an absent rate means no tax line at all (D20), which is the only
     * honest answer to a rate nobody entered.
     */
    expect(toMapping(bindings)).toEqual({
      customerName: { column: 'customer' },
      customerEmail: { ref: 'customer_id', column: 'email' },
      items: {
        collection: {
          table: 'public.order_lines',
          fkColumn: 'order_id',
          columns: { desc: 'description', qty: 'quantity', rate: 'unit_price' },
        },
      },
    });
  });

  it('keeps the typed value beside the mapping, not inside it', () => {
    expect(toLiterals(bindings)).toEqual({ taxRate: '20' });
  });

  it('round-trips a stored profile back into the editor’s shape', () => {
    const restored = fromMapping(toMapping(bindings), toLiterals(bindings));
    expect(restored.customerName).toEqual({ kind: 'column', column: 'customer' });
    expect(restored.customerEmail).toEqual({ kind: 'lookup', ref: 'customer_id', column: 'email' });
    expect(restored.taxRate).toEqual({ kind: 'literal', value: '20' });
    expect(restored.items).toEqual(bindings.items);
    // An unmapped slot round-trips as ABSENT, which is what it was.
    expect('discountRate' in restored).toBe(false);
  });
});

describe('which tables a profile reads', () => {
  it('names the header and every collection’s table', () => {
    // The same computation the SERVER makes (`documents/subject.ts`), restated
    // here because the editor needs it for a mapping nobody has saved yet.
    expect(
      tablesRead(
        {
          items: {
            kind: 'collection',
            table: 'public.order_lines',
            fkColumn: 'order_id',
            columns: {},
          },
        },
        'public.orders',
      ),
    ).toEqual(['public.orders', 'public.order_lines']);
  });

  it('does not repeat the header when a collection points back at it', () => {
    expect(
      tablesRead(
        { items: { kind: 'collection', table: 'public.orders', fkColumn: 'parent', columns: {} } },
        'public.orders',
      ),
    ).toEqual(['public.orders']);
  });
});

describe('the provider’s own words', () => {
  const label = { 'en-US': 'Invoice', 'de-DE': 'Rechnung', 'fr-FR': 'Facture' };

  it('picks the viewer’s locale', () => {
    expect(pick(label, 'de-DE', 'x')).toBe('Rechnung');
  });

  it('falls back along the LANGUAGE before falling back to English', () => {
    expect(pick(label, 'de-AT', 'x')).toBe('Rechnung');
    expect(pick(label, 'cs-CZ', 'x')).toBe('Invoice');
  });

  it('shows the id when a provider shipped an incomplete record', () => {
    // Reaching here means the provider failed its own conformance suite, so
    // showing the id is how somebody finds out — an empty row would look like
    // a rendering bug in this page.
    expect(pick(undefined, 'en-US', 'customerName')).toBe('customerName');
    expect(pick({}, 'en-US', 'customerName')).toBe('customerName');
  });
});

describe('which slots may be given a typed value', () => {
  it('offers it on an optional scalar', () => {
    expect(mayTypeValue({ type: 'percent', required: false })).toBe(true);
  });

  it('offers it on a slot the engine fills, which O26 asks for by name', () => {
    expect(mayTypeValue({ type: 'text', required: true, default: 'sequence' })).toBe(true);
  });

  it('does NOT offer it on a required slot with no default', () => {
    // A constant there makes every document from the mapping say the same
    // thing in the one field that was supposed to tell them apart.
    expect(mayTypeValue({ type: 'text', required: true })).toBe(false);
  });

  it('does NOT offer it on a collection — a typed value is not a list', () => {
    expect(mayTypeValue({ type: 'collection', required: false })).toBe(false);
  });
});
