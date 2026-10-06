// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE CANNOT STAND ON WHAT ADMINIUM REWRITES BY ITSELF.
 *
 * Two statements change a row with no save of it: a copy that follows the
 * row it is copied from is rewritten when that row changes, and a place kept
 * for a waitlist is moved on when a claim takes it. Neither passes the guard
 * that keeps what an open round read, and neither posts. So a rule that
 * reads the one or fires on the other is refused where rules are judged —
 * an app's at install, an owner's as it is drawn, a file's as it is read.
 */
import { describe, expect, it } from 'vitest';

import { selfWrittenIssue } from '../src/ledgers/rules.js';

type Table = Parameters<typeof selfWrittenIssue>[1];

const INTO = { addOn: 'ledger-kit', ledger: 'units', action: 'use' };
const column = (name: string, follow?: boolean) => ({ name, ...(follow === undefined ? {} : { copy: { from: 'x', via: 'y', follow } }) });
const table = (over: Record<string, unknown> = {}): Table => ({ name: 'lines', columns: [column('item_id'), column('qty'), column('price', true), column('cost', false), column('order_id')], ...over }) as never;
const rule = (over: Record<string, unknown>) => ({ id: 'r', into: INTO, map: { account: 'item_id', quantity: 'qty' }, post: { on: { create: true } }, ...over }) as never;

describe('a rule cannot stand on what Adminium rewrites by itself', () => {
  it('refuses a column the rule reads that is a copy following its parent, wherever the rule reads it', () => {
    expect(selfWrittenIssue(rule({}), table(), undefined)).toBeNull();
    // A copy taken once is the row's own from then on.
    expect(selfWrittenIssue(rule({ map: { account: 'item_id', quantity: 'cost' } }), table(), undefined)).toBeNull();
    for (const over of [{ map: { account: 'item_id', quantity: 'price' } }, { multipliers: { quantity: 'price' } }, { heldUntil: 'price' }, { unlessSet: 'price' }, { only: { column: 'price', eq: 1 } }]) {
      expect(selfWrittenIssue(rule(over), table(), undefined), JSON.stringify(over)).toMatch(/"price" is a copy that follows/);
    }
    // Read from the row the lines hang under: that row's own copies.
    const order = table({ name: 'orders', columns: [column('due', true), column('status')] });
    expect(selfWrittenIssue(rule({ via: 'order_id', map: { account: 'item_id', quantity: { parent: 'due' } } }), table(), order)).toMatch(/"due" is a copy that follows/);
    expect(selfWrittenIssue(rule({ via: 'order_id', map: { account: 'item_id', quantity: { parent: 'status' } } }), table(), order)).toBeNull();
  });

  it('refuses a point on the state a kept place is moved to when it is claimed', () => {
    const kept = { capacityRules: [{ kind: 'parent', reserved: { states: ['returned'], releaseTo: 'resold' } }], states: { column: 'status' } };
    const tickets = table({ name: 'tickets', columns: [column('item_id'), column('qty'), column('status')], ...kept });
    expect(selfWrittenIssue(rule({ post: { on: { to: ['resold'] } } }), tickets, undefined)).toMatch(/"resold" is the state a place kept for a waitlist/);
    expect(selfWrittenIssue(rule({ reverse: { on: { column: 'status', in: ['resold'] } } }), tickets, undefined)).toMatch(/"resold"/);
    // Another state, another column, a table that keeps nothing back: free.
    expect(selfWrittenIssue(rule({ post: { on: { to: ['sold'] } } }), tickets, undefined)).toBeNull();
    expect(selfWrittenIssue(rule({ post: { on: { column: 'qty', in: ['resold'] } } }), tickets, undefined)).toBeNull();
    expect(selfWrittenIssue(rule({ post: { on: { to: ['resold'] } } }), table({ states: { column: 'status' } }), undefined)).toBeNull();
    // Under `via` a move is the parent's: its kept places, not the line's.
    expect(selfWrittenIssue(rule({ via: 'order_id', post: { on: { to: ['resold'] } } }), table(), tickets)).toMatch(/"resold"/);
    expect(selfWrittenIssue(rule({ via: 'order_id', post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['resold'], own: true } } }), table({ ...kept, columns: [column('item_id'), column('qty'), column('status'), column('order_id')] }), table({ name: 'orders' }))).toMatch(/"resold"/);
  });
});
