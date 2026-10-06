// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT GOES WRONG ON THE ADD-ON'S SIDE IS TOLD TO AN OPERATOR, ONCE.
 *
 * A plan that fails a check, an add-on that cannot be asked, a table of the
 * ledger that cannot be written inside a save (project code changes its
 * rows, or it takes a lock of its own): each fails the whole save and leaves
 * one record of which check it was — the person saving is told only that
 * the add-on did not answer as it should. A plain "there is not enough"
 * leaves no record: that is the ledger working.
 */
import { overridesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NO_RECORD_HOOKS } from '../src/crud/write-service.js';
import type { LedgerRefusal } from '../src/ledgers/registry.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, GUEST, ledgerWorld, refusal, type LedgerWorld } from './ledger.helpers.js';

const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };
/** `use` writes holds too. */
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { create: true } } };
// (`count`, the tallies' action, lists `entries` alone.)

describe.each(LEGS)('a ledger\'s faults — %s', (dialect, available) => {
  let w: LedgerWorld;
  let events: LedgerRefusal[] = [];
  const told = (more = {}) => w.service({ refused: async (event) => void events.push(event) }, more);
  const counts = async () => ({ tallies: await w.count('tallies'), receipts: await w.count('ledger_kit_postings'), entries: await w.count('ledger_kit_entries') });

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, { tallies: { columns, postings: [TALLY] }, asks: { columns, postings: [ASK] } }, undefined, async (h, idOf) => {
      // The owner numbers the kit's holds without gaps: a series takes a lock of its own.
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.sequence', tableName: idOf('ledger_kit_holds'), columnName: 'amount', value: { gapless: true }, origin: 'user' } as never);
    });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await w.close();
  });

  it.skipIf(!available)('a plan that fails a check leaves one record, with the check it failed — which the person saving is never told', async () => {
    const before = await counts();
    const causes: Record<string, string> = { throw: 'threw', 'outside-table': 'scope-table', 'second-account': 'scope-row', 'stray-line': 'scope-row', 'too-much': 'scope-op' };
    try {
      for (const [how, cause] of Object.entries(causes)) {
        events = [];
        await w.misbehave(how);
        const error = await refusal(w.create('tallies', { account_id: 1, qty: '1' }, DESK, told()));
        expect(error, how).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed' } });
        expect(JSON.stringify(error.details), how).not.toContain(cause);
        expect(events, how).toHaveLength(1);
        expect(events[0], how).toMatchObject({ connectionId: w.h.connectionId, table: w.target('tallies').table.id, reason: 'planner-failed', cause, ledger: 'units', posting: 'tally', actor: { id: 'usr_ivy' } });
      }
    } finally {
      await w.misbehave(null);
    }
    expect(await counts()).toEqual(before);
  });

  it.skipIf(!available)('a door that words every refusal its own way still leaves the record: a guest is told nothing, an operator which check', async () => {
    events = [];
    const at = w.target('tallies');
    class Unnamed extends Error {}
    await w.misbehave('second-account');
    try {
      const run = told().create({
        target: at,
        values: { account_id: 1, qty: '1' },
        context: GUEST,
        mapError: () => {
          throw new Unnamed('refused');
        },
        announce: async () => undefined,
      });
      expect(await refusal(run)).toBeInstanceOf(Unnamed);
    } finally {
      await w.misbehave(null);
    }
    expect(events).toMatchObject([{ reason: 'planner-failed', cause: 'scope-row', posting: 'tally' }]);
  });

  it.skipIf(!available)('an add-on that cannot be asked leaves one record; a plain "not enough" leaves none', async () => {
    events = [];
    expect(await refusal(w.create('tallies', { account_id: 1, qty: '1' }, DESK, w.service({ decider: () => null, refused: async (event) => void events.push(event) })))).toMatchObject({ details: { reason: 'add-on-unavailable' } });
    expect(events).toMatchObject([{ reason: 'add-on-unavailable', posting: 'tally' }]);
    events = [];
    // The add-on's own no, and the cap on the account: the ledger working as it should.
    expect(await refusal(w.create('tallies', { account_id: 1, qty: '500' }, GUEST, told()))).toMatchObject({ details: { reason: 'out-of-stock' } });
    expect(await refusal(w.create('tallies', { account_id: 1, qty: '500' }, DESK, told()))).toMatchObject({ details: { reason: 'out-of-stock' } });
    expect(events).toEqual([]);
    // And a save that goes through leaves none.
    await w.create('tallies', { account_id: 1, qty: '1' }, DESK, told());
    expect(events).toEqual([]);
  });

  it.skipIf(!available)('a table of the ledger that project code changes cannot be posted to: refused by name before anything is written', async () => {
    const before = await counts();
    events = [];
    const hooked = told({ hooks: () => ({ ...NO_RECORD_HOOKS, wants: async (timing: string, action: string, target: { table: { name: string } }) => timing === 'before' && action === 'create' && target.table.name === 'ledger_kit_entries' }) });
    const error = await refusal(w.create('tallies', { account_id: 1, qty: '1' }, DESK, hooked));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'hooked', table: 'ledger_kit_entries', ledger: 'units', posting: 'tally' } });
    expect(events).toMatchObject([{ reason: 'hooked', ledgerTable: 'ledger_kit_entries' }]);
    expect(await counts()).toEqual(before);
    // A hook that only watches what was written stops nothing.
    const watching = told({ hooks: () => ({ ...NO_RECORD_HOOKS, wants: async (timing: string) => timing === 'after' }) });
    await w.create('tallies', { account_id: 1, qty: '1' }, DESK, watching);
    expect((await counts()).tallies).toBe(before.tallies + 1);
  });

  it.skipIf(!available)('a table of the ledger that takes a lock of its own cannot be posted to either', async () => {
    const asks = await w.count('asks');
    events = [];
    // `use` may write holds, which the owner numbered without gaps.
    const error = await refusal(w.create('asks', { account_id: 1, qty: '1' }, DESK, told()));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'guarded', table: 'ledger_kit_holds', posting: 'ask' } });
    expect(events).toMatchObject([{ reason: 'guarded', ledgerTable: 'ledger_kit_holds' }]);
    expect(await w.count('asks')).toBe(asks);
    // `count` writes entries alone: the holds' series is not in its way.
    await w.create('tallies', { account_id: 1, qty: '1' });
  });
});
