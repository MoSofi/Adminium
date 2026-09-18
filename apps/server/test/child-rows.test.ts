// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The line-items field's pure half: which relation may be one, and what a save
 * has to do about the rows that are already there.
 *
 * The route's half — grants, hooks, the transaction — is proved on real
 * engines in `crud-child-rows-dialects.test.ts`. What is worth proving HERE is
 * the diff, because every one of its mistakes is silent: a row dropped instead
 * of changed, a row written twice, a removal nobody asked for.
 */
import { describe, expect, it } from 'vitest';

import { diffChildRows } from '../src/crud/child-rows.js';

const KEY = ['id'];

describe('what a save does to the rows that are there', () => {
  it('adds a row with no key', () => {
    const diff = diffChildRows(KEY, [], [{ values: { item: 'Cable', qty: 2 } }]);
    expect(diff.added).toEqual([{ item: 'Cable', qty: 2 }]);
    expect(diff.changed).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('changes a row that exists, rather than replacing it', () => {
    const diff = diffChildRows(
      KEY,
      [{ id: 7, item: 'Cable', qty: 1 }],
      [{ key: { id: 7 }, values: { qty: 3 } }],
    );
    // Not a delete plus an insert: that burns the id, fires a delete hook for a
    // row nobody touched, and loses whatever a default filled.
    expect(diff.changed).toEqual([{ key: { id: 7 }, values: { qty: 3 } }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('removes the rows the request left out', () => {
    const diff = diffChildRows(
      KEY,
      [
        { id: 7, item: 'Cable' },
        { id: 8, item: 'Case' },
      ],
      [{ key: { id: 7 }, values: { item: 'Cable' } }],
    );
    expect(diff.removed).toEqual([{ id: 8 }]);
    expect(diff.changed).toHaveLength(1);
  });

  it('touches nothing when the request is what is already there', () => {
    const rows = [{ id: 7, item: 'Cable' }];
    const diff = diffChildRows(KEY, rows, [{ key: { id: 7 }, values: { item: 'Cable' } }]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // One change, which the route will see is a no-op write rather than a
    // deletion — the important claim is that nothing is REMOVED.
    expect(diff.changed).toHaveLength(1);
  });

  it('compares a key by value, not by identity', () => {
    // A driver answers integers; a JSON request carries strings. Reading them
    // as different rows would delete every line on every save.
    const diff = diffChildRows(KEY, [{ id: 7 }], [{ key: { id: '7' }, values: { qty: 1 } }]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toHaveLength(1);
  });

  it('keeps a composite key together', () => {
    const composite = ['invoice_id', 'line'];
    const diff = diffChildRows(
      composite,
      [
        { invoice_id: 1, line: 1 },
        { invoice_id: 1, line: 2 },
      ],
      [{ key: { invoice_id: 1, line: 2 }, values: { qty: 9 } }],
    );
    expect(diff.removed).toEqual([{ invoice_id: 1, line: 1 }]);
    expect(diff.changed[0]?.key).toEqual({ invoice_id: 1, line: 2 });
  });

  it('adds a row whose key nothing holds, keeping the key', () => {
    // The database decides whether a key may be reused; refusing on its behalf
    // would refuse writes that work.
    const diff = diffChildRows(KEY, [], [{ key: { id: 12 }, values: { item: 'Case' } }]);
    expect(diff.added).toEqual([{ id: 12, item: 'Case' }]);
  });

  it('empties the list when the request holds nothing', () => {
    const diff = diffChildRows(KEY, [{ id: 7 }, { id: 8 }], []);
    expect(diff.removed).toEqual([{ id: 7 }, { id: 8 }]);
  });
});
