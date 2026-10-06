// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A CUSTOMER IS TOLD WHEN A LEDGER SAYS NO: out of stock — with the
 * line, and how many are left only where the owner shows it — or a card
 * that was not accepted, always the one answer. Nothing else of a ledger
 * has a name on the public side: not which add-on, not which item, not why
 * a plan failed, not that the add-on could not be asked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostingRefusedError, ValidationFailedError } from '../src/errors.js';
import { forcedOut, publicLeft } from '../src/crud/ledger-write.js';
import { cardInputs, guessRung, treeRung, typesCard, writeRung } from '../src/routes/public/code-guesses.js';
import { cardMiss, publicLedgerRefusal, publicPostings } from '../src/routes/public/ledger-refusals.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const no = (details: Record<string, unknown>) => new PostingRefusedError('no', details as never);

describe('a ledger\'s refusal, as a customer hears it', () => {
  it('a stock ledger\'s own no is out of stock: the line when there is one, and never of what or how many', () => {
    const told = publicLedgerRefusal(no({ reason: 'out-of-stock', family: 'stock', ledger: 'stock', posting: 'sale', line: 2, path: ['lines', 2], left: '3.000', item: 'Sugar' }));
    expect(told).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: { path: ['lines', 2], child: 'lines', index: 2 } });
    expect(JSON.stringify(told)).not.toMatch(/Sugar|3\.000|sale|stock"/);
    // Any reason the add-on itself gives reads the same.
    for (const reason of ['expired', 'needs-batch']) expect(publicLedgerRefusal(no({ reason, family: 'stock' }))).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: {} });
  });

  it('how many are left is told only when the refusal carries what the owner chose to show', () => {
    const error = no({ reason: 'out-of-stock', family: 'stock', left: '3.000' });
    Object.defineProperty(error, 'publicLeft', { value: '3', enumerable: false });
    expect(publicLedgerRefusal(error)).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: { left: '3' } });
  });

  it('a value ledger\'s own no is one answer, whichever it was', () => {
    for (const reason of ['not-valid', 'inactive', 'void', 'expired', 'empty', 'used-up', 'over-limit', 'needs-customer', 'refund-over']) {
      expect(publicLedgerRefusal(no({ reason, family: 'value', left: '12.00', item: 'Card 4411' })), reason).toEqual({ code: 'PUBLIC_CARD_REFUSED', params: { reason: 'not-valid' } });
    }
  });

  it('everything else of a posting has no name; and what is not a posting is not this function\'s', () => {
    for (const reason of ['planner-failed', 'too-large', 'add-on-unavailable', 'receipt-open', 'one-at-a-time', 'hooked', 'guarded', 'mapped-changed', 'card-pays-card']) {
      expect(publicLedgerRefusal(no({ reason, family: 'stock', table: 'ledger_kit_entries', column: 'qty' })), reason).toEqual({ code: null });
    }
    // A ledger's reason with nothing to say which answer it is: no name.
    expect(publicLedgerRefusal(no({ reason: 'out-of-stock' }))).toEqual({ code: null });
    expect(publicLedgerRefusal(new ValidationFailedError('x', {}))).toBeNull();
    expect(publicLedgerRefusal(new Error('x'))).toBeNull();
  });

  it('a quote says of each ledger whether it would go through — refused, only what a save would say', () => {
    expect(publicPostings(undefined)).toBeUndefined();
    expect(publicPostings([{ ledger: 'stock' }])).toBeUndefined();
    expect(
      publicPostings([
        { ledger: 'stock', family: 'stock', quote: { state: 'ok' } },
        { ledger: 'stock', family: 'stock', publicLeft: '3', quote: { state: 'refused', reason: 'out-of-stock', line: 1, path: ['lines', 1], left: '3.000' } },
        { ledger: 'cards', family: 'value', quote: { state: 'refused', reason: 'empty', line: 0, left: '0.00' } },
        { ledger: 'stock', family: 'stock', quote: { state: 'refused', reason: 'planner-failed' } },
        { ledger: 'stock', family: 'stock', quote: { state: 'unavailable', reason: 'add-on-unavailable' } },
      ]),
    ).toEqual([
      { ledger: 'stock', state: 'ok' },
      { ledger: 'stock', state: 'refused', reason: 'out-of-stock', path: ['lines', 1], line: 1, left: '3' },
      { ledger: 'cards', state: 'refused', reason: 'not-valid' },
      { ledger: 'stock', state: 'refused' },
      { ledger: 'stock', state: 'unavailable' },
    ]);
  });

  it('a code typed into a lookup a posting hands to a ledger is a card guess; any other typed code is not', () => {
    const table = (postings: unknown[]) => ({ table: { postings, columns: [{ name: 'card_id', lookup: { from: 'card_code' } }, { name: 'promo_id', lookup: { from: 'promo_code' } }, { name: 'qty' }] } }) as never;
    const pays = table([{ id: 'card', map: { card: 'card_id', amount: 'qty' } }]);
    expect(typesCard(pays, { card_code: 'GIFT-1234' })).toBe(true);
    expect(typesCard(pays, { promo_code: 'SPRING' })).toBe(false);
    expect(typesCard(pays, { card_code: '  ' })).toBe(false);
    expect(typesCard(table([]), { card_code: 'GIFT-1234' })).toBe(false);
    expect([...cardInputs(pays)]).toEqual(['card_code']);
    expect([...cardInputs(table([]))]).toEqual([]);
  });

  it('a code that names no card is answered as a card that is not valid is: word for word, so neither says which codes are cards', () => {
    const cards = new Set(['card_code']);
    const found = publicLedgerRefusal(no({ reason: 'empty', family: 'value', left: '0.00', item: 'Card 4411' }));
    for (const reason of ['unknown', 'used-up', 'not-valid']) expect(cardMiss({ column: 'card_code', reason }, cards), reason).toEqual(found);
    // A discount code typed beside it keeps its own answer; so does any other refusal of the card's column.
    expect(cardMiss({ column: 'promo_code', reason: 'unknown' }, cards)).toBeNull();
    expect(cardMiss({ column: 'card_code', reason: 'too-long' }, cards)).toBeNull();
    expect(cardMiss({ reason: 'unknown' }, cards)).toBeNull();
    expect(cardMiss({ column: 'card_code', reason: 'unknown' }, undefined)).toBeNull();
    expect(cardMiss(null, cards)).toBeNull();
  });

  it('a write that types a card and a discount code is a guess on both counts; a junk card value buys no discount guesses', () => {
    const table = { table: { postings: [{ id: 'card', map: { card: 'card_id' } }], columns: [{ name: 'card_id', lookup: { from: 'card_code' } }, { name: 'promo_id', lookup: { from: 'promo_code' } }] } } as never;
    expect(writeRung(table, { promo_code: 'SPRING' })).toBe('code');
    expect(writeRung(table, { card_code: 'GC-1' })).toBe('card');
    expect(writeRung(table, { card_code: 'junk', promo_code: 'SPRING' })).toBe('both');
    expect(writeRung(table, { card_code: ' ', promo_code: 'SPRING' })).toBe('code');
    // Anywhere in a create with its rows: the code on the order, the card on a payment under it.
    const node = (values: Record<string, unknown>, children: unknown[] = []) => ({ target: { table }, values, children }) as never;
    expect(treeRung(node({ promo_code: 'SPRING' }, [node({ card_code: 'GC-1' })]))).toBe('both');
    expect(treeRung(node({}, [node({ card_code: 'GC-1' })]))).toBe('card');

    const calls: string[] = [];
    const ticket = (rung: string) => ({ keep: () => calls.push(`keep:${rung}`), giveBack: () => calls.push(`back:${rung}`) });
    const limiter = (spent: string | null) => ({ reserveGuess: (_key: string, _ip: string, _codes: readonly string[], rung = 'code') => (rung === spent ? { refused: { allowed: false } } : { ticket: ticket(rung) }), knownCodes: () => undefined }) as never;
    const request = () => ({ ip: '10.0.0.1' }) as never;
    // A miss is kept on both counts.
    let rung = guessRung(limiter(null), () => false);
    let asked = request();
    expect(rung.reserve(asked, 'key', ['a', 'b'], 'both')).toBeNull();
    rung.missed(asked);
    rung.settle(asked, { statusCode: 400 } as never);
    expect(calls.splice(0)).toEqual(['keep:card', 'keep:code']);
    // No miss: both handed back.
    asked = request();
    rung.reserve(asked, 'key', ['a', 'b'], 'both');
    rung.settle(asked, { statusCode: 201 } as never);
    expect(calls.splice(0)).toEqual(['back:card', 'back:code']);
    // The discount count spent: refused, and the card guess it had taken is handed back.
    rung = guessRung(limiter('code'), () => false);
    expect(rung.reserve(request(), 'key', ['a', 'b'], 'both')).toEqual({ allowed: false });
    expect(calls.splice(0)).toEqual(['back:card']);
  });

  it('what is left is never told as less than nothing', () => {
    const words = { showLeftBelow: { setting: 'show_below' } };
    expect(publicLeft({ show_below: 5 }, words, '3.000', 'low')).toBe('3');
    expect(publicLeft({ show_below: 5 }, words, '0.400', 'low')).toBe('0');
    expect(publicLeft({ show_below: 5 }, words, '-2.000', 'low')).toBeUndefined();
    expect(publicLeft({ show_below: 5 }, words, '3.000', 'out')).toBeUndefined();
  });

  it('a line a cap puts out says nothing of what the add-on worked out for a line it thought it had', () => {
    expect(forcedOut({ id: '7', state: 'low', left: '2.000', exact: '2.400', batch: 'B-12', expires: '2031-01-01', first: { item: 'Flour', unit: 'kg' }, after: '2031-02-01', soon: true, cause: 'stock' })).toEqual({ id: '7', state: 'out', after: '2031-02-01', soon: true, cause: 'stock' });
    expect(forcedOut({ id: '8', state: 'in', left: '40' })).toEqual({ id: '8', state: 'out' });
  });
});

