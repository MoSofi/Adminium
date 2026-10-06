// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A HOLD IS LET GO WHEN ITS TIME HAS PASSED — by the minute's job, whatever
 * state its row is in.
 *
 * The receipt of a hold says until when. Past that, the job gives the round
 * back: the same write as a save that crosses a reverse point, for the row
 * as it is stored, changing nothing of the row. A hold taken or given back
 * in time is left alone; one whose time has not come is left alone; a
 * receipt whose source table is gone is let go of, not tried every minute.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PostedOutcome } from '../src/crud/ledger-write.js';
import { runTimedMoves, type TimedMovesDeps } from '../src/states/timed-moves.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

/** Held when sent, taken when done; nothing but the clock gives it back. */
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, heldUntil: 'hold_until' };
const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

describe.each(LEGS)('a hold let go by the clock — %s', (dialect, available) => {
  let w: LedgerWorld;
  let released: { table: string; row: Record<string, unknown>; postings: PostedOutcome[] }[] = [];
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';
  const tick = () => {
    released = [];
    const at = w.target('asks');
    const deps: TimedMovesDeps = { meta: w.h.meta, manager: w.h.manager, writes: w.writes, ledgers: w.runtime, viewFor: async () => at.view, released: async (input) => void released.push({ table: input.table.name, row: input.row, postings: input.postings }) };
    return runTimedMoves(deps, w.h.connectionId, {}, new Date());
  };
  const held = async (until: string | null) => {
    const id = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft', ...(until === null ? {} : { hold_until: until }) }))['id']);
    await w.update('asks', id, { status: 'sent' });
    return id;
  };
  const holdsOf = (id: number, state: string) => w.count('ledger_kit_holds', `state = '${state}' AND receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = 'ask')`);
  const kept = (id: number) => w.count('ledger_kit_postings', `source_row = '${String(id)}' AND posting = 'ask' AND held_until IS NOT NULL`);

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, { asks: { columns: `account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL, hold_until ${moment} NULL`, postings: [ASK] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 1000, 0, 1000, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a hold past its time is given back by the minute\'s job, once, and its row is as it was', async () => {
    const late = await held(PAST);
    const later = await held(FUTURE);
    const open = await held(null);
    expect([await holdsOf(late, 'held'), await kept(late)]).toEqual([1, 1]);
    const first = await tick();
    expect(first).toMatchObject({ moved: 1, refused: 0 });
    expect(await holdsOf(late, 'held')).toBe(0);
    expect(await holdsOf(late, 'released')).toBe(1);
    expect(await w.receiptsOf('ask', late)).toEqual(['reserve:1:planned:1', 'reverse:1:planned:1']);
    expect(await kept(late)).toBe(0);
    expect((await w.h.rows(`SELECT status FROM asks WHERE id = ${String(late)}`))[0]).toMatchObject({ status: 'sent' });
    // Announced as a posting is, for the row it was run for; the receipt says the system did it.
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ table: 'asks', row: { id: late }, postings: [{ posting: 'ask', phase: 'reverse' }] });
    expect((await w.h.rows(`SELECT origin FROM ledger_kit_postings WHERE source_row = '${String(late)}' AND phase = 'reverse'`))[0]).toMatchObject({ origin: 'system' });
    // A hold whose time has not come, and one with no time at all, are left alone.
    expect([await holdsOf(later, 'held'), await holdsOf(open, 'held')]).toEqual([1, 1]);
    // The next minute finds nothing to do.
    expect(await tick()).toMatchObject({ moved: 0, refused: 0 });
    expect(released).toEqual([]);
  });

  it.skipIf(!available)('a hold taken in time is left alone: what was taken is not given back by the clock', async () => {
    const id = await held(PAST);
    await w.update('asks', id, { status: 'done' });
    expect(await kept(id)).toBe(0);
    const entries = await w.count('ledger_kit_entries');
    expect(await tick()).toMatchObject({ moved: 0 });
    expect(await w.count('ledger_kit_entries')).toBe(entries);
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:planned:2']);
  });

  it.skipIf(!available)('a receipt whose source table is gone is let go of, and not tried again', async () => {
    await w.h.rows(
      `INSERT INTO ledger_kit_postings (source_table, source_row, source_line, line_table, ledger, action, posting, phase, round, state, ${w.q('rows')}, add_on_version, origin, ${w.q('by')}, at, held_until) VALUES ('gone-app:orders', '5', '', '', 'units', 'use', 'old', 'reserve', 1, 'planned', 1, '1.0.0', 'staff', 'usr_1', '2019-01-01 00:00:00', '2019-01-02 00:00:00')`,
    );
    expect(await w.count('ledger_kit_postings', `source_table = 'gone-app:orders' AND held_until IS NOT NULL`)).toBe(1);
    expect(await tick()).toMatchObject({ moved: 0, refused: 0 });
    expect(await w.count('ledger_kit_postings', `source_table = 'gone-app:orders' AND held_until IS NOT NULL`)).toBe(0);
    expect(await w.count('ledger_kit_postings', `source_table = 'gone-app:orders'`)).toBe(1);
  });
});
