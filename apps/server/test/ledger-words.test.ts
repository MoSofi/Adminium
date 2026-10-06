// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT IS LEFT — asked of a ledger with nothing written.
 *
 * A page asks about many rows at once (a menu, a list). Each row asked
 * about is one line of quantity one; the add-on's reads run once and its
 * code is asked once, and one answer comes back for each row in the order
 * asked. A customer is told how many are left only under the owner's own
 * setting. An add-on that cannot answer is an error the caller decides
 * about — nothing is guessed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { planWords, publicLeft, WordsUnavailable } from '../src/crud/ledger-write.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

describe.each(LEGS)('what is left — %s', (dialect, available) => {
  let w: LedgerWorld;
  const ask = (keys: string[], runtime = w.runtime) => {
    const at = w.target('notes');
    return planWords(runtime, { view: at.view, db: at.db, addOn: 'ledger-kit', words: 'units-left', tableRef: 'accounts', keys, origin: 'public', now: new Date('2031-01-02T03:04:05.000Z') });
  };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { notes: { columns: 'body VARCHAR(20) NULL', postings: [] } });
    // Plenty, at its reorder level, and none.
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2), (2, 'Sugar', 2, 0, 2, ${w.flag(false)}, 2), (3, 'Salt', 0, 0, 0, ${w.flag(false)}, 1)`);
    for (let id = 10; id < 80; id += 1) await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (${String(id)}, 'Item ${String(id)}', 5, 0, 5, ${w.flag(false)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('one answer for each row asked about, in the order asked, and nothing written', async () => {
    const receipts = await w.count('ledger_kit_postings');
    expect(await ask(['3', '1', '2'])).toEqual([
      { id: '3', state: 'out', left: '0.000' },
      { id: '1', state: 'in', left: '10.000' },
      { id: '2', state: 'low', left: '2.000' },
    ]);
    expect(await ask([])).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
    expect(await w.count('ledger_kit_holds')).toBe(0);
  });

  it.skipIf(!available)('sixty rows are one question; more are not asked', async () => {
    const keys = Array.from({ length: 60 }, (_, index) => String(index + 10));
    const told = await ask(keys);
    expect(told.map((line) => line.id)).toEqual(keys);
    expect(told.every((line) => line.state === 'in')).toBe(true);
    await expect(ask([...keys, '70'])).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'too-many' } });
  });

  it.skipIf(!available)('an add-on that cannot answer throws: it does not guess', async () => {
    const at = w.target('notes');
    const base = { view: at.view, db: at.db, addOn: 'ledger-kit', tableRef: 'accounts', keys: ['1'], origin: 'public' as const, now: new Date() };
    // Its code is not loaded.
    await expect(planWords({ ...w.runtime, actionOf: () => null }, { ...base, words: 'units-left' })).rejects.toBeInstanceOf(WordsUnavailable);
    // Words it does not declare; a row it says nothing of; code that fails.
    await expect(planWords(w.runtime, { ...base, words: 'no-such-words' })).rejects.toBeInstanceOf(WordsUnavailable);
    await w.misbehave('throw');
    try {
      await expect(ask(['1'])).rejects.toBeInstanceOf(WordsUnavailable);
    } finally {
      await w.misbehave(null);
    }
    await w.misbehave('nothing');
    try {
      await expect(ask(['1'])).rejects.toBeInstanceOf(WordsUnavailable);
    } finally {
      await w.misbehave(null);
    }
  });
});

describe('how many are left, as a customer may be told', () => {
  const words = { showLeftBelow: { setting: 'show_left_below' } };
  it('only under the owner\'s setting, only below it, never when out', () => {
    expect(publicLeft({ show_left_below: 5 }, words, '3.000', 'low')).toBe('3');
    expect(publicLeft({ show_left_below: 5 }, words, '4.9', 'in')).toBe('4');
    // At the setting or above: not told.
    expect(publicLeft({ show_left_below: 5 }, words, '5.000', 'in')).toBeUndefined();
    expect(publicLeft({ show_left_below: 5 }, words, '12', 'in')).toBeUndefined();
    // The owner said nothing, or zero: never told.
    expect(publicLeft({ show_left_below: 0 }, words, '1', 'low')).toBeUndefined();
    expect(publicLeft({ show_left_below: null }, words, '1', 'low')).toBeUndefined();
    expect(publicLeft({}, words, '1', 'low')).toBeUndefined();
    expect(publicLeft({ show_left_below: 5 }, {}, '1', 'low')).toBeUndefined();
    expect(publicLeft({ show_left_below: 5 }, undefined, '1', 'low')).toBeUndefined();
    // Out is out: no figure.
    expect(publicLeft({ show_left_below: 5 }, words, '0', 'out')).toBeUndefined();
    expect(publicLeft({ show_left_below: 5 }, words, undefined, 'low')).toBeUndefined();
  });
});
