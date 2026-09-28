// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A child made through a row's own link (an extra added to the stay the
 * stay's own link opened): the create names the parent it is made under by
 * its link, and may write that link — the parent is proved reached when the
 * row is made. The validator says what the install and the public scope say:
 * the link is writable on a create-only entry, is required there, and is
 * never written by an entry that changes rows; nor is any other column that
 * points at the key's own person.
 */
import { describe, expect, it } from 'vitest';

import { columnOf, entryOf, guestHouse, issuesText, messages, tableOf, type Doc } from './orders-stays-fixture.js';

function withLinkExtras(entry: Partial<Doc> = {}): Doc {
  const m = guestHouse();
  (m['publicAccess'] as Doc[]).push({
    table: 'stay_extras',
    key: 'link',
    methods: ['GET', 'POST'],
    level: 'verified',
    visibleWith: { table: 'stays', via: 'stay_id' },
    select: ['id', 'stay_id', 'extra_id', 'amount'],
    writable: ['stay_id', 'extra_id'],
    ...entry,
  });
  return m;
}

describe("a child made through a row's own link", () => {
  it('names its parent by the link it writes', () => {
    expect(entryOf(withLinkExtras(), 'stays', 'GET', 'link')).toBeDefined();
    expect(messages(withLinkExtras())).toEqual([]);
  });

  it('must write the link a create names its parent by', () => {
    expect(issuesText(withLinkExtras({ writable: ['extra_id'] }))).toContain('this entry creates rows under "stays", so "stay_id" is writable: the parent a create names');
  });

  it('never writes the link on an entry that changes rows', () => {
    const text = issuesText(withLinkExtras({ methods: ['GET', 'POST', 'PATCH'] }));
    expect(text).toContain('"stay_extras.stay_id" points at the signed-in person\'s own table, so it is filled from the parent and never written publicly');
  });

  it("never writes another column pointing at the key's own person", () => {
    const m = withLinkExtras({ writable: ['stay_id', 'extra_id', 'first_stay_id'] });
    (tableOf(m, 'stay_extras')['columns'] as Doc[]).push({ ref: 'first_stay_id', type: 'fk', references: 'stays', nullable: true });
    expect(columnOf(m, 'stay_extras', 'first_stay_id')).toBeDefined();
    expect(issuesText(m)).toContain('"stay_extras.first_stay_id" points at the signed-in person\'s own table');
  });
});
