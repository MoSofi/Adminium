// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAVE THAT POSTS — an owner's rule on a table of their own hands each new
 * row to the test ledger, through the write service every door uses and the
 * add-on's real deciding file, on every engine this run can reach.
 *
 * The row, its receipt, the ledger's entry and the account's total go in
 * together or not at all: a refusal by the add-on's code, by the cap on the
 * account, or by Adminium's own checks on a plan that misbehaves, leaves
 * nothing behind — not the row that was being saved either.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadDecider } from '../src/add-ons/decide.js';
import { keepAddOnInstalls } from '../src/apps/table-ref.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { PlanFailed, type PostedOutcome } from '../src/crud/ledger-write.js';
import type { WriteContext, WriteTarget } from '../src/crud/write-context.js';
import { createWriteService, type RecordWriteService } from '../src/crud/write-service.js';
import { writeStores } from '../src/crud/write-stores.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { createLedgerRuntime } from '../src/ledgers/registry.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { LEDGER_KIT_SERVER, ledgerKitFiles, ledgerKitManifest } from './fixtures/ledger-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

// The server refuses a table with a posting until every door knows postings; this file is the write path's own proof.
const RULE = { id: 'tally', into: { addOn: 'ledger-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } }, reverse: { on: { column: 'status', in: ['void'] } } };
/** A request by hand: held when it is sent, taken when it is done, given back when it is cancelled. */
const ASK = {
  id: 'ask',
  into: { addOn: 'ledger-kit', ledger: 'units', action: 'use' },
  map: { account: 'account_id', quantity: 'qty', note: 'note' },
  reserve: { on: { column: 'status', in: ['sent'] } },
  post: { on: { column: 'status', in: ['done'] } },
  reverse: { on: { column: 'status', in: ['cancelled'] } },
};
const ELSEWHERE = { id: 'ghost', into: { addOn: 'ghost-kit', ledger: 'units', action: 'count' }, map: { account: 'account_id', quantity: 'qty' }, post: { on: { create: true } } };

describe.each(LEGS)('a save that posts — %s', (dialect, available) => {
  let h: Harness;
  let writes: RecordWriteService;
  let bare: RecordWriteService;
  let deaf: RecordWriteService;
  let moved: RecordWriteService;
  let target: (name: string) => WriteTarget;
  const desk: WriteContext = { origin: 'dashboard', hops: 0, actor: { kind: 'user', id: 'usr_ivy', label: 'Ivy' }, request: null };
  const guest: WriteContext = { origin: 'public', hops: 0, actor: { kind: 'public', id: null, label: 'guest' }, request: null };
  const t = (on: boolean) => (dialect === 'postgres' ? String(on) : on ? '1' : '0');
  const q = (name: string) => (dialect === 'mysql' ? `\`${name}\`` : `"${name}"`);
  const count = async (table: string, where = '1 = 1') => Number((await h.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))[0]!['n']);
  const account = async (id: number) => {
    const row = (await h.rows(`SELECT taken, balance FROM ledger_kit_accounts WHERE id = ${String(id)}`))[0]!;
    return { taken: Number(row['taken']), balance: Number(row['balance']) };
  };
  const misbehave = (how: string | null) => h.rows(`UPDATE ledger_kit_settings SET misbehave = ${how === null ? 'NULL' : `'${how}'`}`);
  let posted: PostedOutcome[] = [];
  const create = (name: string, values: Record<string, unknown>, context = desk, service = writes) => {
    const at = target(name);
    posted = [];
    return service.create({
      target: at,
      values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, normalizeWriteValue(at.table.columns.get(k)!, v)])),
      context,
      announce: async (_row, _values, outcomes) => {
        posted = [...(outcomes ?? [])];
      },
    });
  };
  const update = (name: string, id: unknown, values: Record<string, unknown>, context = desk, service = writes) => {
    posted = [];
    return service.update({
      target: target(name),
      pk: { id },
      values,
      context,
      announce: async (outcome) => {
        posted = [...(outcome.postings ?? [])];
      },
    });
  };
  const receiptsOf = async (table: string, id: unknown) =>
    (await h.rows(`SELECT phase, round, state, ${q('rows')} AS n FROM ledger_kit_postings WHERE source_row = '${String(id)}' AND posting = '${table}' ORDER BY id`)).map((row) => `${String(row['phase'])}:${String(row['round'])}:${String(row['state'])}:${String(row['n'])}`);
  const refusal = async (run: Promise<unknown>) => {
    try {
      await run;
    } catch (error) {
      return error as { code?: string; details?: Record<string, unknown>; statusCode?: number } & Error;
    }
    throw new Error('the save went through');
  };

  beforeAll(async () => {
    if (!available) return;
    h = await addOnHarness(dialect, { unbuiltWords: {} });
    await h.stageAddOn(ledgerKitManifest(), { files: ledgerKitFiles() });
    const added = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'ledger-kit', version: '1.0.0', attachTo: [] } });
    expect(added.statusCode, added.body).toBe(200);
    // A table of the owner's own, beside the add-on's.
    const serial = dialect === 'postgres' ? 'SERIAL PRIMARY KEY' : dialect === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    for (const name of ['tallies', 'ghosts', 'asks']) await h.rows(`CREATE TABLE ${name} (id ${serial}, account_id INT NULL, qty DECIMAL(12,3) NULL, note VARCHAR(80) NULL, status VARCHAR(20) NULL)`);
    await h.introspect();
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    const idOf = (name: string) => model.tables.find((table) => table.name === name)!.id;
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.postings', tableName: idOf('tallies'), columnName: null, value: { postings: [RULE] }, origin: 'user' } as never);
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.postings', tableName: idOf('asks'), columnName: null, value: { postings: [ASK] }, origin: 'user' } as never);
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'table.postings', tableName: idOf('ghosts'), columnName: null, value: { postings: [ELSEWHERE] }, origin: 'user' } as never);
    const view = new SnapshotView(h.connectionId, applyOverrides(model, await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })), new Map());
    const { db, dialect: engine } = await h.manager.data(h.connectionId);
    target = (name) => ({ connectionId: h.connectionId, view, table: view.table(idOf(name)), db, dialect: engine, timezone: 'Europe/London' });
    const installs = keepAddOnInstalls(h.meta, async () => model);
    const decider = loadDecider({ key: 'ledger-kit', version: '1.0.0', path: 'dist/server.js', bytes: LEDGER_KIT_SERVER });
    const ledgers = createLedgerRuntime({
      installs: () => installs.current(),
      refresh: () => installs.fresh(),
      decider: (key) => (key === 'ledger-kit' ? decider : null),
      versionNow: async (key) => {
        const row = await h.meta.db.selectFrom('adminium_manifests').select(['version', 'status']).where('manifestKey', '=', key).executeTakeFirst();
        return row === undefined ? null : { version: row.version, status: row.status };
      },
    });
    writes = createWriteService({ ...writeStores(h.meta), ledgers });
    bare = createWriteService(writeStores(h.meta));
    // The same server with the add-on's code not loaded: its file is gone, or nobody vouches for it.
    // The same server while the add-on is being updated in another process: the store says another version than the code loaded here.
    moved = createWriteService({ ...writeStores(h.meta), ledgers: createLedgerRuntime({ installs: () => installs.current(), refresh: () => installs.fresh(), decider: () => decider, versionNow: async () => ({ version: '1.0.1', status: 'installed' }) }) });
    deaf = createWriteService({ ...writeStores(h.meta), ledgers: createLedgerRuntime({ installs: () => installs.current(), refresh: () => installs.fresh(), decider: () => null, versionNow: async () => ({ version: '1.0.0', status: 'installed' }) }) });
    await h.rows(`INSERT INTO ledger_kit_accounts (id, name, opening, taken, balance, allow_below, reorder_at) VALUES (1, 'Flour', 10, 0, 10, ${t(false)}, 2), (2, 'Sugar', 4, 0, 4, ${t(true)}, 1)`);
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });

  it.skipIf(!available)('the row, its receipt, the entry and the account\'s total go in together', async () => {
    const row = await create('tallies', { account_id: 1, qty: '2.5', note: 'first' });
    expect(Number(row['id'])).toBeGreaterThan(0);
    // One entry, carrying its receipt; the account's total and balance moved by it.
    const entries = await h.rows('SELECT account_id, amount, kind, receipt_id FROM ledger_kit_entries');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'count' });
    expect(Number(entries[0]!['amount'])).toBe(2.5);
    expect(await account(1)).toEqual({ taken: 2.5, balance: 7.5 });
    // The receipt: which row, which rule, which phase and round — and whose code planned it.
    const receipts = await h.rows(`SELECT id, source_table, source_row, source_line, ledger, action, posting, phase, round, state, ${q('rows')} AS n, add_on_version, origin, ${q('by')} AS who FROM ledger_kit_postings`);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ source_row: String(row['id']), source_line: '', ledger: 'units', action: 'count', posting: 'tally', phase: 'post', state: 'planned', add_on_version: '1.0.0', origin: 'staff', who: 'usr_ivy' });
    expect(Number(receipts[0]!['round'])).toBe(1);
    expect(Number(receipts[0]!['n'])).toBe(1);
    expect(Number(entries[0]!['receipt_id'])).toBe(Number(receipts[0]!['id']));
    // What the save answers its door: one call, planned, with the row it wrote.
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ addOn: 'ledger-kit', ledger: 'units', action: 'count', posting: 'tally', phase: 'post', round: 1, rows: 1, state: 'planned', version: '1.0.0', source: { row: String(row['id']) } });
    expect(posted[0]!.written.map((written) => written.table.name)).toEqual(['ledger_kit_entries']);
  });

  it.skipIf(!available)('a rule for an add-on that is not here reads as not there: the row is saved, and nothing is asked', async () => {
    const before = await count('ledger_kit_postings');
    const row = await create('ghosts', { account_id: 1, qty: '1' });
    expect(Number(row['id'])).toBeGreaterThan(0);
    expect(await count('ledger_kit_postings')).toBe(before);
    expect(posted).toEqual([]);
    // Even a write service with no add-on runtime: nothing fires, so nothing is refused… for a table with no rule at all.
    expect(await count('ghosts')).toBe(1);
  });

  it.skipIf(!available)('a server with no add-on runtime refuses a row that would post, rather than save it unposted', async () => {
    const before = await count('tallies');
    const error = await refusal(create('tallies', { account_id: 1, qty: '1' }, desk, bare));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    expect(await count('tallies')).toBe(before);
  });

  it.skipIf(!available)('the add-on refuses a guest what is not there: by name, with what is left, and nothing is saved', async () => {
    const before = { rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), account: await account(1) };
    const error = await refusal(create('tallies', { account_id: 1, qty: '50' }, guest));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', statusCode: 409, details: { reason: 'out-of-stock', ledger: 'units', posting: 'tally', item: 'Flour' } });
    expect(Number(error.details!['left'])).toBe(before.account.balance);
    expect({ rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), account: await account(1) }).toEqual(before);
  });

  it.skipIf(!available)('staff may ask for more than there is, and the cap on the account refuses it as out of stock', async () => {
    const before = { rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), account: await account(1) };
    const error = await refusal(create('tallies', { account_id: 1, qty: '50' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', ledger: 'units', posting: 'tally' } });
    expect({ rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), account: await account(1) }).toEqual(before);
  });

  it.skipIf(!available)('a needed value left empty is asked for by its column, before anything is written', async () => {
    const before = await count('tallies');
    const error = await refusal(create('tallies', { account_id: 1 }));
    expect(error).toMatchObject({ code: 'VALIDATION_FAILED', statusCode: 422, details: { fields: { qty: { code: 'required' } } } });
    expect(await count('tallies')).toBe(before);
  });

  it.skipIf(!available)('a plan that misbehaves fails the save whole, and the person is told only that the add-on did not answer as it should', async () => {
    const before = { rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), accounts: await count('ledger_kit_accounts'), account: await account(1) };
    const after = async () => ({ rows: await count('tallies'), receipts: await count('ledger_kit_postings'), entries: await count('ledger_kit_entries'), accounts: await count('ledger_kit_accounts'), account: await account(1) });
    const causes: Record<string, string> = { throw: 'threw', promise: 'thenable', 'outside-table': 'scope-table', 'second-account': 'scope-row', 'update-total': 'scope-table', require: 'threw' };
    try {
      for (const [how, cause] of Object.entries(causes)) {
        await misbehave(how);
        const error = await refusal(create('tallies', { account_id: 1, qty: '1' }));
        expect(error, how).toBeInstanceOf(PlanFailed);
        expect(error, how).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'planner-failed', ledger: 'units', posting: 'tally' } });
        // Which check failed is the audit's to know, never the reply's.
        expect((error as unknown as PlanFailed).cause, how).toBe(cause);
        expect(JSON.stringify(error.details), how).not.toContain(cause);
        expect(await after(), how).toEqual(before);
      }
    } finally {
      await misbehave(null);
    }
    // And once it behaves again, the same ask goes through.
    await create('tallies', { account_id: 1, qty: '1' });
    expect((await after()).rows).toBe(before.rows + 1);
  });

  it.skipIf(!available)('a change posts when it crosses a point, and only then: held when sent, taken when done, given back when cancelled', async () => {
    const start = await account(2);
    const ask = await create('asks', { account_id: 2, qty: '1.5', status: 'draft', note: 'by hand' });
    const id = Number(ask['id']);
    // Made in a state no point names: nothing is asked.
    expect(await receiptsOf('ask', id)).toEqual([]);
    // A change of another column crosses nothing.
    await update('asks', id, { note: 'still by hand' });
    expect(await receiptsOf('ask', id)).toEqual([]);

    // Sent: one hold, and its receipt. Nothing is taken from the account yet.
    await update('asks', id, { status: 'sent' });
    expect(posted.map((call) => `${call.phase}:${String(call.rows)}`)).toEqual(['reserve:1']);
    expect(await receiptsOf('ask', id)).toEqual(['reserve:1:planned:1']);
    const hold = (await h.rows(`SELECT id, state, amount, receipt_id FROM ledger_kit_holds WHERE account_id = 2`))[0]!;
    expect(hold).toMatchObject({ state: 'held' });
    expect(Number(hold['amount'])).toBe(1.5);
    expect(await account(2)).toEqual(start);

    // Done: the entry goes in and the hold this round made is taken — a planned change of a row the round wrote.
    await update('asks', id, { status: 'done' });
    expect(posted.map((call) => `${call.phase}:${String(call.rows)}`)).toEqual(['post:2']);
    expect(await receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:planned:2']);
    expect((await h.rows(`SELECT state FROM ledger_kit_holds WHERE id = ${String(hold['id'])}`))[0]).toMatchObject({ state: 'taken' });
    expect(await account(2)).toEqual({ taken: start.taken + 1.5, balance: start.balance - 1.5 });
    const entry = (await h.rows(`SELECT note, kind FROM ledger_kit_entries WHERE account_id = 2 ORDER BY id DESC`))[0]!;
    expect(entry).toMatchObject({ kind: 'use', note: 'still by hand' });

    // Cancelled: what the round wrote is given back, and the account is as it was.
    await update('asks', id, { status: 'cancelled' });
    expect(posted.map((call) => call.phase)).toEqual(['reverse']);
    expect(await receiptsOf('ask', id)).toEqual(['reserve:1:planned:1', 'post:1:planned:2', 'reverse:1:planned:1']);
    expect(await account(2)).toEqual(start);

    // Sent again: a new round.
    await update('asks', id, { status: 'sent' });
    expect((await receiptsOf('ask', id)).at(-1)).toBe('reserve:2:planned:1');
    expect(posted[0]).toMatchObject({ phase: 'reserve', round: 2 });
  });

  it.skipIf(!available)('a phase told twice writes once', async () => {
    const ask = await create('asks', { account_id: 2, qty: '1', status: 'draft' });
    const id = Number(ask['id']);
    await update('asks', id, { status: 'sent' });
    const holds = await count('ledger_kit_holds');
    // Back to draft and sent again: the point is crossed a second time, and the round already holds.
    await update('asks', id, { status: 'draft' });
    await update('asks', id, { status: 'sent' });
    expect(posted).toEqual([]);
    expect(await count('ledger_kit_holds')).toBe(holds);
    expect(await receiptsOf('ask', id)).toEqual(['reserve:1:planned:1']);
  });

  it.skipIf(!available)('a hold for more than there is, is refused by the add-on, and the row does not move', async () => {
    const ask = await create('asks', { account_id: 1, qty: '500', status: 'draft' });
    const id = Number(ask['id']);
    const error = await refusal(update('asks', id, { status: 'sent' }));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'out-of-stock', posting: 'ask', item: 'Flour' } });
    expect((await h.rows(`SELECT status FROM asks WHERE id = ${String(id)}`))[0]).toMatchObject({ status: 'draft' });
    expect(await receiptsOf('ask', id)).toEqual([]);
  });

  it.skipIf(!available)('while the add-on\'s code cannot be asked: nothing new is taken, and what was taken is still given back — to be worked out later', async () => {
    const tally = await create('tallies', { account_id: 2, qty: '1' });
    const id = Number(tally['id']);
    const rows = await count('tallies');
    // A new row that would post: refused, not saved unposted.
    const error = await refusal(create('tallies', { account_id: 2, qty: '1' }, desk, deaf));
    expect(error).toMatchObject({ code: 'POSTING_REFUSED', details: { reason: 'add-on-unavailable' } });
    expect(await count('tallies')).toBe(rows);
    // Voiding the one that posted goes through: a receipt that says nobody planned it, and no row written for it.
    const entries = await count('ledger_kit_entries');
    await update('tallies', id, { status: 'void' }, desk, deaf);
    expect((await h.rows(`SELECT status FROM tallies WHERE id = ${String(id)}`))[0]).toMatchObject({ status: 'void' });
    expect(await receiptsOf('tally', id)).toEqual(['post:1:planned:1', 'reverse:1:unplanned:0']);
    expect(posted).toMatchObject([{ phase: 'reverse', state: 'unplanned', rows: 0 }]);
    expect(await count('ledger_kit_entries')).toBe(entries);
  });

  it.skipIf(!available)('code loaded from another version than the one the store holds is not asked: the save is told to try again', async () => {
    const before = { rows: await count('tallies'), receipts: await count('ledger_kit_postings') };
    const error = await refusal(create('tallies', { account_id: 2, qty: '1' }, desk, moved));
    expect(error).toMatchObject({ code: 'WRITE_CONFLICT', statusCode: 409, details: { retry: true } });
    expect({ rows: await count('tallies'), receipts: await count('ledger_kit_postings') }).toEqual(before);
  });
});
