// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table's `belongs` may go through a listing — "anyone listed for this deal
 * in deal members", "whoever covers its owner on the day". The listing's
 * columns are another table's, and a rename of one of them must follow in
 * every table that reads the listing: a way that names a column that is gone
 * reaches nobody.
 */
import { describe, expect, it } from 'vitest';

import { renamedInListing, renamedInRule } from '../src/schema-ddl/rename-repair.js';

const DEALS = {
  ways: [
    { column: 'owner_id', set: 'team' },
    { through: { table: 'main.crm_deal_members', link: 'deal_id', user: 'user_id' } },
    { through: { table: 'main.crm_covers', link: 'owner_id', on: 'owner_id', user: 'cover_id', from: 'starts_on', to: 'ends_on' } },
    { via: 'company_id' },
  ],
};

describe('a renamed column of a listing table', () => {
  it('is followed in the table that reads the listing: the link, the person, the dates', () => {
    const renamed = (table: string, from: string, to: string) => (renamedInListing(DEALS, table, from, to) as typeof DEALS).ways;
    expect(renamed('main.crm_deal_members', 'user_id', 'person_id')[1]).toEqual({ through: { table: 'main.crm_deal_members', link: 'deal_id', user: 'person_id' } });
    expect(renamed('main.crm_deal_members', 'deal_id', 'for_deal_id')[1]).toEqual({ through: { table: 'main.crm_deal_members', link: 'for_deal_id', user: 'user_id' } });
    expect(renamed('main.crm_covers', 'starts_on', 'from_day')[2]).toMatchObject({ through: { from: 'from_day', to: 'ends_on' } });
    expect(renamed('main.crm_covers', 'ends_on', 'to_day')[2]).toMatchObject({ through: { from: 'starts_on', to: 'to_day' } });
  });

  it('touches only the listing named: the same column name in another listing, and the table\'s own columns, stay', () => {
    // `owner_id` is the covers table's link AND the deal's own column (`on`, and the first way's): only the listing's moves.
    const ways = (renamedInListing(DEALS, 'main.crm_covers', 'owner_id', 'away_id') as typeof DEALS).ways;
    expect(ways[0]).toEqual({ column: 'owner_id', set: 'team' });
    expect(ways[2]).toMatchObject({ through: { link: 'away_id', on: 'owner_id' } });
    expect(ways[1]).toBe(DEALS.ways[1]);
    // Nothing named: the very same value, so nothing is written.
    expect(renamedInListing(DEALS, 'main.crm_covers', 'note', 'remark')).toBe(DEALS);
    expect(renamedInListing(DEALS, 'main.crm_other', 'user_id', 'x')).toBe(DEALS);
    expect(renamedInListing(null, 'main.crm_covers', 'a', 'b')).toBeNull();
  });

  it('leaves the table\'s own renames to the rule for them', () => {
    const own = renamedInRule('table.belongs', DEALS, 'owner_id', 'rep_id') as typeof DEALS;
    expect(own.ways[0]).toEqual({ column: 'rep_id', set: 'team' });
    expect(own.ways[2]).toMatchObject({ through: { link: 'owner_id', on: 'rep_id' } });
  });
});
