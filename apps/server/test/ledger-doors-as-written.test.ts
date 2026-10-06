// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A DOOR OF MANY ROWS JUDGES A ROW AS IT WILL BE WRITTEN.
 *
 * Rows written many at once post nothing, so one that would post is refused
 * by name. Whether it would is read off the row as it is WRITTEN, not as it
 * was sent: a row made with no state takes the state its table starts in; a
 * move stamps the moment a rule fires on. Judged as sent, both would be
 * stored with nothing handed to the ledger.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WriteContext } from '../src/crud/write-context.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const UNITS = { addOn: 'ledger-kit', ledger: 'units' };
/** Held as soon as a request is "sent" — which is how a new one starts. */
const ASK = { id: 'ask', into: { ...UNITS, action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } } };
/** Taken when the row is stamped as counted: the stamp is Adminium's, set by the move to "counted". */
const TALLY = { id: 'tally', into: { ...UNITS, action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { column: 'counted_at', set: true } } };
const BULK: WriteContext = { ...DESK, origin: 'bulk' };
const IMPORT: WriteContext = { ...DESK, origin: 'import' };

describe.each(LEGS)('a door of many rows judges a row as it will be written — %s', (dialect, available) => {
  let w: LedgerWorld;
  const moment = dialect === 'postgres' ? 'TIMESTAMPTZ' : dialect === 'mysql' ? 'DATETIME' : 'TEXT';

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      {
        asks: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [ASK] },
        tallies: { columns: `account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL, counted_at ${moment} NULL`, postings: [TALLY] },
        // The database's own default: nothing of Adminium's says a new slip is "sent".
        slips: { columns: "account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NOT NULL DEFAULT 'sent'", postings: [{ ...ASK, id: 'slip' }] },
      },
      undefined,
      async (h, idOf) => {
        const rule = (table: string, column: string, op: string, value: Record<string, unknown>) => overridesRepo(h.meta).create({ connectionId: h.connectionId, op, tableName: idOf(table), columnName: column, value, origin: 'user' } as never);
        // A new request starts as "sent" when nobody says otherwise.
        await rule('asks', 'status', 'column.default', { kind: 'literal', text: 'sent' });
        // A tally is stamped the moment it is counted.
        await rule('tallies', 'counted_at', 'column.stamp', { set: 'now', on: { column: 'status', values: ['counted'] } });
      },
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 1000, 0, 1000, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('rows made many at once with no state sent are refused when the state they start in posts', async () => {
    // A single save of the same row posts: that is the row these doors may not store unposted.
    await w.create('asks', { account_id: 1, qty: '1' });
    expect(w.posted()).toMatchObject([{ posting: 'ask', phase: 'reserve' }]);
    const before = await w.count('asks');
    expect(await refusal(w.writes.check('create', w.target('asks'), BULK, [{ account_id: 1, qty: '1' }]))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time', posting: 'ask' } });
    expect(await refusal(w.writes.beforeEach('create', w.target('asks'), BULK, [{ values: { account_id: 1, qty: '1' } }]))).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time' } });
    // An import's row that is no history: that row's own refusal, and the next goes on.
    const judged = await w.writes.check('create', w.target('asks'), IMPORT, [{ account_id: 1, qty: '1' }, { account_id: 1, qty: '1', status: 'draft' }]);
    expect(judged.issues).toEqual([{ row: { code: 'one-at-a-time' } }, null]);
    // One sent in a state that posts nothing is taken, as before.
    expect((await w.writes.check('create', w.target('asks'), BULK, [{ account_id: 1, qty: '1', status: 'draft' }])).issues).toEqual([null]);
    expect(await w.count('asks')).toBe(before);
  });

  it.skipIf(!available)('a change of many rows is refused when what it stamps is the point: the move alone names nothing the rule watches', async () => {
    const id = Number((await w.create('tallies', { account_id: 1, qty: '2', status: 'new' }))['id']);
    expect(w.posted()).toEqual([]);
    const error = await refusal(w.writes.beforeEach('update', w.target('tallies'), BULK, [{ match: { id }, values: { status: 'counted' } }]));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time', posting: 'tally' } });
    // A change that stamps nothing is taken; and the same move as a single save posts.
    expect((await w.writes.beforeEach('update', w.target('tallies'), BULK, [{ match: { id }, values: { qty: '3' } }]))[0]!.issues).toBeNull();
    await w.update('tallies', id, { status: 'counted' });
    expect(w.posted()).toMatchObject([{ posting: 'tally', phase: 'post', rows: 1 }]);
  });

  it.skipIf(!available)('a row the database itself puts in a state that posts is posted, not stored with nothing handed over', async () => {
    // The look before the locks sees no state; the row as stored is "sent".
    const id = Number((await w.create('slips', { account_id: 1, qty: '2' }))['id']);
    expect(w.posted()).toMatchObject([{ posting: 'slip', phase: 'reserve', rows: 1 }]);
    expect(await w.receiptsOf('slip', id)).toEqual(['reserve:1:planned:1']);
    expect(await w.count('slips')).toBe(1);
    // Inside somebody's transaction the row cannot be taken back and made again: refused, as any row that posts there.
    const slips = w.target('slips');
    const inside = w.writes.transaction(slips, [], async (db) => void (await w.writes.create({ target: { ...slips, db }, values: { account_id: 1, qty: '1' }, context: DESK, announce: async () => undefined })));
    expect(await refusal(inside)).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'one-at-a-time' } });
    expect(await w.count('slips')).toBe(1);
    // A slip made in a state that posts nothing is stored once, with nothing handed over.
    await w.create('slips', { account_id: 1, qty: '1', status: 'draft' });
    expect(w.posted()).toEqual([]);
    expect(await w.count('slips')).toBe(2);
  });
});
