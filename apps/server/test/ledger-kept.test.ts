// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT IS KEPT UNTIL A TIME, AND WHAT IS NOT ANY MORE.
 *
 * A hold, and a payment decided as its row was made, are kept until a time
 * on their receipt; the minute's job gives back the ones whose time has
 * passed. Each of these is a way that went wrong on paper before it could in
 * a shop:
 *
 *  - the job reads what is due, then gives it back — and in between the row
 *    may be taken for good: only what is STILL kept is given back;
 *  - only the lines whose own time passed, never the whole order with them;
 *  - a hold whose rule cannot be asked just now is not forgotten: it waits;
 *  - a payment given back while the add-on cannot be asked still comes off
 *    its row at once;
 *  - a payment made for a row that already stands is not kept at all;
 *  - a taking that waited while its round was given back is closed as it
 *    stands — planned later, it would take for an order that was cancelled;
 *  - a line added to an order that was placed with no line yet is held;
 *  - a change of many rows cannot mark a row paid past a payment still kept.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import type { RecordWriteService } from '../src/crud/write-service.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { ledgerKitDecidesManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const UNITS = { addOn: 'ledger-kit', ledger: 'units' };
const JOB: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'system', id: null, label: 'Timed moves' }, request: null };
const PAST = '2020-01-01T00:00:00.000Z';
const FUTURE = '2099-01-01T00:00:00.000Z';

/** Held when sent, taken when done, given back when cancelled — or by the clock. */
const ASK = { id: 'ask', into: { ...UNITS, action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } }, heldUntil: 'hold_until' };
/** An order's lines, held once it is placed, each until its own time. */
const LINE = { id: 'line', into: { ...UNITS, action: 'use' }, via: 'order_id', map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['placed'] } }, post: { on: { column: 'status', in: ['picked_up'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } }, heldUntil: 'hold_until' };
/** A payment of a tab from an account, kept until a time unless the tab is paid first. */
const TAB_PAY = { id: 'tab-pay', into: { ...UNITS, action: 'pay' }, via: 'tab_id', map: { account: 'account_id', due: { parent: 'due' }, amount: 'amount' }, post: { on: { create: true } }, reverse: { on: { column: 'voided_at', set: true, own: true } }, heldUntil: 'held_until' };
/** The tab's own rule: "paid" is where things are taken for good. */
const TAB_SEAL = { id: 'tab-seal', into: { ...UNITS, action: 'count' }, map: { account: 'account_id', quantity: { value: '0' } }, post: { on: { column: 'status', in: ['paid'] } } };

