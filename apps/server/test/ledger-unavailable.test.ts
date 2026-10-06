// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHEN THE ADD-ON CANNOT BE ASKED — its file is gone, nobody vouches for it,
 * it is half way through an update.
 *
 * What was taken is always given back: a cancel is never stopped by a
 * missing file. Something new is taken only when every row it would take
 * from says it may be taken unasked. Either way the receipt says nobody
 * planned it, and no row of the ledger is written until somebody can.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RecordWriteService } from '../src/crud/write-service.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

/** `use` says an account that allows going below may be taken from unasked. */
const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};
/** A rule for a ledger the add-on does not keep: there is not so much as a receipt table to write. */
const LOST = { id: 'lost', into: { addOn: 'ledger-kit', ledger: 'ghost', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } } };

describe.each(LEGS)('an add-on that cannot be asked — %s', (dialect, available) => {
  let w: LedgerWorld;
  let deaf: RecordWriteService;
  const ask = async (account: number, status = 'draft') => Number((await w.create('asks', { account_id: account, qty: '1', status }))['id']);
  const statusOf = async (table: string, id: number) => (await w.h.rows(`SELECT status FROM ${table} WHERE id = ${String(id)}`))[0]!['status'];

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, {
      asks: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [ASK] },
      strays: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [LOST] },
    });
    // The same server with the add-on's code not loaded.
    deaf = w.service({ decider: () => null });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2), (2, 'Sugar', 4, 0, 4, ${w.flag(true)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a take from a row that allows it goes through unasked: a receipt nobody planned, and no row of the ledger', async () => {
    const id = await ask(2);
    const holds = await w.count('ledger_kit_holds');
    await w.update('asks', id, { status: 'sent' }, DESK, deaf);
    expect(await statusOf('asks', id)).toBe('sent');
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:unplanned:0']);
    expect(w.posted()).toMatchObject([{ phase: 'reserve', state: 'unplanned', rows: 0 }]);
    expect(await w.count('ledger_kit_holds')).toBe(holds);
  });

  it.skipIf(!available)('a take from a row that does not allow it is refused, and the row does not move', async () => {
    const id = await ask(1);
    expect(await refusal(w.update('asks', id, { status: 'sent' }, DESK, deaf))).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'add-on-unavailable', posting: 'ask' } });
    expect(await statusOf('asks', id)).toBe('draft');
    expect(await w.receiptsOf('ask', id)).toEqual([]);
    // Nor when the row it would take from is not there to say yes.
    const nowhere = await ask(99);
    expect(await refusal(w.update('asks', nowhere, { status: 'sent' }, DESK, deaf))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
  });

  it.skipIf(!available)('a round nobody planned and its giving back cancel out: nothing was written, so nobody is asked what to undo', async () => {
    const id = await ask(2);
    await w.update('asks', id, { status: 'sent' }, DESK, deaf);
    const before = { holds: await w.count('ledger_kit_holds'), entries: await w.count('ledger_kit_entries') };
    // The add-on can answer again — and would throw if it were asked.
    await w.misbehave('throw');
    try {
      await w.update('asks', id, { status: 'cancelled' });
    } finally {
      await w.misbehave(null);
    }
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:0', 'reverse:1:planned:0']);
    expect({ holds: await w.count('ledger_kit_holds'), entries: await w.count('ledger_kit_entries') }).toEqual(before);
    // Nothing is left waiting to be worked out.
    expect(await w.count('ledger_kit_postings', `state = 'unplanned' AND source_row = '${String(id)}'`)).toBe(0);
  });

  it.skipIf(!available)('what was planned is given back unasked while the add-on cannot answer, and waits to be worked out', async () => {
    const id = await ask(1);
    await w.update('asks', id, { status: 'sent' });
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1']);
    await w.update('asks', id, { status: 'cancelled' }, DESK, deaf);
    expect(await statusOf('asks', id)).toBe('cancelled');
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'reverse:1:unplanned:0']);
    // The hold is still there: letting it go is the catch-up's, once somebody can plan it.
    expect(await w.count('ledger_kit_holds', `state = 'held'`)).toBeGreaterThan(0);
  });

  it.skipIf(!available)('with not even a receipt table to write: nothing new is taken, and a cancel still goes through', async () => {
    const row = await w.create('strays', { account_id: 1, qty: '1', status: 'draft' });
    const id = Number(row['id']);
    expect(await refusal(w.update('strays', id, { status: 'done' }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable', posting: 'lost' } });
    expect(await statusOf('strays', id)).toBe('draft');
    const receipts = await w.count('ledger_kit_postings');
    await w.update('strays', id, { status: 'cancelled' });
    expect(await statusOf('strays', id)).toBe('cancelled');
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
  });
});
