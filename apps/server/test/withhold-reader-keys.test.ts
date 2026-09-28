// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Who a withhold's `when` holds for, by the key a reader reads through: a
 * key's own rules; for a reader of no key (an address no link goes to, a
 * document drawn for nobody), every rule said of a row's state for its
 * people and none said of whoever holds a row's own link. A document drawn
 * through a key is that key's, and one drawn for nobody is never shown on a
 * row's own link whose rule it did not meet.
 */
import { describe, expect, it } from 'vitest';

import { nobodysDocumentShownOn, withheldReaderMark } from '../src/documents/render.js';
import { collectWithholds } from '../src/public-api/withhold.js';

const UNPAID = { linked: [{ via: 'order_id', where: [{ column: 'status', eq: 'held' }] }] };
const PENDING = { where: [{ column: 'holder_customer_id', isNull: true }] };

describe('a withhold read by key', () => {
  const rules = collectWithholds([
    { table: 'main.tickets', withhold: { columns: ['code'], when: UNPAID, key: 'customer' } },
    { table: 'main.tickets', withhold: { columns: ['code'], when: PENDING, key: 'ticket', ownLink: true } },
    // The same rule again from a scope written out with no key: still the ticket link's own.
    { table: 'main.tickets', withhold: { columns: ['code'], when: PENDING } },
  ]);

  it("keeps a row's own link's rule its own, wherever it was said again", () => {
    expect(rules.get('tickets')).toEqual([
      { columns: ['code'], when: UNPAID, key: 'customer' },
      { columns: ['code'], when: PENDING, key: 'ticket', ownLink: true },
    ]);
  });

  it('marks a document by the key it was drawn through, the people\'s own key as before', () => {
    const reader = { table: 't.customers', value: 7 };
    expect(withheldReaderMark({ rules, reader, readerKey: 'customer' }, ['main.tickets'])).toBe('t.customers\u00007');
    expect(withheldReaderMark({ rules, reader: null, readerKey: 'link' }, ['main.tickets'])).toBe('\u0001link');
    expect(withheldReaderMark({ rules, reader: null }, ['main.tickets'])).toBe('');
    expect(withheldReaderMark({ rules, reader: null }, ['main.events'])).toBeNull();
  });

  it("shows a document drawn for nobody on any key but a row's own link that withholds what it draws", () => {
    expect(nobodysDocumentShownOn(rules, ['main.tickets'], 'customer')).toBe(true);
    expect(nobodysDocumentShownOn(rules, ['main.tickets'], 'link')).toBe(true);
    expect(nobodysDocumentShownOn(rules, ['main.tickets'], 'ticket')).toBe(false);
    expect(nobodysDocumentShownOn(rules, ['main.orders'], 'ticket')).toBe(true);
  });
});
