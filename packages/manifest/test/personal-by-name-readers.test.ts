// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A formula, a copy or a stamp's copy that reads personal data lands it only
 * in a column kept the same way, and "personal" is told as the install tells
 * it: marked `personal: true`, or guessed by its name (an address, a guest's
 * first and last name beside one). Told by the mark alone, a join over a
 * guest's names into an unmarked column passed the check, and the install then
 * skipped the rule, so the column stayed empty on every row.
 */
import { describe, expect, it } from 'vitest';

import { columnOf, guestHouse, issuesText, tableOf, type Doc } from './orders-stays-fixture.js';

function issues(change: (m: Doc) => void): string {
  const m = guestHouse();
  change(m);
  return issuesText(m);
}
const rules = (m: Doc, table: string, column: string) => (columnOf(m, table, column)['rules'] ??= {}) as Doc;
const addColumn = (m: Doc, table: string, column: Doc) => (tableOf(m, table)['columns'] as Doc[]).push(column);

describe('personal data read by name', () => {
  it('refuses a join over names guessed personal into a column that is not marked', () => {
    const text = issues((m) => delete rules(m, 'stays', 'guest_name')['personal']);
    expect(text).toContain('"stays.first_name" is personal data, so no formula reads it');
    expect(text).toContain('"stays.last_name" is personal data, so no formula reads it');
  });

  it('takes the same join into a column marked personal, or over names marked not personal', () => {
    expect(issues(() => undefined)).not.toContain('personal data');
    expect(
      issues((m) => {
        delete rules(m, 'stays', 'guest_name')['personal'];
        rules(m, 'stays', 'first_name')['personal'] = false;
        rules(m, 'stays', 'last_name')['personal'] = false;
      }),
    ).not.toContain('personal data');
  });

  it('refuses a copy of an address into a column that is not kept alike', () => {
    const copied = (ref: string, more: Doc = {}) => (m: Doc) =>
      addColumn(m, 'stays', { ref, type: 'text', maxLength: 254, nullable: true, rules: { copy: { via: 'customer_id', from: 'email' }, ...more } });
    expect(issues(copied('reached_at'))).toContain('"guests.email" is personal data, so no column copies it');
    expect(issues(copied('reached_at', { personal: true }))).not.toContain('personal data');
    // A column whose own name reads as personal is kept alike without a mark.
    expect(issues(copied('guest_email'))).not.toContain('personal data');
  });

  it("refuses a stamp that copies a row's address into a column that is not kept alike", () => {
    const stamped = (more: Doc = {}) => (m: Doc) =>
      addColumn(m, 'stays', { ref: 'booked_by', type: 'text', maxLength: 254, nullable: true, rules: { stamp: { set: { copy: 'email' }, on: 'create' }, ...more } });
    expect(issues(stamped())).toContain('"stays.email" is personal data, so no column copies it');
    expect(issues(stamped({ personal: true }))).not.toContain('personal data');
  });
});
