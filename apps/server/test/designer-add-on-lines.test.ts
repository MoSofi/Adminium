// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A DESIGNER MODEL IS TOLD AN ADD-ON OFFERS.
 *
 * A shape an app builds tables on, a shape added to tables the app already
 * has, and a ledger its rows post into: each is said in the add-on's own
 * names, read from its manifest, so the model never has to remember one.
 */
import { linkInputTable, type LedgerAction } from '@adminium/manifest';
import { describe, expect, it } from 'vitest';

import { actionInWords, hostActions, declaredLedgers, keyColumnOf, ledgersOf, shapesOf } from '../src/designer/add-on-lines.js';
import { buildsOnInWords } from '../src/designer/tools.js';

const read = (as: string, table: string, column: string, from: string | string[]) => ({ as, table, by: [{ column, from }] });
const action = (inputs: Record<string, string>, reads: unknown[], more: Record<string, unknown> = {}) => ({ inputs, phases: ['post', 'reverse'], reads, locks: [{ read: 'items', column: 'id', table: 'items' }], ...more });

/** An add-on that keeps stock: two actions for an app's rows, one for its own receipts. */
const stockKit = {
  kind: 'add-on',
  key: 'stock-kit',
  requiredSchema: {
    tables: [
      { ref: 'items', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
      { ref: 'places', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
      { ref: 'links', columns: [{ ref: 'id', type: 'int', role: 'pk' }] },
      { ref: 'po_lines', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'po_id', type: 'int' }] },
    ],
  },
  addOn: {
    shapes: [
      { name: 'invoice', version: 1, parts: { invoice: { columns: [] }, lines: { columns: [] } } },
      { name: 'discountable', version: 1, parts: { order: { columns: [], adjust: {} } } },
      { name: 'card-sale', version: 1, parts: { lines: { columns: [], postings: [] } } },
    ],
    words: [{ id: 'item', ledger: 'stock', action: 'use-item', input: 'item' }],
    ledgers: [
      {
        id: 'stock',
        receipts: 'postings',
        refusal: 'stock',
        writes: {},
        actions: {
          'use-item': action({ item: 'link', quantity: 'number', place: 'link?', batch: 'link?', note: 'text?' }, [read('items', 'items', 'id', 'input.item'), read('places', 'places', 'id', ['input.place', 'setting.default_place_id'])]),
          hold: action({ what: 'rowRef', quantity: 'number', place: 'link?' }, [read('links', 'links', 'source_row', 'input.what.row')], { holds: true }),
          receive: action({ item: 'link', quantity: 'number', cost: 'decimal', po: 'link?' }, [read('items', 'items', 'id', 'input.item'), read('order_lines', 'po_lines', 'po_id', 'input.po')]),
        },
      },
    ],
  },
};

describe('what an add-on offers, as a model reads it', () => {
  const ledger = declaredLedgers(stockKit)[0]!;
  const keyOf = keyColumnOf(stockKit);

  it('a link input names the table it is a row of, by the read keyed on that table\'s own key', () => {
    const use = ledger.actions['use-item'] as LedgerAction;
    expect(linkInputTable(use, 'item', keyOf)).toBe('items');
    // Fed together with a setting: still that table.
    expect(linkInputTable(use, 'place', keyOf)).toBe('places');
    // No read says what a batch is a row of.
    expect(linkInputTable(use, 'batch', keyOf)).toBeNull();
    // Not a link at all.
    expect(linkInputTable(use, 'quantity', keyOf)).toBeNull();
    // Read by a column that is not the table's key: the input is an order, not an order line.
    expect(linkInputTable(ledger.actions['receive'] as LedgerAction, 'po', keyOf)).toBeNull();
  });

  it('the actions for an app\'s rows are the ones that take the row, and the ones stock words ask', () => {
    expect(hostActions(stockKit, ledger)).toEqual(['use-item', 'hold']);
    // A ledger that marks none so is given whole.
    expect(hostActions({ addOn: {} }, { ...ledger, actions: { receive: ledger.actions['receive']! } })).toEqual(['receive']);
  });

  it('an action is said with what it needs, what it takes besides, and that it holds', () => {
    expect(actionInWords(stockKit, 'use-item', ledger.actions['use-item'] as LedgerAction)).toBe('use-item (item: link to items, quantity: number; optional place, batch, note)');
    expect(actionInWords(stockKit, 'hold', ledger.actions['hold'] as LedgerAction)).toBe('hold (what: your row, or a link column to one, quantity: number; optional place; holds until a time you give)');
    expect(ledgersOf(stockKit)).toEqual(['stock — use-item (item: link to items, quantity: number; optional place, batch, note), hold (what: your row, or a link column to one, quantity: number; optional place; holds until a time you give)']);
    expect(ledgersOf({ kind: 'add-on', addOn: {} })).toEqual([]);
    expect(ledgersOf(null)).toEqual([]);
  });

  it('a shape whose part carries a rule is added to the app\'s own tables; the others are built whole', () => {
    expect(shapesOf(stockKit)).toEqual([
      { name: 'invoice@1', how: 'built-on' },
      { name: 'discountable@1', how: 'spelled-out' },
      { name: 'card-sale@1', how: 'spelled-out' },
    ]);
  });

  it('the line of an add-on ends with each way an app builds on it, and with nothing for one that offers none', () => {
    expect(buildsOnInWords({ shapes: shapesOf(stockKit), ledgers: ['stock — use-item (item: link to items)'] })).toBe(
      ' Shapes for build_on_shape: invoice@1. Shapes for build_on_shape, added to your own tables: discountable@1, card-sale@1. Ledgers for post_to_ledger: stock — use-item (item: link to items).',
    );
    expect(buildsOnInWords({})).toBe('');
    expect(buildsOnInWords({ shapes: [{ name: 'invoice@1', how: 'built-on' }] })).toBe(' Shapes for build_on_shape: invoice@1.');
  });
});
