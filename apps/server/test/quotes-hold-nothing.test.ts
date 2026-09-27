// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A quote — a dry run of a create with its child rows, or of a change —
 * holds no row it did not write and takes no named lock, so it never waits on
 * a save and never crosses one, on Postgres and MySQL (SQLite writes one
 * transaction at a time):
 *
 *  - a quote of an order's new pickup time reads the order's lines as they
 *    are, never holding them: it answers while a save holds a line, and a
 *    door scan that holds the order for share and then a line for update
 *    goes through beside it (the quote held the lines, then waited on the
 *    order: a deadlock);
 *  - a quote of an order whose line waits for its dish to be offered reads
 *    the dish as it is: a save changing the dish does not hold it up;
 *  - a quote of a stay checked in judges the room its move turns occupied
 *    without writing it: a save holding the room does not hold it up;
 *  - a quote of a payment leaves the invoice it would clear a column of as it
 *    is (a save's payment empties it).
 *
 * The one wait left is the engine's own: a new row's foreign key is checked
 * against the row it points at, and InnoDB takes a shared lock on that row
 * for the check (Postgres a key-share lock, which a save's change of other
 * columns does not block). A quote's line that points at a dish a MySQL save
 * is changing waits for that save — named below.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type World } from './capacity.helpers.js';
import { LEGS as CAPACITY_LEGS } from './capacity.helpers.js';
import { at, iso, kitchen } from './capacity-worlds.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor } from './invoicing-install.helpers.js';
import { MENU, orderTables, orderTree, writeTree } from './order-tree-fixture.js';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether `run` settles within `ms`, and how it settled. */
async function within<T>(run: Promise<T>, ms: number): Promise<{ done: boolean; outcome: Promise<{ ok: boolean; error?: unknown; value?: T }> }> {
  const outcome = run.then(
    (value) => ({ ok: true, value }),
    (error: unknown) => ({ ok: false, error }),
  );
  const done = await Promise.race([outcome.then(() => true), pause(ms).then(() => false)]);
  return { done, outcome };
}

/** Another writer's transaction holding what `hold` takes, until `release` is called. */
async function holding(db: World['db'], hold: (trx: World['db']) => Promise<unknown>): Promise<{ release: () => void; done: Promise<void> }> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held!: () => void;
  const taken = new Promise<void>((resolve) => (held = resolve));
  const done = db.transaction().execute(async (trx) => {
    await hold(trx as unknown as World['db']);
    held();
    // A deadline: the gate opens at the latest after 20 s, whatever the test does.
    await Promise.race([gate, pause(20_000)]);
  });
  await Promise.race([taken, done]);
  return { release, done };
}

describe.each(CAPACITY_LEGS.filter(([dialect]) => dialect !== 'sqlite'))('a quote of a change holds none of the rows it reaches — %s', (dialect, available) => {
  let w: World | null = null;
  afterEach(async () => {
    vi.useRealTimers();
    await w?.close();
    w = null;
  });

  it.runIf(available)("reads an order's lines as they are: it answers while a save holds one, and never crosses a door scan", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    w = await kitchen(dialect);
    vi.setSystemTime(at('2026-07-28 11:40'));
    const order = await w.create('orders', { pickup_at: iso('2026-07-28 13:00') }, 'dashboard');
    const line = await w.create('order_items', { order_id: order['id'], menu_item_id: 2, qty: 1 });
    const orders = await w.target('orders');
    const quote = () =>
      w!.writes.update({
        target: orders,
        pk: { id: order['id'] },
        values: { pickup_at: new Date(iso('2026-07-28 13:30')) },
        context: { origin: 'dashboard', hops: 0, actor: null, request: null },
        mode: 'dry',
        announce: async () => {},
      });
    const lines = sql.table(w.id('order_items'));

    // A save holding one of the order's lines: the quote does not wait for it.
    const save = await holding(w.db, (trx) => sql`select id from ${lines} where id = ${line['id']} for update`.execute(trx));
    const quoted = await within(quote(), 3_000);
    save.release();
    await save.done;
    expect(quoted.done).toBe(true);
    const first = await quoted.outcome;
    expect(first.ok, String(first.error)).toBe(true);

    // A door scan: the order for share, then — once the quote is under way — its line for update.
    let go!: () => void;
    const step = new Promise<void>((resolve) => (go = resolve));
    let shared!: () => void;
    const hasShare = new Promise<void>((resolve) => (shared = resolve));
    const scan = w.db.transaction().execute(async (trx) => {
      await sql`select id from ${sql.table(w!.id('orders'))} where id = ${order['id']} for share`.execute(trx);
      shared();
      await Promise.race([step, pause(20_000)]);
      await sql`select id from ${lines} where id = ${line['id']} for update`.execute(trx);
    });
    await hasShare;
    const second = within(quote(), 20_000);
    await pause(800);
    go();
    const [scanned, again] = await Promise.all([scan.then(() => 'ok', (error: unknown) => String((error as { code?: unknown }).code ?? error)), second.then((r) => r.outcome)]);
    // Neither is given up: the quote's own change of the order waits for the scan (the one row it writes), and nothing else.
    expect(scanned).toBe('ok');
    expect(again.ok, String(again.error)).toBe(true);
  }, 60_000);
});