describe.each(LEGS)('what a refusal carries for the public side — %s', (dialect, available) => {
  let w: LedgerWorld;
  const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { create: true } } };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { tallies: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL', postings: [TALLY] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (2, 'Sugar', 3, 0, 3, ${w.flag(false)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('left is told only under the owner\'s rule: with no setting nothing, below it the whole number, at it or above nothing', async () => {
    const short = () => refusal(w.create('tallies', { account_id: 2, qty: '50' }, GUEST));
    const shown = async () => publicLedgerRefusal(await short());
    // The owner set nothing: no figure.
    expect(await shown()).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: {} });
    // "Show how many are left below 5": 3 are left.
    await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = 5');
    expect(await shown()).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: { left: '3' } });
    // Below 3: three is not below it.
    await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = 3');
    expect(await shown()).toEqual({ code: 'PUBLIC_OUT_OF_STOCK', params: {} });
    // Staff are told the ledger's own figure and of what, whatever the setting.
    const staff = await short();
    expect(staff).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', family: 'stock', left: '3.000', item: 'Sugar' } });
    // …and what a customer may be shown never rides in what staff are answered.
    expect(JSON.stringify(staff.details)).not.toContain('publicLeft');
    await w.h.rows('UPDATE ledger_kit_settings SET show_left_below = NULL');
    void DESK;
  });
});
