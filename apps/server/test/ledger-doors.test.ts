// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE DOORS THAT CANNOT POST SAY SO.
 *
 * A posting is made by a save of ONE row: its locks are named from that
 * row, its plan is for that row. A door that writes many rows at once — a
 * bulk edit, an undo, a form's child rows, a batch, an import's change of a
 * stored row — or a save inside a transaction somebody else opened, cannot
 * do that. It never writes the row unposted: it refuses by name
 * (`one-at-a-time`), and the same change made one row at a time goes
 * through. Rows brought in as history (an import's new rows) hand nothing
 * over and are not refused.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } } };
const ONE = { code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'one-at-a-time' } };
const IMPORT: WriteContext = { origin: 'import', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
const BULK: WriteContext = { ...DESK, origin: 'bulk' };
const UNDO: WriteContext = { ...DESK, origin: 'undo' };

describe.each(LEGS)('the doors that cannot post — %s', (dialect, available) => {
  let w: LedgerWorld;
  const ask = async (status = 'draft') => Number((await w.create('asks', { account_id: 1, qty: '1', status }))['id']);
  const held = async () => {
    const id = await ask();
    await w.update('asks', id, { status: 'sent' });
    return id;
  };
  const many = (action: 'create' | 'update' | 'delete', table: string, rows: { match?: Record<string, unknown>; values: Record<string, unknown> }[], context: WriteContext = BULK, opts = {}) =>
    w.writes.beforeEach(action, w.target(table), context, rows, opts);

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, note VARCHAR(40) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, { tallies: { columns, postings: [TALLY] }, asks: { columns, postings: [ASK] }, plain: { columns, postings: [] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 1000, 0, 1000, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a bulk move to a posting state is refused, one at a time — and a bulk change that crosses nothing is not', async () => {
    const [a, b] = [await ask(), await ask()];
    expect(await refusal(many('update', 'asks', [{ match: { id: a }, values: { status: 'sent' } }, { match: { id: b }, values: { status: 'sent' } }]))).toMatchObject({ ...ONE, details: { reason: 'one-at-a-time', posting: 'ask' } });
    const prepared = await many('update', 'asks', [{ match: { id: a }, values: { note: 'seen' } }, { match: { id: b }, values: { note: 'seen' } }]);
    expect(prepared.map((row) => row.issues)).toEqual([null, null]);
    // A table with no rule is as ever.
    expect((await many('update', 'plain', [{ match: { id: 1 }, values: { status: 'sent' } }])).map((row) => row.issues)).toEqual([null]);
  });

  it.skipIf(!available)('rows made many at once are refused when making one would post', async () => {
    expect(await refusal(many('create', 'tallies', [{ values: { account_id: 1, qty: '1' } }, { values: { account_id: 1, qty: '2' } }]))).toMatchObject({ ...ONE, details: { reason: 'one-at-a-time', posting: 'tally' } });
    // An ask is made in a state no point names: making many is fine.
    expect((await many('create', 'asks', [{ values: { account_id: 1, qty: '1', status: 'draft' } }])).map((row) => row.issues)).toEqual([null]);
    // And one made already sent is not.
    expect(await refusal(many('create', 'asks', [{ values: { account_id: 1, qty: '1', status: 'sent' } }]))).toMatchObject(ONE);
  });

  it.skipIf(!available)('an undo that would change what an open posting read, or cross a point, is refused', async () => {
    const id = await held();
    // An undo judges nothing of its own — the posting still does.
    expect(await refusal(many('update', 'asks', [{ match: { id }, values: { qty: '7' } }], UNDO, { rules: false }))).toMatchObject({ ...ONE, details: { reason: 'one-at-a-time', posting: 'ask' } });
    // …and one that would cross a point (the round given back) is refused the same way.
    expect(await refusal(many('update', 'asks', [{ match: { id }, values: { status: 'cancelled' } }], UNDO, { rules: false }))).toMatchObject({ ...ONE });
    // Putting a note back is nothing to a ledger.
    expect((await many('update', 'asks', [{ match: { id }, values: { note: 'as before' } }], UNDO, { rules: false })).map((row) => row.issues)).toEqual([null]);
  });

  it.skipIf(!available)('a row with an open posting is not deleted through a door of many', async () => {
    const id = await held();
    const free = await ask();
    expect(await refusal(many('delete', 'asks', [{ match: { id }, values: {} }]))).toMatchObject({ ...ONE, details: { reason: 'one-at-a-time', posting: 'ask' } });
    expect((await many('delete', 'asks', [{ match: { id: free }, values: {} }])).map((row) => row.issues)).toEqual([null]);
  });

  it.skipIf(!available)('an import brings rows in as history — no posting, no refusal — and a change of a stored row that would post is that row\'s own refusal', async () => {
    const receipts = await w.count('ledger_kit_postings');
    // New rows, through the import's own check: taken as they are.
    const checked = await w.writes.check('create', w.target('tallies'), IMPORT, [{ account_id: 1, qty: '1' }, { account_id: 1, qty: '2' }], { capacity: 'unchecked' });
    expect(checked.issues).toEqual([null, null]);
    expect(await w.count('ledger_kit_postings')).toBe(receipts);
    // The same check for rows that are NOT history: each that would post is its own refusal, and nothing is written for it.
    const judged = await w.writes.check('create', w.target('tallies'), IMPORT, [{ account_id: 1, qty: '1' }]);
    expect(judged).toEqual({ rows: [null], issues: [{ row: { code: 'one-at-a-time' } }] });
    // A stored row moved by an import: that row is refused, the next one goes on.
    const [a, b] = [await ask(), await ask()];
    const prepared = await many('update', 'asks', [{ match: { id: a }, values: { status: 'sent' } }, { match: { id: b }, values: { note: 'imported' } }], IMPORT, { capacity: 'unchecked' });
    expect(prepared[0]!.issues).toEqual({ row: { code: 'one-at-a-time' } });
    expect(prepared[1]!.issues).toBeNull();
    // What an open round froze, changed by an import: refused on its column.
    const frozen = await held();
    expect((await many('update', 'asks', [{ match: { id: frozen }, values: { qty: '9' } }], IMPORT, { capacity: 'unchecked' }))[0]!.issues).toEqual({ qty: { code: 'one-at-a-time' } });
  });

  it.skipIf(!available)('a save inside a transaction somebody else opened is refused when it would post, and goes on when it would not', async () => {
    const tallies = w.target('tallies');
    const before = await w.count('tallies');
    const inside = w.writes.transaction(tallies, [], async (db) => {
      await w.writes.create({ target: { ...tallies, db }, values: { account_id: 1, qty: '1' }, context: DESK, announce: async () => undefined });
    });
    expect(await refusal(inside)).toMatchObject({ ...ONE, details: { reason: 'one-at-a-time', posting: 'tally' } });
    expect(await w.count('tallies')).toBe(before);
    // A change that would post, the same; one that crosses nothing goes through with its caller's transaction.
    const asks = w.target('asks');
    const id = await ask();
    expect(await refusal(w.writes.transaction(asks, [], async (db) => void (await w.writes.update({ target: { ...asks, db }, pk: { id }, values: { status: 'sent' }, context: DESK, announce: async () => undefined }))))).toMatchObject(ONE);
    await w.writes.transaction(asks, [], async (db) => void (await w.writes.update({ target: { ...asks, db }, pk: { id }, values: { note: 'inside' }, context: DESK, announce: async () => undefined })));
    expect((await w.h.rows(`SELECT note, status FROM asks WHERE id = ${String(id)}`))[0]).toMatchObject({ note: 'inside', status: 'draft' });
    // Made on its own, the refused change goes through.
    await w.update('asks', id, { status: 'sent' });
    expect(await w.receiptsOf('ask', id)).toEqual(['reserve:1:planned:1']);
    // Now that it holds something, what the round read of it is kept inside somebody's transaction too.
    const frozen = w.writes.transaction(asks, [], async (db) => void (await w.writes.update({ target: { ...asks, db }, pk: { id }, values: { qty: '9' }, context: DESK, announce: async () => undefined })));
    expect(await refusal(frozen)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'mapped-changed', column: 'qty' } });
    expect(Number((await w.h.rows(`SELECT qty FROM asks WHERE id = ${String(id)}`))[0]!['qty'])).toBe(1);
    await w.writes.transaction(asks, [], async (db) => void (await w.writes.update({ target: { ...asks, db }, pk: { id }, values: { note: 'still free' }, context: DESK, announce: async () => undefined })));
  });
});
