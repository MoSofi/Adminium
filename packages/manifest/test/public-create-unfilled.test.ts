// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's create that leaves out a column its table cannot store empty is
 * refused by the database, and the guest is told "That write was refused."
 * naming no column — so the check says it of the entry, with the column, while
 * the app is being built. Found building a shop from a website template: the
 * per-column "will be required" warning did not say which create it was about.
 */
import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';
import { boxOffice, entryOf, guestHouse, issuesText, kitchen, tableOf, type Doc } from './orders-stays-fixture.js';

const create = (m: Doc) => entryOf(m, m['key'] === 'guesthouse' ? 'stays' : 'orders', 'POST');

describe('a guest\'s create that leaves out a column the table cannot store empty', () => {
  const warned = (m: Doc) => {
    const result = validateManifest(m);
    expect(result.ok, issuesText(m)).toBe(true);
    return result.warnings.filter((warning) => warning.message.includes('this create')).map((warning) => `${warning.path}: ${warning.message}`);
  };
  const at = (m: Doc) => `publicAccess.${String((m['publicAccess'] as Doc[]).indexOf(create(m)))}`;
  const required = (m: Doc, ref: string) => (tableOf(m, 'orders')['columns'] as Doc[]).push({ ref, type: 'text', maxLength: 10 });

  it('is said of none of the three shapes', () => {
    for (const m of [kitchen(), boxOffice(), guestHouse()]) expect(warned(m)).toEqual([]);
  });

  it('names the entry that neither writes nor fills it: every create through it is refused', () => {
    const m = kitchen();
    required(m, 'table_no');
    expect(warned(m)).toEqual([
      `${at(m)}: "orders.table_no" cannot be empty, and this create neither writes it nor fills it, so every guest's create through it is refused ("That write was refused.", naming no column): make it writable, give it a default here or on the column, or make it nullable`,
    ]);
    // Filled by the entry itself: nothing to say.
    create(m)['defaults'] = { table_no: 'counter' };
    expect(warned(m)).toEqual([]);
  });

  it('names one the guest may write that the entry does not ask for', () => {
    const m = kitchen();
    required(m, 'pager');
    create(m)['writable'] = [...(create(m)['writable'] as string[]), 'pager'];
    expect(warned(m)).toEqual([
      `${at(m)}: "orders.pager" cannot be empty, and this create does not ask for it, so a guest who leaves it out is refused without being told which column: list it in requires, and the guest is told it is missing`,
    ]);
    create(m)['requires'] = [...((create(m)['requires'] as string[] | undefined) ?? []), 'pager'];
    expect(warned(m)).toEqual([]);
  });

  it('names a child row\'s column too, and never the link to its parent', () => {
    const m = kitchen();
    (tableOf(m, 'order_items')['columns'] as Doc[]).push({ ref: 'seat', type: 'text', maxLength: 4 });
    expect(warned(m)).toEqual([expect.stringContaining(`${at(m)}.children.order_items: "order_items.seat" cannot be empty, and this create neither writes it nor fills it`)]);
  });
});
