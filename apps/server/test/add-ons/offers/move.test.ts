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
 * THE OLD CARD'S ROW IS PUT IN DIRECTLY. No door a person saves through keeps
 * a code they give: Adminium makes every code, whoever asks (a code is a
 * secret nobody picks). How a till hands over a card under its old code is
 * therefore not settled by this suite — it proves what Offers does once the
 * card is there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { installCustomerKey } from '../../../src/public-api/customer-key.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';

const offers = builtAddOn('offers');
const n = (value: unknown): number => Number(value);
const money = (value: unknown): string => n(value).toFixed(2);
const TILL = 'till_card_rows';

describe.each(LEGS)('cards brought in from a till — %s', (dialect, available) => {
  const run = available && offers !== null;
  let w: Writing;
  const old = async (card: string, kind: string, amount: string, at: string) => n((await w.h.rows(`INSERT INTO ${TILL} (card_id, kind, amount, at) VALUES ('${card}', '${kind}', ${amount}, '${at}')`).then(async () => (await w.h.rows(`SELECT max(id) AS id FROM ${TILL}`))[0]!))['id']);
  /** An old card as it must stand before its rows come in: its old code, where it came from, and marked as being moved. */
  const oldCard = async (id: number, code: string, from: string): Promise<number> => {
    const yes = dialect === 'postgres' ? 'true' : '1';
    await w.h.rows(`INSERT INTO ${w.real('gift_cards')} (id, kind, code, label, status, opening, moved_from, moved_table, moving) VALUES (${String(id)}, 'card', '${code}', '${code.slice(-4)}', 'inactive', 0, '${from}', 'till:cards', ${yes})`);
    return id;
  };
  const ledgerOf = async (card: unknown) => (await w.rowsOf('card_ledger', `card_id = ${String(card)}`)).sort((a, b) => n(a['id']) - n(b['id']));

  beforeAll(async () => {
    installCustomerKey('a secret only this test server knows, long enough');
    if (!run) return;
    w = await writing(
      await installBuilt(dialect, offers, {}, {
        [TILL]: {
          columns: 'card_id VARCHAR(64), kind VARCHAR(16), amount DECIMAL(12,2), at VARCHAR(40), moved_at VARCHAR(40)',
          postings: [{ id: 'bring-in', into: { addOn: 'offers', ledger: 'value', action: 'move' }, post: { on: { column: 'moved_at', set: true } }, map: { old_card: 'card_id', kind: 'kind', amount: 'amount', at: 'at' } }],
        },
      }),
    );
  }, 600_000);
  afterAll(async () => {
    if (run) await w.h.close();
  });

  it.skipIf(!run)('an old card comes in under its old code with its history, at the figure the till had, and sends nothing', async () => {
    const made = { id: await oldCard(9001, 'GC-48219930', '7') };
    // A card made at a desk is given a code of Adminium's own making, whatever is typed: the old code cannot come in that way.
    const typed = await w.one('gift_cards', (await w.create('gift_cards', { kind: 'card', code: 'GC-99998888' })).row['id']);
    expect(typed['code']).not.toBe('GC-99998888');
    expect(String(typed['code'])).toMatch(/^GC-[0-9A-Z]{12}$/);
    const rows = [await old('7', 'issue', '50.00', '2026-03-02T10:00:00.000Z'), await old('7', 'redeem', '-21.50', '2026-04-11T15:30:00.000Z'), await old('7', 'reload', '10.00', '2026-05-01T09:00:00.000Z')];
    for (const id of rows) await w.update(TILL, id, { moved_at: '2026-10-01T10:00:00.000Z' });
    const after = await w.one('gift_cards', made['id']);
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
    const made = { id: await oldCard(9500, 'GC-11112222', '8') };
    for (const id of [await old('8', 'issue', '20.00', '2026-02-01T10:00:00.000Z'), await old('8', 'redeem', '-30.00', '2026-02-03T10:00:00.000Z')]) await w.update(TILL, id, { moved_at: '2026-10-01T10:00:00.000Z' });
    expect(money((await w.one('gift_cards', made['id']))['balance'])).toBe('-10.00');
    // Once the move is over it can only go up: a payment is refused, a top-up is taken.
    await w.update('gift_cards', made['id'], { moving: false });
    await w.create('card_actions', { card_id: made['id'], action: 'top_up', amount: '25.00', reason: 'Put right at the desk', paid_by: 'cash' });
    expect(money((await w.one('gift_cards', made['id']))['balance'])).toBe('15.00');
  });

  it.skipIf(!run)('an old row for a card that was not made here stops the move and writes nothing', async () => {
    const stray = await old('99', 'issue', '5.00', '2026-01-01T10:00:00.000Z');
    const count = (await w.rowsOf('card_ledger')).length;
    await expect(w.update(TILL, stray, { moved_at: '2026-10-01T10:00:00.000Z' })).rejects.toThrow();
    expect(await w.rowsOf('card_ledger')).toHaveLength(count);
    expect((await w.h.rows(`SELECT moved_at FROM ${TILL} WHERE id = ${String(stray)}`))[0]!['moved_at'] ?? null).toBeNull();
  });
});
