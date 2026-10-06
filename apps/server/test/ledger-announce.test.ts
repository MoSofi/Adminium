// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A POSTING DID IS TOLD AFTER ITS SAVE.
 *
 * One audit row a call, about the row that posted — however many rows of
 * the ledger it wrote. The ledger's own rows are events only when something
 * listens to their table; a row the plan changed is told with the row as it
 * was. A figure of another row that the posting moved (an account turning
 * low) is told as a change of that row nobody made by hand: an event that
 * says `settled`, and no audit row of its own.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { occurrenceKeyFor } from '../src/automations/matcher.js';
import { announcePostings } from '../src/ledgers/announce.js';
import { LEGS } from './invoicing-install.helpers.js';
import { DESK, ledgerWorld, type LedgerWorld } from './ledger.helpers.js';

const TALLY = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };
const ASK = { id: 'ask', into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' }, map: { account: 'account_id', quantity: 'qty' }, reserve: { on: { column: 'status', in: ['sent'] } }, post: { on: { column: 'status', in: ['done'] } } };

describe.each(LEGS)('what a posting did, told after — %s', (dialect, available) => {
  let w: LedgerWorld;
  let app: FastifyInstance;
  let events: RecordWriteEvent[] = [];
  const tell = async (watched: readonly string[] = []) => {
    events = [];
    await announcePostings(app, { connectionId: w.h.connectionId, view: w.target('tallies').view, postings: w.posted(), origin: 'dashboard', actor: { id: 'usr_ivy', label: 'Ivy', kind: 'user' }, watches: async (_connection, tableId) => watched.some((name) => tableId.endsWith(name)), manager: w.h.manager, meta: w.h.meta });
  };
  const audits = async () => (await w.h.meta.db.selectFrom('adminium_audit_log').select(['action', 'entityTable', 'changes']).orderBy('createdAt').orderBy('id').execute()).map((row) => ({ action: row.action, table: row.entityTable, after: (JSON.parse(String(row.changes)) as { after: Record<string, unknown> }).after }));

  beforeAll(async () => {
    if (!available) return;
    const columns = 'account_id INT NULL, qty DECIMAL(12,3) NULL, status VARCHAR(20) NULL';
    w = await ledgerWorld(dialect, { tallies: { columns, postings: [TALLY] }, asks: { columns, postings: [ASK] } });
    await w.h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at, low) VALUES (1, 'Flour', 10, 0, 10, ${w.flag(false)}, 2, 0), (2, 'Sugar', 100, 0, 100, ${w.flag(false)}, 1, 0)`);
    app = Fastify();
    // What hears a record's change on a real server: the rules.
    app.decorate('automations', { onRecordEvent: async (event: RecordWriteEvent) => void events.push(event) } as never);
    await app.ready();
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await app.close();
    await w.close();
  });

  it.skipIf(!available)('one audit row a call, about the row that posted; the ledger\'s rows are events only when something listens', async () => {
    const before = (await audits()).filter((row) => row.action.startsWith('ledger.')).length;
    const tally = await w.create('tallies', { account_id: 2, qty: '3' }, DESK);
    await tell();
    const told = (await audits()).filter((row) => row.action.startsWith('ledger.'));
    expect(told).toHaveLength(before + 1);
    expect(told.at(-1)).toMatchObject({ action: 'ledger.posted', after: { addOn: 'ledger-kit', ledger: 'units', action: 'count', posting: 'tally', phase: 'post', round: 1, rows: 1, version: '1.0.0' } });
    expect(String(told.at(-1)!.table)).toContain('tallies');
    // Nobody listens to the entries: no event.
    expect(events).toEqual([]);
    // Somebody does: the entry is a row made, like any other.
    await tell(['ledger_kit_entries']);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'create', before: null, origin: 'dashboard' });
    expect(events[0]!.table.name).toBe('ledger_kit_entries');
    expect(Number(events[0]!.after!['amount'])).toBe(3);

    // Given back: told as that.
    await w.update('tallies', Number(tally['id']), { status: 'void' });
    await tell();
    expect((await audits()).at(-1)).toMatchObject({ action: 'ledger.reversed', after: { phase: 'reverse', round: 1 } });
  });

  it.skipIf(!available)('a row the plan changed is told with the row as it was', async () => {
    const id = Number((await w.create('asks', { account_id: 2, qty: '1', status: 'draft' }))['id']);
    await w.update('asks', id, { status: 'sent' });
    await w.update('asks', id, { status: 'done' });
    await tell(['ledger_kit_holds']);
    const hold = events.find((event) => event.table.name === 'ledger_kit_holds')!;
    expect(hold).toMatchObject({ action: 'update', before: { state: 'held' }, after: { state: 'taken' } });
  });

  it.skipIf(!available)('an account turning low is told as a change of the account nobody made: an event that says settled, and no audit row', async () => {
    // A take that leaves plenty moves no announced figure…
    await w.create('tallies', { account_id: 1, qty: '1' });
    expect(w.posted()[0]!.announced ?? []).toEqual([]);
    // …the one that leaves little turns the account low, in the same save.
    await w.create('tallies', { account_id: 1, qty: '8' });
    const moved = w.posted()[0]!.announced!;
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ changed: ['low'], pk: { id: 1 } });
    expect(Number(moved[0]!.was['low'])).toBe(0);
    const before = await audits();
    await tell();
    const settled = events.filter((event) => event.cause === 'settled');
    expect(settled).toHaveLength(1);
    expect(settled[0]!.table.name).toBe('ledger_kit_accounts');
    expect(settled[0]).toMatchObject({ action: 'update', entity: { pk: { id: 1 } } });
    expect([Number(settled[0]!.before!['low']), Number(settled[0]!.after!['low'])]).toEqual([0, 1]);
    // Such a change has nothing to be heard once by: each is its own occurrence.
    expect(occurrenceKeyFor('rule_1', settled[0]!)).toBeNull();
    // Beside the posting's own row, nothing is written to the audit log for the account.
    const added = (await audits()).slice(before.length);
    expect(added.map((row) => row.action)).toEqual(['ledger.posted']);
    // Already low: the next take moves the figure no further, and tells of none.
    await w.create('tallies', { account_id: 1, qty: '0.1' });
    expect(w.posted()[0]!.announced ?? []).toEqual([]);
  });

  it.skipIf(!available)('a quote tells nothing; a call nobody planned says so', async () => {
    const before = (await audits()).length;
    await announcePostings(app, { connectionId: w.h.connectionId, view: w.target('tallies').view, postings: [{ ...w.posted()[0]!, quote: { state: 'ok' } }], origin: 'dashboard', watches: async () => true, manager: w.h.manager, meta: w.h.meta });
    expect((await audits()).length).toBe(before);
    await announcePostings(app, { connectionId: w.h.connectionId, view: w.target('tallies').view, postings: [{ ...w.posted()[0]!, state: 'unplanned', rows: 0, written: [], announced: [] }], origin: 'automation', watches: async () => false, manager: w.h.manager, meta: w.h.meta });
    expect((await audits()).at(-1)).toMatchObject({ action: 'ledger.posted', after: { state: 'unplanned', rows: 0 } });
  });
});
