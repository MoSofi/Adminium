// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN ORDER'S LINES POST WITH THE ORDER.
 *
 * A rule on a table of lines names the row each line belongs to (`via`).
 * A line's own making is the line's point — that line alone is handed over,
 * with its order as the source. Every other point is the order's: when the
 * order moves, every line of it is handed over in ONE call, each with its
 * own receipt. A line its rule leaves out (voided) is never handed over. A
 * line made after the order's lines were already held is held in the save
 * that makes it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

vi.mock('../src/crud/unbuilt-rules.js', async (original) => ({
  ...(await original<typeof import('../src/crud/unbuilt-rules.js')>()),
  refuseUnbuiltTable: () => undefined,
}));

/** Held when the line is made, taken when the order is picked up, given back when it is cancelled. */
const LINE = {
  id: 'line',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  via: 'order_id',
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { create: true } },
  post: { on: { column: 'status', in: ['picked_up'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
  heldUntil: { parent: 'hold_until' },
  unlessSet: 'voided_at',
};
/** Held only once the order is placed: a point of the order, not of the line. */
const EXTRA = {
  id: 'extra',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  via: 'order_id',
  map: { account: 'account_id', quantity: 'qty' },
  reserve: { on: { column: 'status', in: ['placed'] } },
  post: { on: { column: 'status', in: ['picked_up'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};

describe.each(LEGS)('an order\'s lines — %s', (dialect, available) => {
  let w: LedgerWorld;
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';
  const order = async (status = 'draft', more: Record<string, unknown> = {}) => Number((await w.create('orders', { status, ...more }))['id']);
  const line = async (table: string, orderId: number, account: number, qty: string, context = DESK, more: Record<string, unknown> = {}) => Number((await w.create(table, { order_id: orderId, account_id: account, qty, ...more }, context))['id']);
  const receipts = async (posting: string, orderId: number) =>
    (await w.h.rows(`SELECT source_line, line_table, phase, round, ${w.q('rows')} AS n, held_until FROM ledger_kit_postings WHERE source_row = '${String(orderId)}' AND posting = '${posting}' ORDER BY id`)).map((row) => ({
      line: Number(row['source_line']),
      table: String(row['line_table']),
      at: `${String(row['phase'])}:${String(row['round'])}:${String(row['n'])}`,
      held: row['held_until'] !== null && row['held_until'] !== undefined,
    }));
  const held = () => w.count('ledger_kit_holds', `state = 'held'`);
  const taken = async (id: number) => Number((await w.h.rows(`SELECT taken FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!['taken']);

  beforeAll(async () => {
    if (!available) return;
    const lines = 'order_id INT NULL, account_id INT NULL, qty DECIMAL(12,3) NULL, voided_at VARCHAR(40) NULL, FOREIGN KEY (order_id) REFERENCES orders(id)';
    w = await ledgerWorld(dialect, {
      orders: { columns: `status VARCHAR(20) NULL, hold_until ${moment} NULL`, postings: [] },
      order_lines: { columns: lines, postings: [LINE] },
      // An extra may not be had with an order one of whose plain lines is voided: a rule about a sibling table of the same order.
      order_extras: { columns: lines, postings: (idOf) => [{ ...EXTRA, refuses: [{ table: idOf('order_lines'), via: 'order_id', column: 'voided_at', set: true }] }] },
    });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 100, 0, 100, ${w.flag(false)}, 2), (2, 'Sugar', 3, 0, 3, ${w.flag(false)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a line added to an order is held alone: its own receipt under the order, kept until the order\'s time', async () => {
    const id = await order('placed', { hold_until: '2031-05-06T07:08:00.000Z' });
    const first = await line('order_lines', id, 1, '2');
    expect(w.posted()).toMatchObject([{ posting: 'line', phase: 'reserve', rows: 1, lines: [String(first)], source: { row: String(id) } }]);
    const second = await line('order_lines', id, 1, '1');
    const found = await receipts('line', id);
    expect(found.map((receipt) => `${String(receipt.line)}:${receipt.at}`)).toEqual([`${String(first)}:reserve:1:1`, `${String(second)}:reserve:1:1`]);
    // The receipt names the line's table as stored, and keeps the time the ORDER carries.
    expect(found.every((receipt) => receipt.table !== '' && receipt.held)).toBe(true);
    expect(await w.count('ledger_kit_holds', `state = 'held' AND receipt_id IN (SELECT id FROM ledger_kit_postings WHERE source_row = '${String(id)}')`)).toBe(2);
  });

  it.skipIf(!available)('moving the order hands every line over in one call, each with its own receipt; a voided line is left out of it', async () => {
    const id = await order('placed');
    const a = await line('order_lines', id, 1, '2');
    const b = await line('order_lines', id, 1, '3');
    // Made voided: never held, never handed over — and its account may be anything.
    const gone = Number((await w.create('order_lines', { order_id: id, voided_at: 'yesterday' }))['id']);
    expect(w.posted()).toEqual([]);
    const before = await taken(1);
    await w.update('orders', id, { status: 'picked_up' });
    const calls = w.posted();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ posting: 'line', phase: 'post', source: { row: String(id) } });
    expect(calls[0]!.lines.sort()).toEqual([String(a), String(b)].sort());
    expect(await taken(1)).toBe(before + 5);
    const found = await receipts('line', id);
    expect(found.filter((receipt) => receipt.at.startsWith('post')).map((receipt) => receipt.line).sort()).toEqual([a, b].sort());
    expect(found.some((receipt) => receipt.line === gone)).toBe(false);
    // Taken for good: no receipt of the order keeps a time any longer.
    expect(found.some((receipt) => receipt.held)).toBe(false);
  });

  it.skipIf(!available)('cancelling the order gives every line back in one call, and a second cancel writes nothing', async () => {
    const id = await order('placed');
    await line('order_lines', id, 1, '2');
    await line('order_lines', id, 1, '3');
    const start = await held();
    await w.update('orders', id, { status: 'cancelled' });
    expect(w.posted()).toHaveLength(1);
    expect(w.posted()[0]).toMatchObject({ phase: 'reverse' });
    expect(w.posted()[0]!.lines).toHaveLength(2);
    expect(await held()).toBe(start - 2);
    const count = await w.count('ledger_kit_postings');
    await w.update('orders', id, { status: 'placed' });
    await w.update('orders', id, { status: 'cancelled' });
    expect(w.posted()).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(count);
  });

  it.skipIf(!available)('an order whose third line is short writes nothing, and names the line', async () => {
    const id = await order('draft');
    await line('order_extras', id, 1, '1');
    await line('order_extras', id, 1, '1');
    await line('order_extras', id, 2, '50');
    const before = { holds: await w.count('ledger_kit_holds'), receipts: await w.count('ledger_kit_postings') };
    const error = await refusal(w.update('orders', id, { status: 'placed' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'extra', line: 2, item: 'Sugar' } });
    expect((await w.h.rows(`SELECT status FROM orders WHERE id = ${String(id)}`))[0]).toMatchObject({ status: 'draft' });
    expect({ holds: await w.count('ledger_kit_holds'), receipts: await w.count('ledger_kit_postings') }).toEqual(before);
  });

  it.skipIf(!available)('a line made after the order\'s lines were held is held in the save that makes it; under an order not yet placed, nothing is', async () => {
    const id = await order('draft');
    const early = await line('order_extras', id, 1, '1');
    // Not placed: the order's point has not been reached, so making a line hands nothing over.
    expect(w.posted()).toEqual([]);
    expect(await receipts('extra', id)).toEqual([]);
    await w.update('orders', id, { status: 'placed' });
    expect((await receipts('extra', id)).map((receipt) => `${String(receipt.line)}:${receipt.at}`)).toEqual([`${String(early)}:reserve:1:1`]);
    // A line added now: its siblings' round is open, so it is held too — it alone.
    const late = await line('order_extras', id, 1, '2');
    expect(w.posted()).toMatchObject([{ posting: 'extra', phase: 'reserve', lines: [String(late)] }]);
    expect((await receipts('extra', id)).map((receipt) => `${String(receipt.line)}:${receipt.at}`)).toEqual([`${String(early)}:reserve:1:1`, `${String(late)}:reserve:1:1`]);
    // And a late line that is short is refused: the line is not made.
    const lines = await w.count('order_extras');
    expect(await refusal(line('order_extras', id, 2, '50', GUEST))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock' } });
    expect(await w.count('order_extras')).toBe(lines);
    // Picked up: both lines are taken in the one call.
    await w.update('orders', id, { status: 'picked_up' });
    expect(w.posted()[0]!.lines.sort()).toEqual([String(early), String(late)].sort());
  });

  it.skipIf(!available)('while a line is held, what was read of it is frozen — its quantity, its item, its order, its void, the order\'s time — and it may not go', async () => {
    const id = await order('placed', { hold_until: '2031-05-06T07:08:00.000Z' });
    const other = await order('placed');
    const held = await line('order_lines', id, 1, '2');
    for (const [column, value] of Object.entries({ qty: '5', account_id: 2, order_id: other, voided_at: 'now' })) {
      expect(await refusal(w.update('order_lines', held, { [column]: value })), column).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'mapped-changed', posting: 'line', column } });
    }
    // The order's own column the rule reads through the line is frozen on the order.
    expect(await refusal(w.update('orders', id, { hold_until: '2032-01-01T00:00:00.000Z' }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'mapped-changed', posting: 'line', column: 'hold_until' } });
    // Sent again as it is, a frozen column is no change.
    await w.update('order_lines', held, { qty: '2' });
    // Neither the line nor its order may go.
    const gone = (table: string, pk: number) => w.writes.delete({ target: w.target(table), pk: { id: pk }, context: DESK, announce: async () => undefined });
    expect(await refusal(gone('order_lines', held))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'receipt-open', posting: 'line' } });
    expect(await refusal(gone('orders', id))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'receipt-open', posting: 'line' } });
    expect(await w.count('order_lines', `id = ${String(held)}`)).toBe(1);
    // Put back first: the order cancelled, the line is free again — to change, and to go.
    await w.update('orders', id, { status: 'cancelled' });
    await w.update('order_lines', held, { qty: '5' });
    expect(await gone('order_lines', held)).toBe(1);
    // A line never held (its order holds nothing of it) changes freely.
    const free = await line('order_lines', other, 1, '1', DESK, { voided_at: 'made void' });
    await w.update('order_lines', free, { qty: '9' });
    expect(await gone('order_lines', free)).toBe(1);
  });

  it.skipIf(!available)('what the rule refuses outright is refused before the add-on is asked: a row of the same order in another table', async () => {
    const id = await order('draft');
    await line('order_extras', id, 1, '1');
    const voided = Number((await w.create('order_lines', { order_id: id, voided_at: 'yesterday' }))['id']);
    // The add-on would throw if it were asked.
    await w.misbehave('throw');
    try {
      expect(await refusal(w.update('orders', id, { status: 'placed' }))).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'card-pays-card', posting: 'extra' } });
    } finally {
      await w.misbehave(null);
    }
    // Without that row the same order is placed.
    await w.h.rows(`DELETE FROM order_lines WHERE id = ${String(voided)}`);
    await w.update('orders', id, { status: 'placed' });
    expect(w.posted()).toMatchObject([{ posting: 'extra', phase: 'reserve' }]);
  });

  /** An order made with its lines in one save, as a form or a guest's checkout sends it. */
  const tree = (status: string, lines: { table: string; values: Record<string, unknown> }[], context = DESK) => {
    const outcome: { error?: unknown; path?: readonly (string | number)[] } = {};
    const counted = new Map<string, number>();
    const run = w.writes.createTree({
      root: {
        name: 'orders',
        target: w.target('orders'),
        values: { status },
        at: [],
        children: lines.map((entry) => {
          const index = counted.get(entry.table) ?? 0;
          counted.set(entry.table, index + 1);
          return { name: entry.table, target: w.target(entry.table), values: entry.values, via: { column: 'order_id', parentKey: 'id' }, at: [entry.table, index], children: [] };
        }),
      },
      context,
      mode: 'save',
      announce: async () => undefined,
      mapError: (error, at) => {
        outcome.error = error;
        outcome.path = at;
        throw error;
      },
    });
    return { run, outcome };
  };

  it.skipIf(!available)('an order made with its lines in one save: the lines of one rule are one call, each with its receipt', async () => {
    const before = await held();
    const made = await tree('placed', [
      { table: 'order_lines', values: { account_id: 1, qty: '2' } },
      { table: 'order_lines', values: { account_id: 1, qty: '1' } },
      // An extra is held when the order is placed — and this one is made placed.
      { table: 'order_extras', values: { account_id: 1, qty: '4' } },
    ]).run;
    const id = Number(made.root['id']);
    expect(made.postings?.map((call) => `${call.posting}:${call.phase}:${String(call.lines.length)}`).sort()).toEqual(['extra:reserve:1', 'line:reserve:2']);
    expect(await held()).toBe(before + 3);
    expect((await receipts('line', id)).map((receipt) => receipt.at)).toEqual(['reserve:1:1', 'reserve:1:1']);
    expect((await receipts('extra', id)).map((receipt) => receipt.at)).toEqual(['reserve:1:1']);
    // Every receipt is under the order that was just made, by its real key.
    expect(await w.count('ledger_kit_postings', `source_row = '${String(id)}' AND source_line <> ''`)).toBe(3);
  });

  it.skipIf(!available)('a tree whose third line is short writes nothing — not the order, not the other lines — and names the line', async () => {
    const before = { orders: await w.count('orders'), lines: await w.count('order_lines'), holds: await w.count('ledger_kit_holds'), receipts: await w.count('ledger_kit_postings') };
    const { run, outcome } = tree(
      'placed',
      [
        { table: 'order_lines', values: { account_id: 1, qty: '1' } },
        { table: 'order_lines', values: { account_id: 1, qty: '1' } },
        { table: 'order_lines', values: { account_id: 2, qty: '50' } },
      ],
      GUEST,
    );
    expect(await refusal(run)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'line', line: 2, path: ['order_lines', 2], item: 'Sugar' } });
    // The door is told where: the third row of that list.
    expect(outcome.path).toEqual(['order_lines', 2]);
    expect({ orders: await w.count('orders'), lines: await w.count('order_lines'), holds: await w.count('ledger_kit_holds'), receipts: await w.count('ledger_kit_postings') }).toEqual(before);
  });

  it.skipIf(!available)('a tree whose rows hand nothing over is saved as ever; a voided line in it is left out', async () => {
    const receiptsBefore = await w.count('ledger_kit_postings');
    const quiet = await tree('draft', [{ table: 'order_extras', values: { account_id: 1, qty: '1' } }]).run;
    expect(quiet.postings).toBeUndefined();
    const mixed = await tree('draft', [
      { table: 'order_lines', values: { account_id: 1, qty: '1' } },
      { table: 'order_lines', values: { voided_at: 'made void' } },
    ]).run;
    expect(mixed.postings).toMatchObject([{ posting: 'line', phase: 'reserve' }]);
    expect(mixed.postings![0]!.lines).toHaveLength(1);
    expect(await w.count('ledger_kit_postings')).toBe(receiptsBefore + 1);
  });

  it.skipIf(!available)('a line moved under another order is held by that order\'s round, and stays frozen there', async () => {
    const a = await order('placed');
    const b = await order('placed');
    const moved = await line('order_lines', a, 1, '2');
    await line('order_lines', b, 1, '1');
    // Given back under A: free to move.
    await w.update('orders', a, { status: 'cancelled' });
    await w.update('order_lines', moved, { order_id: b });
    // B's lines are held: the one that joins them is held in the save that moves it.
    expect(w.posted()).toMatchObject([{ posting: 'line', phase: 'reserve', source: { row: String(b) }, lines: [String(moved)] }]);
    // And B's hold freezes it, whatever its receipts under A say.
    expect(await refusal(w.update('order_lines', moved, { qty: '9' }))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'mapped-changed', column: 'qty' } });
    expect(await refusal(w.writes.delete({ target: w.target('order_lines'), pk: { id: moved }, context: DESK, announce: async () => undefined }))).toMatchObject({ details: { reason: 'receipt-open' } });
  });

  it.skipIf(!available)('a line no longer left out joins its siblings: held in the save that un-voids it', async () => {
    const id = await order('placed');
    await line('order_lines', id, 1, '1');
    const back = Number((await w.create('order_lines', { order_id: id, account_id: 1, qty: '2', voided_at: 'made void' }))['id']);
    expect(w.posted()).toEqual([]);
    await w.update('order_lines', back, { voided_at: null });
    expect(w.posted()).toMatchObject([{ posting: 'line', phase: 'reserve', lines: [String(back)] }]);
    // Under an order none of whose lines is held, the same change hands nothing over.
    const quiet = await order('placed');
    const alone = Number((await w.create('order_lines', { order_id: quiet, account_id: 1, qty: '2', voided_at: 'made void' }))['id']);
    await w.update('order_lines', alone, { voided_at: null });
    expect(w.posted()).toEqual([]);
  });

  it.skipIf(!available)('every row of a tree that hands something over does: a root that is itself a line, a child under a row that was already there', async () => {
    const id = await order('placed');
    await line('order_lines', id, 1, '1');
    // A line made as the root of its own create-with-children (it has none): a line of an order that is there.
    const made = await w.writes.createTree({
      root: { name: 'order_lines', target: w.target('order_lines'), values: { order_id: id, account_id: 1, qty: '3' }, at: [], children: [] },
      context: DESK,
      mode: 'save',
      announce: async () => undefined,
      mapError: (error) => {
        throw error;
      },
    });
    expect(made.postings).toMatchObject([{ posting: 'line', phase: 'reserve', source: { row: String(id) }, lines: [String(made.root['id'])] }]);
  });

  it.skipIf(!available)('a line that belongs to no order hands nothing over', async () => {
    const receiptsBefore = await w.count('ledger_kit_postings');
    await w.create('order_lines', { account_id: 1, qty: '1' });
    expect(w.posted()).toEqual([]);
    expect(await w.count('ledger_kit_postings')).toBe(receiptsBefore);
  });
});
