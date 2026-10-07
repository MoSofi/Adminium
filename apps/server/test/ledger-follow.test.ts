// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A ROW AN ADD-ON'S ANSWER CHANGED IS FOLLOWED LIKE ONE A PERSON CHANGED.
 *
 * A column that keeps a copy of another row in step (`copy … follow`) is
 * brought into step when that row changes. When the change is an add-on's
 * answer — a hold taken as its request is done — the copies follow in the
 * same save, so no screen reads the old word beside the new one.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from './invoicing-install.helpers.js';
import { ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } }, reverse: { on: { column: 'status', in: ['cancelled'] } } };

describe.each(LEGS)('copies follow a row an add-on\'s answer changed — %s', (dialect, available) => {
  let w: LedgerWorld;
  const noteOf = async (id: unknown) => (await w.h.rows(`SELECT hold_state FROM hold_notes WHERE id = ${String(id)}`))[0]!['hold_state'];

  beforeAll(async () => {
    if (!available) return;
    w = await ledgerWorld(
      dialect,
      {
        asks: { columns: 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL', postings: [ASK] },
        // A note about a hold, which says what state its hold is in. (The link is its own line: MySQL reads no other.)
        hold_notes: { columns: 'hold_id INT NULL, hold_state VARCHAR(20) NULL, FOREIGN KEY (hold_id) REFERENCES ledger_kit_holds(id)', postings: [] },
      },
      undefined,
      async (h, idOf) => {
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.copy', tableName: idOf('hold_notes'), columnName: 'hold_state', value: { via: 'hold_id', from: 'state', mode: 'always', follow: true }, origin: 'user' } as never);
      },
    );
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a hold the ledger takes reads "taken" on the note that copies its state, in the same save', async () => {
    const ask = await w.create('asks', { account_id: 1, qty: '2', status: 'sent' });
    const hold = (await w.h.rows('SELECT id, state FROM ledger_kit_holds ORDER BY id DESC'))[0]!;
    expect(hold['state']).toBe('held');
    const note = await w.create('hold_notes', { hold_id: hold['id'] });
    expect(await noteOf(note['id'])).toBe('held');

    // The request is done: the add-on's answer moves the hold, and the note follows it.
    await w.update('asks', ask['id'], { status: 'done' });
    expect((await w.h.rows(`SELECT state FROM ledger_kit_holds WHERE id = ${String(hold['id'])}`))[0]!['state']).toBe('taken');
    expect(await noteOf(note['id'])).toBe('taken');
  });

  it.skipIf(!available)('and a hold the ledger lets go reads "released" there too', async () => {
    const ask = await w.create('asks', { account_id: 1, qty: '1', status: 'sent' });
    const hold = (await w.h.rows('SELECT id FROM ledger_kit_holds ORDER BY id DESC'))[0]!;
    const note = await w.create('hold_notes', { hold_id: hold['id'] });
    await w.update('asks', ask['id'], { status: 'cancelled' });
    expect(await noteOf(note['id'])).toBe('released');
  });
});
