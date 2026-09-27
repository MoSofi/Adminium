// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every writer takes the rows it holds in one order — its parents, then the
 * rows its links point at, then its own rows — so two writers never hold two
 * rows crosswise, on Postgres and MySQL (SQLite writes one transaction at a
 * time): a stay checked in while its nights change (a formula worked out
 * again, which holds the stay early) takes its room first, as a writer that
 * holds the room and then the stay does; a booking made with its rooms holds
 * every room its lines wait for in one pass, before any line goes in, not
 * line by line in the order sent. And a move never moves a row of a table a
 * hook watches — its hooks could not run inside another row's write. The
 * rows of one table are taken in the order the database sorts their keys
 * (a text key's by its collation), as every writer holding them by key does.
 */
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { RecordHooks } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const id = { ref: 'id', type: 'int', role: 'pk' };

function lodgeManifest(): Record<string, unknown> {
  const tables = [
    {
      ref: 'rooms',
      columns: [id, { ref: 'number', type: 'text', maxLength: 8 }, { ref: 'status', type: 'enum', enum: ['ready', 'occupied', 'cleaning'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['occupied'], occupied: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'stays',
      columns: [
        id,
        { ref: 'room_id', type: 'fk', references: 'rooms', nullable: true },
        { ref: 'nights', type: 'int', default: 1 },
        { ref: 'rate', type: 'int', default: 100 },
        { ref: 'amount', type: 'int', nullable: true, rules: { formula: { mul: ['nights', 'rate'] } } },
        { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' },
      ],
      states: {
        column: 'status',
        initial: 'booked',
        moves: { booked: [{ to: 'in_house', requires: { linked: [{ via: 'room_id', where: [{ column: 'status', eq: 'ready' }] }] } }], in_house: ['departed'] },
        effects: [{ on: { to: 'in_house' }, via: 'room_id', set: { status: 'occupied' } }],
      },
    },
    { ref: 'bookings', columns: [id, { ref: 'email', type: 'text', maxLength: 200 }] },
    {
      ref: 'booking_rooms',
      columns: [
        id,
        { ref: 'booking_id', type: 'fk', references: 'bookings' },
        { ref: 'room_id', type: 'fk', references: 'rooms' },
        { ref: 'status', type: 'enum', enum: ['held'], default: 'held' },
      ],
      states: { column: 'status', initial: 'held', moves: {}, create: { requires: { linked: [{ via: 'room_id', where: [{ column: 'status', eq: 'ready' }] }] } } },
    },
  ];
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'lodge',
    name: 'Lodge',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'lodge.description', fallback: 'A lodge' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'lodge', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

describe.each(LEGS)('one lock order for every writer — %s', (dialect, available) => {
  const servers = available && dialect !== 'sqlite';
  let h: InvoicingHarness;
  let w: Writer;
  let routes: DataRoutes;
  let hooked: DataRoutes;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, lodgeManifest());
    w = await writerFor(h, 'Europe/London');
    routes = await dataRoutesOver(h, dialect);
    // A project hook that watches the rooms, as a project's code may.
    const hooks: RecordHooks = {
      wants: async (_timing, _action, target) => target.table.name === h.real('rooms'),
      before: async () => undefined,
      after: async () => undefined,
    };
    hooked = await dataRoutesOver(h, dialect, 'EUR', hooks);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await routes.close();
    await hooked.close();
    await h.close();
  });

  /** Another writer's transaction: it holds `first`, then — once `during` has started and waited — `second`. */
  async function crosswise(first: string, second: string, during: () => Promise<unknown>): Promise<unknown> {
    const { db } = await h.manager.data(h.connectionId);
    let started: Promise<unknown> | undefined;
    await db.transaction().execute(async (trx) => {
      await sql.raw(first).execute(trx);
      started = during().catch((error: unknown) => error);
      await sleep(400);
      await sql.raw(second).execute(trx);
    });
    return started;
  }

  it.runIf(servers)('checks a stay in while its nights change, taking its room before the stay', async () => {
    const room = await w.create('rooms', { number: `S${String((n += 1))}` });
    const stay = await w.create('stays', { room_id: room['id'] });
    const outcome = await crosswise(
      `select id from ${h.real('rooms')} where id = ${String(room['id'])} for update`,
      `select id from ${h.real('stays')} where id = ${String(stay['id'])} for update`,
      () => w.update('stays', stay['id'], { status: 'in_house', nights: 3 }),
    );
    expect(outcome).toMatchObject({ count: 1 });
    const [row] = await h.rows(`select status, amount from ${h.real('stays')} where id = ${String(stay['id'])}`);
    expect({ status: row!['status'], amount: Number(row!['amount']) }).toEqual({ status: 'in_house', amount: 300 });
    const [after] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
    expect(after!['status']).toBe('occupied');
  });

  it.runIf(servers)('holds every room a booking waits for in one pass, whatever order its lines name them in', async () => {
    const low = await w.create('rooms', { number: `L${String((n += 1))}` });
    const high = await w.create('rooms', { number: `H${String(n)}` });
    const [first, second] = Number(low['id']) < Number(high['id']) ? [low, high] : [high, low];
    const outcome = (await crosswise(
      `select id from ${h.real('rooms')} where id = ${String(first['id'])} for update`,
      `select id from ${h.real('rooms')} where id = ${String(second['id'])} for update`,
      () =>
        routes.post('bookings', {
          values: { email: `b${String(n)}@example.com` },
          // The lines name the later room first.
          children: { [routes.relation('booking_rooms', 'bookings')]: [{ values: { room_id: second['id'] } }, { values: { room_id: first['id'] } }] },
        }),
    )) as { statusCode: number; body: string };
    expect(outcome.statusCode, outcome.body).toBe(201);
    const lines = await h.rows(`select room_id from ${h.real('booking_rooms')} order by id`);
    expect(lines.slice(-2).map((line) => String(line['room_id']))).toEqual([String(second['id']), String(first['id'])]);
  });

  it.runIf(available)('never moves a row of a table a hook watches', async () => {
    const room = await w.create('rooms', { number: `K${String((n += 1))}` });
    const stay = await w.create('stays', { room_id: room['id'] });
    const refused = await hooked.patch('stays', stay['id'], { values: { status: 'in_house' } });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'STATE_MOVE_REFUSED', details: { effect: h.real('rooms'), hooked: true } } });
    const [kept] = await h.rows(`select status from ${h.real('stays')} where id = ${String(stay['id'])}`);
    expect(kept!['status']).toBe('booked');
  });
});

