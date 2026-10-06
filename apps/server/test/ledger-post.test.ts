// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE PHASE OF ONE RULE, FOR A ROW AS IT IS STORED.
 *
 * Not every posting comes from a save of its row: a hold is let go when its
 * time has passed, whatever state the row is in. The write service runs the
 * phase by name — the same locks, plan, checks and receipt as a save that
 * crosses the point — and changes nothing of the row itself. A phase its
 * round has already seen writes nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PostedOutcome } from '../src/crud/ledger-write.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

/** No point gives a hold back: only the clock does. */
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } } };
/** `count` takes and gives back; it holds nothing first. */
const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['counted'] } } };
const JOB: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'system', id: null, label: 'Timed moves' }, request: null };

describe.each(LEGS)('one phase of one rule — %s', (dialect, available) => {
  let w: LedgerWorld;
  let announced: { row: Record<string, unknown>; postings: PostedOutcome[] }[] = [];
  const post = (table: string, id: number, posting: string, phase: 'reserve' | 'post' | 'reverse', service = w.writes) => {
    announced = [];
    return service.post({ target: w.target(table), pk: { id }, posting, phase, context: JOB, announce: async (row, postings) => void announced.push({ row, postings }) });
  };
  const held = (id: number) => w.count('ledger_kit_holds', `state = 'held' AND receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = 'ask')`);
  const sent = async () => {
    const id = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft' }))['id']);
    await w.update('asks', id, { status: 'sent' });
    return id;
  };

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, { asks: { columns, postings: [ASK] }, tallies: { columns, postings: [TALLY] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a hold is given back by name: its rows, its receipt — and the row itself as it was', async () => {
    const id = await sent();
    expect(await held(id)).toBe(1);
    const posted = await post('asks', id, 'ask', 'reverse');
    expect(posted).toMatchObject([{ posting: 'ask', phase: 'reverse', round: 1, rows: 1, state: 'planned' }]);
    expect(await held(id)).toBe(0);
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'reverse:1:planned:1']);
    expect((await w.h.rows(`SELECT status FROM asks WHERE id = ${String(id)}`))[0]).toMatchObject({ status: 'sent' });
    // Announced once, with the row it was run for; and the receipt says the system did it.
    expect(announced).toHaveLength(1);
    expect(announced[0]!.row).toMatchObject({ id, status: 'sent' });
    expect(announced[0]!.postings).toBe(posted);
    expect((await w.h.rows(`SELECT origin FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND phase = 'reverse'`))[0]).toMatchObject({ origin: 'system' });
  });

  it.skipIf(!available)('told twice it writes once, and announces nothing the second time', async () => {
    const id = await sent();
    await post('asks', id, 'ask', 'reverse');
    const receipts = await w.count('ledger_kit_postings');
    expect(await post('asks', id, 'ask', 'reverse')).toEqual([]);
    expect(announced).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
  });

  it.skipIf(!available)('a held thing is taken by name too, and a save of the row then finds it done', async () => {
    const id = await sent();
    expect(await post('asks', id, 'ask', 'post')).toMatchObject([{ phase: 'post', rows: 2 }]);
    expect(await held(id)).toBe(0);
    // The row reaching its own point afterwards crosses it — and the round has that phase already.
    await w.update('asks', id, { status: 'done' });
    expect(w.posted()).toEqual([]);
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:planned:2']);
  });

  it.skipIf(!available)('nothing to do is nothing done: a rule the table does not carry, a phase its action has not, a row that is gone', async () => {
    const id = await sent();
    const tally = Number((await w.create('tallies', { account_id: 1, qty: '1', status: 'new' }))['id']);
    const receipts = await w.count('ledger_kit_postings');
    expect(await post('asks', id, 'no-such-rule', 'reverse')).toEqual([]);
    expect(await post('tallies', tally, 'tally', 'reserve')).toEqual([]);
    expect(await post('asks', 999_999, 'ask', 'reverse')).toEqual([]);
    expect(announced).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
  });

  it.skipIf(!available)('it fails as a save would: an add-on that cannot be asked takes nothing new, and still gives back', async () => {
    const deaf = w.service({ decider: () => null });
    const id = await sent();
    // Flour does not allow going below unasked: nothing new is taken.
    expect(await refusal(post('asks', id, 'ask', 'post', deaf))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    expect(await post('asks', id, 'ask', 'reverse', deaf)).toMatchObject([{ phase: 'reverse', state: 'unplanned', rows: 0 }]);
  });
});
