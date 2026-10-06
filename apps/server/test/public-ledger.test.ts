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
import { typesCard } from '../src/routes/public/code-guesses.js';
import { publicLedgerRefusal, publicPostings } from '../src/routes/public/ledger-refusals.js';
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
