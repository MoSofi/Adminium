// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING SAVE STANDS ON IS WHAT IT LOCKED.
 *
 * A save looks before it locks: which points the change crosses, which rows
 * of the add-on it will take from. Another save may move the row in between.
 * Under the locks everything is judged again on the row as held — a point
 * the look did not see, or a row of the add-on it did not name, starts the
 * save again from a fresh look; after three it asks to be tried again.
 * Nothing is ever posted from what the row used to be.
 *
 * And how long a hold is kept for is written on its receipt, emptied when
 * the hold is taken for good or given back.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RecordWriteService } from '../src/crud/write-service.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } }, heldUntil: 'hold_until' };
const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
  heldUntil: 'hold_until',
};

describe.each(LEGS)('what a posting save stands on — %s', (dialect, available) => {
  let w: LedgerWorld;
  /** What the next looks do to the database behind the save's back, once each. */
  let between: (() => Promise<unknown>)[] = [];
  let racing: RecordWriteService;
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';
  const statusOf = async (table: string, id: number) => (await w.h.rows(`SELECT status FROM ${table} WHERE id = ${String(id)}`))[0]!['status'];
  const heldUntil = async (posting: string, id: number) =>
    (await w.h.rows(`SELECT phase, held_until FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = '${posting}' ORDER BY id`)).map((row) => {
      const value = row['held_until'];
      if (value === null || value === undefined) return `${String(row['phase'])}:-`;
      // A moment kept with no zone of its own (SQLite) is this server's wall clock, as every moment Adminium writes there is.
      const at = value instanceof Date ? value : new Date(String(value).replace(' ', 'T'));
      return `${String(row['phase'])}:${at.toISOString()}`;
    });

  beforeAll(async () => {
    if (!available) return;
    const columns = `account_id INT NULL, qty DECIMAL(12,3) NULL, note VARCHAR(80) NULL, status VARCHAR(20) NULL, hold_until ${moment} NULL`;
    w = await ledgerWorld(dialect, { tallies: { columns, postings: [TALLY] }, asks: { columns, postings: [ASK] } });
    // The same server, with something else writing between a save's look and its locks. The first look of a save is the table's; the next ones are each attempt's.
    let looks = 0;
    racing = w.service({
      refresh: async () => {
        looks += 1;
        if (looks > 1) await between.shift()?.();
      },
    });
    const race = racing.update.bind(racing);
    racing.update = (input) => {
      looks = 0;
      return race(input);
    };
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2), (2, 'Sugar', 100, 0, 100, ${w.flag(false)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a change that crosses nothing is saved, and hands nothing to anybody', async () => {
    const row = await w.create('asks', { account_id: 1, qty: '1', status: 'draft' });
    const receipts = await w.count('ledger_kit_postings');
    await w.update('asks', Number(row['id']), { note: 'only a note' });
    expect((await w.h.rows(`SELECT note FROM asks WHERE id = ${String(row['id'])}`))[0]).toMatchObject({ note: 'only a note' });
    expect(w.posted()).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
  });

  it.skipIf(!available)('a point the look did not see, crossed on the row as held, starts the save again — and is then posted', async () => {
    const tally = await w.create('tallies', { account_id: 1, qty: '2' });
    const id = Number(tally['id']);
    // The row reads as void already, so voiding it crosses nothing…
    await w.h.rows(`UPDATE tallies SET status = 'void' WHERE id = ${String(id)}`);
    // …until somebody takes the void back, between this save's look and its locks.
    between = [() => w.h.rows(`UPDATE tallies SET status = NULL WHERE id = ${String(id)}`)];
    await w.update('tallies', id, { status: 'void' }, DESK, racing);
    expect(between).toEqual([]);
    expect(await statusOf('tallies', id)).toBe('void');
    // Under the locks the change did cross the point: the round is given back, once.
    expect(await w.receiptsOf('tally', id)).toEqual(['post:1:planned:1', 'reverse:1:planned:1']);
    expect(w.posted().map((call) => call.phase)).toEqual(['reverse']);
  });

  it.skipIf(!available)('a point the look saw that the row as held no longer crosses is not posted', async () => {
    const tally = await w.create('tallies', { account_id: 1, qty: '2' });
    const id = Number(tally['id']);
    // Somebody else's write puts the row where this change takes it, behind its back: there is nothing left to cross.
    between = [() => w.h.rows(`UPDATE tallies SET status = 'void' WHERE id = ${String(id)}`)];
    await w.update('tallies', id, { status: 'void' }, DESK, racing);
    expect(between).toEqual([]);
    expect(await w.receiptsOf('tally', id)).toEqual(['post:1:planned:1']);
    expect(w.posted()).toEqual([]);
  });

  it.skipIf(!available)('a row of the add-on the look did not name starts the save again; three times over, it asks to be tried again and writes nothing', async () => {
    const tally = await w.create('tallies', { account_id: 1, qty: '2' });
    const id = Number(tally['id']);
    const flip = (to: number) => () => w.h.rows(`UPDATE tallies SET account_id = ${String(to)} WHERE id = ${String(id)}`);
    // Every look is followed by the row being pointed at the other account.
    between = [flip(2), flip(1), flip(2)];
    const error = await refusal(w.update('tallies', id, { status: 'void' }, DESK, racing));
    expect(error).toMatchObject({ code: 'WRITE_CONFLICT', statusCode: 409, details: { retry: true } });
    expect(between).toEqual([]);
    expect(await statusOf('tallies', id)).toBeNull();
    expect(await w.receiptsOf('tally', id)).toEqual(['post:1:planned:1']);
    // Left alone, the same change goes through.
    await w.update('tallies', id, { status: 'void' }, DESK, racing);
    expect(await w.receiptsOf('tally', id)).toEqual(['post:1:planned:1', 'reverse:1:planned:1']);
  });

  it.skipIf(!available)('a hold is kept until the time its row says, on its receipt; taken for good or given back, it is kept no longer', async () => {
    const until = '2031-03-04T10:30:00.000Z';
    const first = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft', hold_until: until }))['id']);
    await w.update('asks', first, { status: 'sent' });
    expect(await heldUntil('ask', first)).toEqual([`reserve:${until}`]);
    await w.update('asks', first, { status: 'done' });
    expect(await heldUntil('ask', first)).toEqual(['reserve:-', 'post:-']);

    const second = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft', hold_until: until }))['id']);
    await w.update('asks', second, { status: 'sent' });
    await w.update('asks', second, { status: 'cancelled' });
    expect(await heldUntil('ask', second)).toEqual(['reserve:-', 'reverse:-']);

    // A row with no time holds until it is moved on: nothing lets it go by the clock.
    const open = Number((await w.create('asks', { account_id: 1, qty: '1', status: 'draft' }))['id']);
    await w.update('asks', open, { status: 'sent' });
    expect(await heldUntil('ask', open)).toEqual(['reserve:-']);
    // And an action that holds nothing keeps nothing until a time, whatever its row carries.
    const tally = Number((await w.create('tallies', { account_id: 1, qty: '1', hold_until: until }))['id']);
    expect(await heldUntil('tally', tally)).toEqual(['post:-']);
  });
});