describe.each(LEGS)('what is kept until a time — %s', (dialect, available) => {
  let w: LedgerWorld;
  let deaf: RecordWriteService;
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';
  const minute = (writes: RecordWriteService = w.writes) => runTimedMoves({ meta: w.h.meta, manager: w.h.manager, writes, ledgers: w.runtime, viewFor: async () => w.target('asks').view }, w.h.connectionId, {}, new Date());
  const balance = async (id: number) => Number((await w.h.rows(`SELECT balance FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!['balance']);
  const holds = (posting: string, row: unknown, state: string, line?: unknown) =>
    w.count('ledger_kit_holds', `state = '${state}' AND receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(row)}' AND posting = '${posting}'${line === undefined ? '' : ` AND source_line = '${String(line)}'`})`);
  const keptIds = async (posting: string, row: unknown) => (await w.h.rows(`SELECT id FROM ledger_kit_postings WHERE source_row = '${String(row)}' AND posting = '${posting}' AND held_until IS NOT NULL ORDER BY id`)).map((found) => found['id'] as string | number);
  const ask = async (until: string | null, account = 1) => {
    const id = Number((await w.create('asks', { account_id: account, qty: '1', status: 'draft', ...(until === null ? {} : { hold_until: until }) }))['id']);
    await w.update('asks', id, { status: 'sent' });
    return id;
  };

  beforeAll(async () => {
    if (!available) return;
    const row = `account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL, hold_until ${moment} NULL`;
    w = await ledgerWorld(
      dialect,
      {
        asks: { columns: row, postings: [ASK] },
        orders: { columns: 'status VARCHAR(20) NULL', postings: [] },
        order_lines: { columns: `order_id INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, hold_until ${moment} NULL, FOREIGN KEY (order_id) REFERENCES orders(id)`, postings: [LINE] },
        tabs: { columns: 'account_id INT NULL, due DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [TAB_SEAL] },
        tab_pays: { columns: `tab_id INT NULL, account_id INT NULL, amount DECIMAL(12,3) NULL, voided_at VARCHAR(40) NULL, held_until ${moment} NULL, FOREIGN KEY (tab_id) REFERENCES tabs(id)`, postings: [TAB_PAY] },
      },
      ledgerKitDecidesManifest(),
    );
    deaf = w.service({ decider: () => null });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 1000, 0, 1000, ${w.flag(false)}, 2), (3, 'Salt', 1000, 0, 1000, ${w.flag(true)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a hold taken for good after the job read it as due is not given back: only what is still kept is', async () => {
    const id = await ask(PAST);
    // What the job read a moment ago…
    const due = await keptIds('ask', id);
    expect(due).toHaveLength(1);
    // …and then the row was taken for good.
    await w.update('asks', id, { status: 'done' });
    const before = { balance: await balance(1), receipts: await w.receiptsOf('ask', id) };
    const posted = await w.writes.post({ target: w.target('asks'), pk: { id }, posting: 'ask', phase: 'reverse', kept: due, context: JOB, announce: async () => undefined });
    expect(posted).toEqual([]);
    expect({ balance: await balance(1), receipts: await w.receiptsOf('ask', id) }).toEqual(before);
    expect(await w.count('ledger_kit_entries', `kind = 'back'`)).toBe(0);
    // The same call for a hold that is still kept gives it back.
    const other = await ask(PAST);
    expect(await w.writes.post({ target: w.target('asks'), pk: { id: other }, posting: 'ask', phase: 'reverse', kept: await keptIds('ask', other), context: JOB, announce: async () => undefined })).toMatchObject([{ phase: 'reverse', rows: 1 }]);
    expect(await holds('ask', other, 'released')).toBe(1);
  });

  it.skipIf(!available)('of an order\'s lines, the clock gives back the one whose time passed and leaves the others held', async () => {
    const order = Number((await w.create('orders', { status: 'draft' }))['id']);
    const late = Number((await w.create('order_lines', { order_id: order, account_id: 1, qty: '2', hold_until: PAST }))['id']);
    const later = Number((await w.create('order_lines', { order_id: order, account_id: 1, qty: '3', hold_until: FUTURE }))['id']);
    await w.update('orders', order, { status: 'placed' });
    expect([await holds('line', order, 'held', late), await holds('line', order, 'held', later)]).toEqual([1, 1]);
    expect(await minute()).toMatchObject({ moved: 1, refused: 0 });
    expect([await holds('line', order, 'released', late), await holds('line', order, 'held', later)]).toEqual([1, 1]);
    expect((await w.h.rows(`SELECT source_line, phase FROM ledger_kit_postings WHERE source_row = '${String(order)}' AND posting = 'line' AND phase = 'reverse'`)).map((row) => String(row['source_line']))).toEqual([String(late)]);
    // The line that is still held is given back by the order's own cancel, as ever.
    await w.update('orders', order, { status: 'cancelled' });
    expect(await holds('line', order, 'held', later)).toBe(0);
  });

  it.skipIf(!available)('a hold whose end is brought forward by a statement of its own is given back at the new time, not at the one its receipt first read', async () => {
    const id = await ask(FUTURE);
    const other = await ask(FUTURE);
    expect(await minute()).toMatchObject({ moved: 0 });
    // A buyer's new hold lets this one go: its end is moved by the public write's own statement, and the ledger is told.
    const soon = new Date(Date.now() - 2000).toISOString();
    await w.writes.holdEndMoved({ target: w.target('asks'), row: { id }, column: 'hold_until', at: soon });
    // A column no rule keeps anything until moves nothing.
    await w.writes.holdEndMoved({ target: w.target('asks'), row: { id: other }, column: 'status', at: soon });
    expect(await minute()).toMatchObject({ moved: 1, refused: 0 });
    expect([await holds('ask', id, 'released'), await holds('ask', other, 'held')]).toEqual([1, 1]);
    await w.update('asks', other, { status: 'cancelled' });
  });

  it.skipIf(!available)('a hold past its time that could not be given back is not forgotten: it stays kept, and stays held', async () => {
    const id = await ask(PAST);
    // The row is gone from under its hold (taken out by hand): nothing can be run for it.
    await w.h.rows(`DELETE FROM asks WHERE id = ${String(id)}`);
    const tick = { left: {} as Record<string, number> };
    const first = await runTimedMoves({ meta: w.h.meta, manager: w.h.manager, writes: w.writes, ledgers: w.runtime, viewFor: async () => w.target('asks').view }, w.h.connectionId, tick.left, new Date());
    expect(first).toMatchObject({ moved: 0 });
    expect(await keptIds('ask', id)).toHaveLength(1);
    expect(await holds('ask', id, 'held')).toBe(1);
    await w.h.rows(`DELETE FROM ledger_kit_holds WHERE receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = 'ask')`);
    await w.h.rows(`DELETE FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = 'ask'`);
  });

  it.skipIf(!available)('a kept payment given back while the add-on cannot be asked comes off its row at once, and its money is worked out later — once', async () => {
    const tab = Number((await w.create('tabs', { account_id: 3, due: '40', status: 'open' }))['id']);
    const pay = Number((await w.create('tab_pays', { tab_id: tab, account_id: 3, held_until: PAST }))['id']);
    expect(Number((await w.h.rows(`SELECT amount FROM tab_pays WHERE id = ${String(pay)}`))[0]!['amount'])).toBe(40);
    const paid = await balance(3);
    // Its time has passed, and nobody can be asked what to give back.
    expect(await minute(deaf)).toMatchObject({ moved: 1 });
    expect((await w.h.rows(`SELECT amount FROM tab_pays WHERE id = ${String(pay)}`))[0]!['amount'] ?? null).toBeNull();
    expect(await balance(3)).toBe(paid);
    expect((await w.h.rows(`SELECT phase, state FROM ledger_kit_postings WHERE source_row = '${String(tab)}' AND posting = 'tab-pay' ORDER BY id`)).map((row) => `${String(row['phase'])}:${String(row['state'])}`)).toEqual(['post:planned', 'reverse:unplanned']);
    // Worked out when the add-on answers again: the money goes back, and the amount stays off the row.
    const caught = await w.writes.post({ target: w.target('tabs'), pk: { id: tab }, posting: 'tab-pay', phase: 'reverse', catchUp: true, context: JOB, announce: async () => undefined });
    expect(caught).toMatchObject([{ phase: 'reverse', state: 'planned' }]);
    expect(await balance(3)).toBe(paid + 40);
    expect((await w.h.rows(`SELECT amount FROM tab_pays WHERE id = ${String(pay)}`))[0]!['amount'] ?? null).toBeNull();
    expect(await w.writes.post({ target: w.target('tabs'), pk: { id: tab }, posting: 'tab-pay', phase: 'reverse', catchUp: true, context: JOB, announce: async () => undefined })).toEqual([]);
  });

  it.skipIf(!available)('a payment made for a tab that already stands as paid is not kept: the clock has nothing of it to give back', async () => {
    const tab = Number((await w.create('tabs', { account_id: 3, due: '15', status: 'paid' }))['id']);
    const pay = Number((await w.create('tab_pays', { tab_id: tab, account_id: 3, held_until: PAST }))['id']);
    expect(await w.count('ledger_kit_postings', `source_row = '${String(tab)}' AND posting = 'tab-pay' AND held_until IS NOT NULL`)).toBe(0);
    const paid = await balance(3);
    await minute();
    expect(await balance(3)).toBe(paid);
    expect(Number((await w.h.rows(`SELECT amount FROM tab_pays WHERE id = ${String(pay)}`))[0]!['amount'])).toBe(15);
    // A payment for a tab still open IS kept, until its time.
    const open = Number((await w.create('tabs', { account_id: 3, due: '5', status: 'open' }))['id']);
    await w.create('tab_pays', { tab_id: open, account_id: 3, held_until: FUTURE });
    expect(await w.count('ledger_kit_postings', `source_row = '${String(open)}' AND posting = 'tab-pay' AND held_until IS NOT NULL`)).toBe(1);
  });

  it.skipIf(!available)('a tab with a kept payment is not marked paid by a change of many rows while its own rule is switched off: only a single save tells the payment it stands', async () => {
    const tab = Number((await w.create('tabs', { account_id: 3, due: '5', status: 'open' }))['id']);
    await w.create('tab_pays', { tab_id: tab, account_id: 3, held_until: FUTURE });
    const at = w.target('tabs');
    const off = { ...at, table: { ...at.table, table: { ...at.table.table!, switchedOff: { postings: ['tab-seal'] } } } } as typeof at;
    const BULK: WriteContext = { origin: 'bulk', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
    const many = (values: Record<string, unknown>) => w.writes.beforeEach('update', off, BULK, [{ match: { id: tab }, values }]);
    await expect(many({ status: 'paid' })).rejects.toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time' } });
    // The same move for a tab nothing is kept for goes through.
    const bare = Number((await w.create('tabs', { account_id: 3, due: '5', status: 'open' }))['id']);
    await expect(w.writes.beforeEach('update', off, BULK, [{ match: { id: bare }, values: { status: 'paid' } }])).resolves.toBeDefined();
    // The single save, with the rule still off: the payment is kept no longer.
    await w.writes.update({ target: off, context: JOB, pk: { id: tab }, values: { status: 'paid' }, announce: async () => undefined, mapError: (error: unknown) => { throw error; } } as never);
    expect(await keptIds('tab-pay', tab)).toEqual([]);
  });

  it.skipIf(!available)('a taking that waited while its round was given back is closed as it stands: recorded later, it takes nothing', async () => {
    // Held; then taken while the add-on could not be asked (Salt allows it); then cancelled once it could.
    const id = await ask(null, 3);
    await w.update('asks', id, { status: 'done' }, undefined, deaf);
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:unplanned:0']);
    await w.update('asks', id, { status: 'cancelled' });
    expect(await holds('ask', id, 'held')).toBe(0);
    const before = { balance: await balance(3), entries: await w.count('ledger_kit_entries', 'account_id = 3') };
    // What waited is recorded now: the round is over, so nothing is taken for it.
    const caught = await w.writes.post({ target: w.target('asks'), pk: { id }, posting: 'ask', phase: 'post', catchUp: true, context: JOB, announce: async () => undefined });
    expect(caught).toMatchObject([{ phase: 'post', rows: 0 }]);
    expect({ balance: await balance(3), entries: await w.count('ledger_kit_entries', 'account_id = 3') }).toEqual(before);
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:planned:0', 'reverse:1:planned:1']);
    expect(await w.count('ledger_kit_postings', `source_row = '${String(id)}' AND state = 'unplanned'`)).toBe(0);
  });

  it.skipIf(!available)('a line added to an order that was placed with no line yet is held: the order itself says it was placed', async () => {
    const order = Number((await w.create('orders', { status: 'placed' }))['id']);
    expect(await w.count('ledger_kit_postings', `source_row = '${String(order)}' AND posting = 'line'`)).toBe(0);
    const line = Number((await w.create('order_lines', { order_id: order, account_id: 1, qty: '4', hold_until: FUTURE }))['id']);
    expect(w.posted()).toMatchObject([{ posting: 'line', phase: 'reserve', lines: [String(line)] }]);
    expect(await holds('line', order, 'held', line)).toBe(1);
    // A line added to an order that is not placed yet waits for it, as before.
    const draft = Number((await w.create('orders', { status: 'draft' }))['id']);
    await w.create('order_lines', { order_id: draft, account_id: 1, qty: '1' });
    expect(w.posted()).toEqual([]);
  });
});