describe.each(LEGS.filter(([dialect]) => dialect !== 'sqlite'))('a quote of a create holds none of the rows outside it — %s', (dialect, available) => {
  it.runIf(available)('reads the dish its line waits for as it is: a save changing the dish holds it up only where the engine checks a new key by locking', async () => {
    const tables = orderTables();
    const items = tables.find((t) => t['ref'] === 'order_items')! as { columns: Record<string, unknown>[]; states?: unknown };
    items.columns.push({ ref: 'status', type: 'enum', enum: ['open', 'void'], default: 'open' });
    items.states = { column: 'status', initial: 'open', moves: { open: ['void'] }, create: { requires: { linked: [{ via: 'menu_item_id', where: [{ column: 'available', eq: true }] }] } } };
    const manifest = invoicingManifest(tables);
    manifest['key'] = 'kitchen';
    (manifest['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'orders' };
    const h = await installInvoicing(dialect, manifest);
    try {
      for (const statement of MENU) await h.rows(statement);
      const wr = await writerFor(h);
      const { db } = await h.manager.data(h.connectionId);
      // A save changing the dish's name: the lock its UPDATE takes (on Postgres, one a new row's key check does not wait for).
      const save = await holding(db as unknown as World['db'], (trx) => sql`update ${sql.table(h.real('menu_items'))} set name = 'Margherita!' where id = 1`.execute(trx));
      const quoted = await within(writeTree(wr, orderTree(wr, [{ item: 1 }]), 'dry'), 3_000);
      save.release();
      await save.done;
      const outcome = await quoted.outcome;
      expect(outcome.ok, String(outcome.error)).toBe(true);
      // Postgres: the quote read the dish without a lock and answered while the save held it.
      // MySQL: InnoDB's key check of the new line takes a shared lock on the dish, which waits for the save — the engine's, not the quote's.
      expect(quoted.done).toBe(dialect === 'postgres');
      // Nothing of the quote was kept.
      expect(Number((await h.rows(`select count(*) as n from ${h.real('orders')}`))[0]!['n'])).toBe(0);
    } finally {
      await h.close();
    }
  }, 120_000);
});

const id = { ref: 'id', type: 'int', role: 'pk' };

/** Rooms a stay turns occupied when it checks in; accounts whose "settled" flag a new entry empties. */
function lodge(): Record<string, unknown> {
  const manifest = invoicingManifest([
    {
      ref: 'rooms',
      columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ['ready', 'occupied'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['ready'] } },
    },
    {
      ref: 'stays',
      columns: [id, { ref: 'room_id', type: 'fk', references: 'rooms' }, { ref: 'status', type: 'enum', enum: ['booked', 'in_house'], default: 'booked' }],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: [{ to: 'in_house', requires: { linked: [{ via: 'room_id', where: [{ column: 'status', eq: 'ready' }] }] } }] },
        effects: [{ on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } }],
      },
    },
    {
      ref: 'accounts',
      columns: [id, { ref: 'settled', type: 'bool', nullable: true }, { ref: 'status', type: 'enum', enum: ['open'], default: 'open' }],
      states: { column: 'status', initial: 'open', moves: {}, children: { entries: { via: 'account_id', clearOnCreate: ['settled'] } } },
    },
    { ref: 'entries', columns: [id, { ref: 'account_id', type: 'fk', references: 'accounts' }, { ref: 'amount', type: 'int', default: 1 }] },
  ]);
  manifest['key'] = 'lodge';
  return manifest;
}

