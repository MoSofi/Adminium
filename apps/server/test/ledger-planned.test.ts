// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PLANNED ROW IS ADMINIUM'S OWN WRITE — it passes no door, and it is held
 * to every rule of its table.
 *
 * A row an add-on's plan asks for is written by Adminium inside the save
 * that posted it: stamped, worked out and checked as any row of that table,
 * its totals settled again. When it moves a row that keeps states, the move
 * must be one the table lists from where the row is — whoever is saving —
 * and a move the table keeps for its ledger alone is made by nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PlanFailed } from '../src/crud/ledger-write.js';
import type { WriteContext } from '../src/crud/write-context.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

// The server refuses a table with a posting until every door knows postings; this file is the write path's own proof.
const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } } };
const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};
/** A chore asks for a request to be moved on, when it is told to go. */
const CHORE = { id: 'chore', into: { addOn: 'ledger-kit', ledger: 'units', action: 'tidy' }, map: { request: 'request_id', to: 'want' }, post: { on: { column: 'status', in: ['go'] } } };

describe.each(LEGS)('a planned row — %s', (dialect, available) => {
  let w: LedgerWorld;
  const request = async (status: string) => {
    await w.h.rows(`INSERT INTO ledger_kit_requests (status, account_id, quantity) VALUES ('${status}', 1, 1)`);
    return Number((await w.h.rows('SELECT MAX(id) AS id FROM ledger_kit_requests'))[0]!['id']);
  };
  const statusOf = async (id: number) => String((await w.h.rows(`SELECT status FROM ledger_kit_requests WHERE id = ${String(id)}`))[0]!['status']);
  /** A chore that asks for `id` to be moved to `want`, told to go. */
  const chore = async (id: number, want: string, context: WriteContext = DESK) => {
    const row = await w.create('chores', { request_id: id, want, status: 'new' }, context);
    return { id: Number(row['id']), go: () => w.update('chores', Number(row['id']), { status: 'go' }, context) };
  };

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(dialect, {
      tallies: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL', postings: [TALLY] },
      asks: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [ASK] },
      chores: { columns: 'request_id INT NULL, want VARCHAR(20) NULL, status VARCHAR(20) NULL', postings: [CHORE] },
    });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a planned move is a listed move, made whatever the saver\'s role — a guest\'s save too', async () => {
    const id = await request('sent');
    // Marking a request done is kept for one role, and a person without it is refused…
    expect(await refusal(w.update('ledger_kit_requests', id, { status: 'done' }, DESK, w.service(undefined, { rolesOf: async () => new Set(['viewer']) })))).toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    // …the plan's move is Adminium's own: no role is asked of whoever saved.
    await (await chore(id, 'done', GUEST)).go();
    expect(await statusOf(id)).toBe('done');
    // What the save hands its door: the row as it was, and as it is.
    const [written] = w.posted()[0]!.written;
    expect(written!.table.name).toBe('ledger_kit_requests');
    expect(written!.before).toMatchObject({ status: 'sent' });
    expect(written!.row).toMatchObject({ status: 'done' });
  });

  it.skipIf(!available)('a planned move fires no posting of the table it moves a row of', async () => {
    const id = await request('sent');
    const holds = await w.count('ledger_kit_holds');
    const entries = await w.count('ledger_kit_entries');
    await (await chore(id, 'done')).go();
    expect(await statusOf(id)).toBe('done');
    // The requests' own rule takes at `done` — for a move through a door. This one came through none.
    expect(await w.receiptsOf('request', id)).toEqual([]);
    expect({ holds: await w.count('ledger_kit_holds'), entries: await w.count('ledger_kit_entries') }).toEqual({ holds, entries });
  });

  it.skipIf(!available)('a planned move the table does not list fails the save, and nothing moves', async () => {
    const id = await request('done');
    const made = await chore(id, 'draft');
    const error = await refusal(made.go());
    expect(error).toBeInstanceOf(PlanFailed);
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed', posting: 'chore' } });
    expect((error as unknown as PlanFailed).cause).toBe('scope-op');
    expect(await statusOf(id)).toBe('done');
    expect((await w.h.rows(`SELECT status FROM chores WHERE id = ${String(made.id)}`))[0]).toMatchObject({ status: 'new' });
    expect(await w.receiptsOf('chore', made.id)).toEqual([]);
  });

  it.skipIf(!available)('a move kept for a posting is made by the posting', async () => {
    const id = await request('done');
    await (await chore(id, 'filed')).go();
    expect(await statusOf(id)).toBe('filed');
  });

  it.skipIf(!available)('a move kept for a posting is refused to a Super Admin, and to a move Adminium itself declares (an effect\'s, the minute job\'s)', async () => {
    const id = await request('done');
    const anyRole = w.service(undefined, { rolesOf: async () => 'any' });
    const person = await refusal(w.update('ledger_kit_requests', id, { status: 'filed' }, DESK, anyRole));
    expect(person).toMatchObject({ code: 'STATE_MOVE_REFUSED', statusCode: 409, details: { from: 'done', to: 'filed', planned: true } });
    // An effect and the timed job move a row as the app's declared move: the roles a move is kept for do not stop those. This does.
    const job: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'system', id: null, label: 'Timed moves' }, request: null, declared: { from: 'done', to: 'filed' } };
    for (const context of [job, { ...DESK, declared: { to: 'filed' } }, { ...job, origin: 'import' as const }]) {
      expect(await refusal(w.update('ledger_kit_requests', id, { status: 'filed' }, context, anyRole)), context.origin).toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { planned: true } });
    }
    expect(await statusOf(id)).toBe('done');
  });

  it.skipIf(!available)('a planned change of a column a total filters on settles that total again, and is stamped as a change of the row', async () => {
    const held = async () => Number((await w.h.rows('SELECT held FROM ledger_kit_accounts WHERE id = 1'))[0]!['held']);
    const ask = await w.create('asks', { account_id: 1, qty: '1.5', status: 'draft' });
    const id = Number(ask['id']);
    await w.update('asks', id, { status: 'sent' });
    // The hold counts in what the account holds…
    expect(await held()).toBe(1.5);
    const hold = (await w.h.rows('SELECT id, state, taken_at FROM ledger_kit_holds ORDER BY id DESC'))[0]!;
    expect(hold).toMatchObject({ state: 'held', taken_at: null });
    // …until the plan takes it: a change of the row, so the total that reads its state is added up again.
    await w.update('asks', id, { status: 'done' });
    expect(await held()).toBe(0);
    // The door is handed the hold as it was written, the stamp included — not as the plan spelled it.
    const changed = w.posted()[0]!.written.find((written) => written.table.name === 'ledger_kit_holds')!;
    expect(changed.before).toMatchObject({ state: 'held' });
    expect(changed.row).toMatchObject({ state: 'taken' });
    expect(changed.row['taken_at'] ?? null).not.toBeNull();
    const taken = (await w.h.rows(`SELECT state, taken_at FROM ledger_kit_holds WHERE id = ${String(hold['id'])}`))[0]!;
    expect(taken['state']).toBe('taken');
    // Stamped by the table's own rule, as any change that takes a hold would be.
    expect(taken['taken_at']).not.toBeNull();
  });

  it.skipIf(!available)('a planned row is stamped with the saving user\'s name, and with nobody\'s on a guest\'s save', async () => {
    const madeBy = async () => (await w.h.rows('SELECT made_by FROM ledger_kit_entries ORDER BY id DESC'))[0]!['made_by'];
    await w.create('tallies', { account_id: 1, qty: '1' });
    expect(await madeBy()).toBe('Ivy');
    await w.create('tallies', { account_id: 1, qty: '1' }, GUEST);
    // A browser key is nobody: its name is never written where a person's goes.
    expect(await madeBy()).toBeNull();
    // And the receipt says a customer did it, by no name.
    const receipt = (await w.h.rows(`SELECT origin, ${w.q('by')} AS who FROM ledger_kit_postings ORDER BY id DESC`))[0]!;
    expect(receipt).toMatchObject({ origin: 'public', who: 'public' });
  });

  it.skipIf(!available)('a planned row its own table\'s rules refuse fails the save as the plan\'s fault', async () => {
    const before = { tallies: await w.count('tallies'), entries: await w.count('ledger_kit_entries'), receipts: await w.count('ledger_kit_postings') };
    await w.misbehave('too-much');
    try {
      const error = await refusal(w.create('tallies', { account_id: 1, qty: '1' }));
      expect(error).toBeInstanceOf(PlanFailed);
      expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed' } });
      expect((error as unknown as PlanFailed).cause).toBe('scope-op');
    } finally {
      await w.misbehave(null);
    }
    expect({ tallies: await w.count('tallies'), entries: await w.count('ledger_kit_entries'), receipts: await w.count('ledger_kit_postings') }).toEqual(before);
  });
});
