// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LIMIT ON A LEDGER'S OWN TABLE HOLDS FOR PLANNED ROWS TOO.
 *
 * An account of the test ledger holds only so many things at once. The
 * rows that take from that limit are the add-on's plan, so the save asks
 * for the plan once before it locks anything — only to name the pools those
 * rows take from — and judges the rows it then writes under those locks.
 * A limit that says no is told as the ledger's refusal, about the row that
 * was being saved.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PlanFailed } from '../src/crud/ledger-write.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};

describe.each(LEGS)('a limit on a ledger\'s own table — %s', (dialect, available) => {
  let w: LedgerWorld;
  const ask = async () => Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft' }))['id']);
  const statusOf = async (id: number) => (await w.h.rows(`SELECT status FROM asks WHERE id = ${String(id)}`))[0]!['status'];
  const held = () => w.count('ledger_kit_holds', `account_id = 1 AND state = 'held'`);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { asks: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [ASK] } });
    // An account that holds two things at once.
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at, max_holds) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a planned row over the limit fails the save as the ledger\'s refusal; one let go makes room again', async () => {
    const [a, b, c] = [await ask(), await ask(), await ask()];
    await w.update('asks', a, { status: 'sent' });
    await w.update('asks', b, { status: 'sent' });
    expect(await held()).toBe(2);
    const error = await refusal(w.update('asks', c, { status: 'sent' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'out-of-stock', ledger: 'units', posting: 'ask' } });
    expect(await statusOf(c)).toBe('draft');
    expect(await held()).toBe(2);
    expect(await w.receiptsOf('ask', c)).toEqual([]);
    // One is given back: its hold counts no longer, and the third goes through.
    await w.update('asks', a, { status: 'cancelled' });
    expect(await held()).toBe(1);
    await w.update('asks', c, { status: 'sent' });
    expect(await held()).toBe(2);
    expect(await w.receiptsOf('ask', c)).toEqual(['reserve:1:planned:1']);
    // Taking a hold for good frees its place as well.
    await w.update('asks', b, { status: 'done' });
    expect(await held()).toBe(1);
  });

  it.skipIf(!available)('a plan that fails when asked for the pools\' names is no refusal there: the save fails on it, under its locks', async () => {
    const id = await ask();
    await w.misbehave('throw');
    try {
      const error = await refusal(w.update('asks', id, { status: 'sent' }));
      expect(error).toBeInstanceOf(PlanFailed);
      expect((error as unknown as PlanFailed).cause).toBe('threw');
    } finally {
      await w.misbehave(null);
    }
    expect(await statusOf(id)).toBe('draft');
  });
});