describe.each(LEGS)('a quote writes no row it did not make — %s', (dialect, available) => {
  const servers = available && dialect !== 'sqlite';

  it.runIf(servers)('judges the room a stay checked in turns occupied without writing it: a save holding the room does not hold it up', async () => {
    const h = await installInvoicing(dialect, lodge());
    try {
      const wr = await writerFor(h);
      const room = await wr.create('rooms', { number: '1' });
      const stay = await wr.create('stays', { room_id: room['id'] });
      const { db } = await h.manager.data(h.connectionId);
      const save = await holding(db as unknown as World['db'], (trx) => sql`update ${sql.table(h.real('rooms'))} set number = '1a' where id = ${room['id']}`.execute(trx));
      const quote = wr.writes.update({ target: wr.targetOf('stays'), pk: { id: stay['id'] }, values: { status: 'in_house' }, context: wr.desk, mode: 'dry', announce: async () => {} });
      const quoted = await within(quote, 3_000);
      save.release();
      await save.done;
      expect(quoted.done).toBe(true);
      const outcome = await quoted.outcome;
      expect(outcome.ok, String(outcome.error)).toBe(true);
      expect(outcome.value?.after?.['status']).toBe('in_house');
      // Nothing kept: the stay is booked, the room ready.
      expect((await h.rows(`select status from ${h.real('stays')} where id = ${String(stay['id'])}`))[0]!['status']).toBe('booked');
      expect((await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`))[0]!['status']).toBe('ready');
    } finally {
      await h.close();
    }
  }, 120_000);

  it.runIf(available)("empties a column of a parent it made, as a save does, and leaves another's as it is", async () => {
    const h = await installInvoicing(dialect, lodge());
    try {
      const wr = await writerFor(h);
      const tree = (root: Record<string, unknown>) => ({
        name: 'accounts',
        target: wr.targetOf('accounts'),
        values: root,
        at: [],
        children: [{ name: 'entries', target: wr.targetOf('entries'), values: { amount: 5 }, via: { column: 'account_id', parentKey: 'id' }, at: ['entries', 0], children: [] }],
      });
      // Its own account: the entry empties "settled", in the quote as in the save (read inside the quote, once its entries are in).
      const seen: unknown[] = [];
      await writeTree(wr, tree({ settled: true }), 'dry', wr.desk, {
        siblings: async (db, parent) => {
          seen.push((await sql<{ settled: unknown }>`select settled from ${sql.table(h.real('accounts'))} where id = ${parent.record['id']}`.execute(db)).rows[0]?.settled ?? null);
        },
      });
      expect(seen).toEqual([null]);
      const saved = await writeTree(wr, tree({ settled: true }), 'save');
      expect((await h.rows(`select settled from ${h.real('accounts')} where id = ${String(saved.root['id'])}`))[0]!['settled'] ?? null).toBeNull();
      if (dialect === 'sqlite') return;
      // Another account, which a save holds while it changes it: the quote of an entry on it waits for nothing (Postgres) and writes nothing.
      const other = await wr.create('accounts', { settled: true });
      const { db } = await h.manager.data(h.connectionId);
      const save = await holding(db as unknown as World['db'], (trx) => sql`update ${sql.table(h.real('accounts'))} set settled = true where id = ${other['id']}`.execute(trx));
      const entry = { name: 'entries', target: wr.targetOf('entries'), values: { account_id: other['id'], amount: 5 }, at: [], children: [] };
      const quote = await within(writeTree(wr, entry, 'dry'), 3_000);
      save.release();
      await save.done;
      const outcome = await quote.outcome;
      expect(outcome.ok, String(outcome.error)).toBe(true);
      // MySQL: InnoDB's key check of the new entry waits for the save's lock on the account — the engine's, not the quote's.
      expect(quote.done).toBe(dialect === 'postgres');
      expect(Boolean((await h.rows(`select settled from ${h.real('accounts')} where id = ${String(other['id'])}`))[0]!['settled'])).toBe(true);
    } finally {
      await h.close();
    }
  }, 120_000);
});