/** Rooms keyed by a code a person reads (text), and a swap that moves a guest from one to another. */
function swapsManifest(): Record<string, unknown> {
  const manifest = lodgeManifest();
  manifest['key'] = 'swap';
  const tables = (manifest['requiredSchema'] as { tables: Record<string, unknown>[] }).tables;
  tables.push(
    {
      ref: 'suites',
      columns: [{ ref: 'code', type: 'text', maxLength: 8, role: 'pk' }, { ref: 'status', type: 'enum', enum: ['ready', 'cleaning'], default: 'ready' }],
      states: { column: 'status', initial: 'ready', moves: { ready: ['cleaning'], cleaning: ['ready'] } },
    },
    {
      ref: 'swaps',
      columns: [
        id,
        { ref: 'from_suite', type: 'fk', references: 'suites' },
        { ref: 'to_suite', type: 'fk', references: 'suites' },
        { ref: 'status', type: 'enum', enum: ['planned', 'done'], default: 'planned' },
      ],
      states: {
        column: 'status',
        initial: 'planned',
        moves: { planned: [{ to: 'done', requires: { linked: [{ via: 'to_suite', where: [{ column: 'status', eq: 'ready' }] }] } }] },
        effects: [{ on: { to: 'done' }, via: 'from_suite', set: { status: 'cleaning' } }],
      },
    },
  );
  return manifest;
}

describe.each(LEGS)('the rows of one table a write holds are taken in the order the database sorts their keys — %s', (dialect, available) => {
  it.runIf(available && dialect !== 'sqlite')('a swap between two suites keyed by text crosses no writer holding them in key order, whatever their case', async () => {
    const h = await installInvoicing(dialect, swapsManifest());
    try {
      const w = await writerFor(h, 'Europe/London');
      await h.rows(`insert into ${h.real('suites')} (code, status) values ('a', 'ready'), ('B', 'ready')`);
      // The order the database sorts the two codes in (its collation's, not the bytes'): a writer holding both by key takes them so.
      const sorted = (await h.rows(`select code from ${h.real('suites')} where code in ('a', 'B') order by code`)).map((row) => String(row['code']));
      // Moved out of the one sorted first, into the other: a write that took them in byte order would take "B" first.
      const swap = await w.create('swaps', { from_suite: sorted[0], to_suite: sorted[1] });
      const { db } = await h.manager.data(h.connectionId);
      let started: Promise<unknown> | undefined;
      await db.transaction().execute(async (trx) => {
        await sql`select code from ${sql.table(h.real('suites'))} where code = ${sorted[0]} for update`.execute(trx);
        started = w.update('swaps', swap['id'], { status: 'done' }).catch((error: unknown) => error);
        await sleep(400);
        await sql`select code from ${sql.table(h.real('suites'))} where code = ${sorted[1]} for update`.execute(trx);
      });
      expect(await started).toMatchObject({ count: 1 });
      expect((await h.rows(`select status from ${h.real('suites')} where code = '${sorted[0]!}'`))[0]!['status']).toBe('cleaning');
    } finally {
      await h.close();
    }
  }, 120_000);
});
