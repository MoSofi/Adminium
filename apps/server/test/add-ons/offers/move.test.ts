// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CARDS BROUGHT IN FROM A TILL.
 *
 * A till that kept its own gift cards hands them over once: each old card is
 * made here under its old code, and each old row of its history is posted,
 * oldest first, as the till marks it moved. The card comes in at its true
 * figure — below nothing too, if the till let it get there — sends no mail,
 * keeps no last day, and a row marked twice is brought in once. Here a table
 * of the owner's own stands for the till's history.
 *
 * NOBODY TYPES THE OLD CODE. No door a person saves through keeps a code they
 * give. The till's own row carries it, and the card's first old row makes the
 * card under it — only while the move's latch is on (`cards_paused`, which a
 * Super Admin alone sets), so a row slipped into the till's table on another
 * day mints nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
const n = (value: unknown): number => Number(value);
const money = (value: unknown): string => n(value).toFixed(2);
const TILL = 'till_card_rows';
/** The till's cards, by its own key for each: the code each has always had, as the till's row carries it. */
const CODES: Record<string, string> = { '7': 'GC-48219930', '8': 'gc-1111 2222-' };

describe.each(LEGS)('cards brought in from a till — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  const old = async (card: string, kind: string, amount: string, at: string, code: string | null = CODES[card] ?? null) => n((await w.h.rows(`INSERT INTO ${TILL} (card_id, card_code, kind, amount, at) VALUES ('${card}', ${code === null ? 'NULL' : `'${code}'`}, '${kind}', ${amount}, '${at}')`).then(async () => (await w.h.rows(`SELECT max(id) AS id FROM ${TILL}`))[0]!))['id']);
  /** The card Offers keeps for one of the till's, once a row of it has come in. */
  const cardOf = async (oldKey: string) => (await w.rowsOf('gift_cards', `moved_from = '${oldKey}'`))[0]!;
  const ledgerOf = async (card: unknown) => (await w.rowsOf('card_ledger', `card_id = ${String(card)}`)).sort((a, b) => n(a['id']) - n(b['id']));

  beforeAll(async () => {
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(
      await installBuilt(dialect, offers, {}, {
        [TILL]: {
          columns: 'card_id VARCHAR(64), card_code VARCHAR(32), kind VARCHAR(16), amount DECIMAL(12,2), at VARCHAR(40), moved_at VARCHAR(40)',
          postings: [{ id: 'bring-in', into: { addOn: 'offers', ledger: 'value', action: 'move' }, post: { on: { column: 'moved_at', set: true } }, map: { old_card: 'card_id', old_code: 'card_code', old_table: { value: 'till:cards' }, kind: 'kind', amount: 'amount', at: 'at' } }],
        },
      }),
    );
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an old card comes in under its old code with its history, at the figure the till had, and sends nothing', async () => {
    // A card made at a desk is given a code of Adminium's own making, whatever is typed: the old code cannot come in that way.
    const typed = await w.one('gift_cards', (await w.create('gift_cards', { kind: 'card', code: 'GC-99998888' })).row['id']);
    expect(typed['code']).not.toBe('GC-99998888');
    expect(String(typed['code'])).toMatch(/^GC-[0-9A-Z]{12}$/);
    const rows = [await old('7', 'issue', '50.00', '2026-03-02T10:00:00.000Z'), await old('7', 'redeem', '-21.50', '2026-04-11T15:30:00.000Z'), await old('7', 'reload', '10.00', '2026-05-01T09:00:00.000Z')];
    // Nobody made the card: its first old row does, under the code the till's own row carries — and only while the
    // move runs. With the latch off, the same row is refused and makes nothing.
    expect(await w.rowsOf('gift_cards', `moved_from = '7'`)).toEqual([]);
    await expect(w.update(TILL, rows[0], { moved_at: '2026-10-01T10:00:00.000Z' })).rejects.toThrow();
    expect(await w.rowsOf('gift_cards', `moved_from = '7'`)).toEqual([]);
    w.refused.length = 0;
    await w.h.rows(`UPDATE ${w.real('settings')} SET cards_paused = ${dialect === 'postgres' ? 'true' : '1'}`);
    for (const id of rows) await w.update(TILL, id, { moved_at: '2026-10-01T10:00:00.000Z' });
    const made = await cardOf('7');
    const after = await w.one('gift_cards', made['id']);
    expect(await w.rowsOf('gift_cards', `moved_from = '7'`)).toHaveLength(1);
    expect(after).toMatchObject({ kind: 'card', code: 'GC-48219930', label: '9930', moved_table: 'till:cards' });
    expect([true, 1]).toContain(after['moving']);
    expect(new Date(after['issued_at'] as string).toISOString().slice(0, 10)).toBe('2026-03-02');
    expect(after['status']).toBe('active');
    expect(money(after['balance'])).toBe('38.50');
    // No mail, no last day, no reminder: the holder has had this card for months.
    expect(after['notify'] ?? null).toBeNull();
    expect(after['expires_on'] ?? null).toBeNull();
    expect(after['remind_on'] ?? null).toBeNull();
    expect(await w.rowsOf('messages')).toHaveLength(0);
    // Each old row as a row here, by what it was, at the moment it happened, with what the card then held.
    expect((await ledgerOf(made['id'])).map((row) => `${String(row['kind'])} ${money(row['amount'])} → ${money(row['balance_after'])} ${new Date(row['at'] as string).toISOString().slice(0, 10)}`)).toEqual(['issue 50.00 → 50.00 2026-03-02', 'spend -21.50 → 28.50 2026-04-11', 'top_up 10.00 → 38.50 2026-05-01']);
    expect(w.refused).toEqual([]);
  });

  it.skipIf(!run)('a row marked moved a second time is brought in once', async () => {
    const [card] = await w.rowsOf('gift_cards', `moved_from = '7'`);
    const before = (await ledgerOf(card!['id'])).length;
    const [first] = await w.h.rows(`SELECT id FROM ${TILL} ORDER BY id`);
    await w.update(TILL, first!['id'], { moved_at: '2026-10-01T11:00:00.000Z' });
    expect(await ledgerOf(card!['id'])).toHaveLength(before);
    expect(money((await w.one('gift_cards', card!['id']))['balance'])).toBe('38.50');
  });

  it.skipIf(!run)('a card the till let go below nothing comes in at its true figure while it is being moved', async () => {
    for (const id of [await old('8', 'issue', '20.00', '2026-02-01T10:00:00.000Z'), await old('8', 'redeem', '-30.00', '2026-02-03T10:00:00.000Z')]) await w.update(TILL, id, { moved_at: '2026-10-01T10:00:00.000Z' });
    const made = await cardOf('8');
    // (The till kept this one's code in small letters with a space and a dash: it is kept as a code is.)
    expect(made['code']).toBe('GC-11112222');
    expect(money((await w.one('gift_cards', made['id']))['balance'])).toBe('-10.00');
    // Once the move is over it can only go up: a payment is refused, a top-up is taken.
    await w.update('gift_cards', made['id'], { moving: false });
    // While the move runs nothing is issued or topped up; its last step lets go.
    await expect(w.create('card_actions', { card_id: made['id'], action: 'top_up', amount: '25.00', reason: 'Put right at the desk', paid_by: 'cash' })).rejects.toThrow();
    const latch = (on: boolean) => w.h.rows(`UPDATE ${w.real('settings')} SET cards_paused = ${dialect === 'postgres' ? String(on) : on ? '1' : '0'}`);
    await latch(false);
    await w.create('card_actions', { card_id: made['id'], action: 'top_up', amount: '25.00', reason: 'Put right at the desk', paid_by: 'cash' });
    expect(money((await w.one('gift_cards', made['id']))['balance'])).toBe('15.00');
    // (On again for what follows: each of those rows is stopped for its own reason, not by the latch.)
    await latch(true);
  });

  it.skipIf(!run)('an old row that names no code, or one that is no code, stops the move and writes nothing', async () => {
    const bad = await old('98', 'issue', '5.00', '2026-01-01T10:00:00.000Z', 'GC-12');
    await expect(w.update(TILL, bad, { moved_at: '2026-10-01T10:00:00.000Z' })).rejects.toThrow();
    expect(await w.rowsOf('gift_cards', `moved_from = '98'`)).toEqual([]);
    const stray = await old('99', 'issue', '5.00', '2026-01-01T10:00:00.000Z', null);
    const count = (await w.rowsOf('card_ledger')).length;
    await expect(w.update(TILL, stray, { moved_at: '2026-10-01T10:00:00.000Z' })).rejects.toThrow();
    expect(await w.rowsOf('card_ledger')).toHaveLength(count);
    expect((await w.h.rows(`SELECT moved_at FROM ${TILL} WHERE id = ${String(stray)}`))[0]!['moved_at'] ?? null).toBeNull();
    expect(await w.rowsOf('gift_cards', `moved_from = '99'`)).toEqual([]);
  });

  it.skipIf(!run)('two cards of the till cannot come in under one code', async () => {
    const twin = await old('70', 'issue', '5.00', '2026-01-01T10:00:00.000Z', 'GC-48219930');
    await expect(w.update(TILL, twin, { moved_at: '2026-10-01T10:00:00.000Z' })).rejects.toThrow();
    expect(await w.rowsOf('gift_cards', `moved_from = '70'`)).toEqual([]);
    expect(await w.rowsOf('gift_cards', `code = 'GC-48219930'`)).toHaveLength(1);
  });
});
