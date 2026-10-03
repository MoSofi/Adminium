// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Anyone adds through one entry, anyone reads through another: the same hole
 * as one entry holding both, and refused the same (plan 65, R4: a model,
 * refused a claim four times, published every order instead).
 */
import { describe, expect, it } from 'vitest';

import { addAndReadRefusal, anonymousAddAndRead, openToAnyone } from '../src/apps/anonymous-access.js';

type Entry = Parameters<typeof openToAnyone>[0];
const entry = (over: Record<string, unknown>): Entry => ({ table: 'orders', methods: ['GET'], ...over }) as Entry;

describe('an anonymous add and an anonymous read of one table', () => {
  it('is found across entries, on the same key, and names the reading entry', () => {
    const add = entry({ methods: ['POST'], writable: ['name'] });
    expect(anonymousAddAndRead([entry({ table: 'cakes' }), add, entry({})])).toEqual([2]);
    // Another table, another key, or a read behind a claim, a sign-in or a parent row: not this hole.
    expect(anonymousAddAndRead([add, entry({ table: 'cakes' })])).toEqual([]);
    expect(anonymousAddAndRead([add, entry({ key: 'kiosk' })])).toEqual([]);
    expect(anonymousAddAndRead([add, entry({ claim: { match: ['code', 'email'] } })])).toEqual([]);
    expect(anonymousAddAndRead([add, entry({ claimedBy: { table: 'people', column: 'person_id' } })])).toEqual([]);
    expect(anonymousAddAndRead([add, entry({ visibleWith: { table: 'orders', via: 'order_id' } })])).toEqual([]);
    expect(anonymousAddAndRead([add, entry({ level: 'verified' })])).toEqual([]);
    // One entry holding both is refused where it always was, not twice.
    expect(anonymousAddAndRead([entry({ methods: ['GET', 'POST'] })])).toEqual([]);
    // An add behind a sign-in leaves the read alone.
    expect(anonymousAddAndRead([entry({ methods: ['POST'], claimedBy: { table: 'people', column: 'person_id' } }), entry({})])).toEqual([]);
  });

  it('says what to do instead', () => {
    expect(addAndReadRefusal('orders')).toContain('"claim": { "match": ["number", "email"] }');
    expect(addAndReadRefusal('orders')).toContain('client.claim(');
  });
});
