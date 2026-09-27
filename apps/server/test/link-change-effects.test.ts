// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An effect of a changed link (`states.effects` with `on.change`), on every
 * engine, the clock fixed: a guest moved to another room while in house
 * turns the room they leave to cleaning and the room they take to occupied,
 * in the write that moves them — each room by its own declared move, so a
 * room being cleaned, or one someone is in, refuses the whole move and
 * nothing is kept. A booked guest's room change moves no room; an emptied
 * room moves only the room left; a quote judges the same and writes nothing;
 * the staff route and a bulk change move the rooms too (a bulk change of
 * stays counted by the night is refused whole, as it always was). Two desks moving two guests into one
 * ready room at once: exactly one gets it. And the rooms are held before the
 * stay, as every writer holds them.
 */
import { sql } from 'kysely';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { asUser } from './connections-helpers.js';
import { houseManifest, houseTables, type Doc } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';

const at = (when: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(when));
};

describe.each(LEGS)('a guest moved to another room moves both rooms — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let routes: DataRoutes;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, houseManifest());
    w = await writerFor(h, 'Europe/London');
    routes = await dataRoutesOver(h, dialect);
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await routes.close();
    await h.close();
  });
  afterEach(() => vi.useRealTimers());

  const status = async (key: unknown) => (await h.rows(`select status from ${h.real('rooms')} where id = ${String(key)}`))[0]!['status'];
  const roomOf = async (key: unknown) => (await h.rows(`select room_id from ${h.real('stays')} where id = ${String(key)}`))[0]!['room_id'];
  /** A type with `count` ready rooms, and a guest of it checked in to the first. */
  async function house(count: number) {
    n += 1;
    at('2026-11-02T16:00:00Z');
    const type = await w.create('room_types', { name: `Type ${String(n)}` });
    const rooms = [];
    for (let i = 0; i < count; i += 1) rooms.push(await w.create('rooms', { number: `${String(n)}0${String(i)}`, room_type_id: type['id'] }));
    const stay = await w.create('stays', { guest: `Guest ${String(n)}`, room_type_id: type['id'], room_id: rooms[0]!['id'], arrive: '2026-11-02', depart: '2026-11-05' });
    await w.update('stays', stay['id'], { status: 'in_house' });
    return { type, rooms, stay };
  }

  it.runIf(available)('turns the room left to cleaning and the room taken to occupied, in the one write', async () => {
    const { rooms, stay } = await house(2);
    expect(await status(rooms[0]!['id'])).toBe('occupied');
    const moved = await w.update('stays', stay['id'], { room_id: rooms[1]!['id'] });
    expect(moved.effects?.map((e) => [String(e.pk['id']), e.after?.['status']])).toEqual([
      [String(rooms[0]!['id']), 'cleaning'],
      [String(rooms[1]!['id']), 'occupied'],
    ]);
    expect([await status(rooms[0]!['id']), await status(rooms[1]!['id'])]).toEqual(['cleaning', 'occupied']);
  });

  it.runIf(available)('refuses the whole move into a room being cleaned, or one someone is in', async () => {
    const { rooms, stay } = await house(3);
    await h.rows(`update ${h.real('rooms')} set status = 'cleaning' where id = ${String(rooms[1]!['id'])}`);
    await expect(w.update('stays', stay['id'], { room_id: rooms[1]!['id'] })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
    expect([String(await roomOf(stay['id'])), await status(rooms[0]!['id']), await status(rooms[1]!['id'])]).toEqual([String(rooms[0]!['id']), 'occupied', 'cleaning']);
    await h.rows(`update ${h.real('rooms')} set status = 'occupied' where id = ${String(rooms[2]!['id'])}`);
    await expect(w.update('stays', stay['id'], { room_id: rooms[2]!['id'] })).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { effect: 'new', from: 'occupied', to: 'occupied' } });
    expect([String(await roomOf(stay['id'])), await status(rooms[0]!['id'])]).toEqual([String(rooms[0]!['id']), 'occupied']);
  });

  it.runIf(available)('moves no room for a booked guest, and only the room left when the room is emptied', async () => {
    const { rooms, stay } = await house(3);
    const booked = await w.create('stays', { guest: 'Later', room_type_id: rooms[0]!['room_type_id'], room_id: rooms[1]!['id'], arrive: '2026-11-10', depart: '2026-11-11' });
    const quiet = await w.update('stays', booked['id'], { room_id: rooms[2]!['id'] });
    expect(quiet.effects).toBeUndefined();
    expect([await status(rooms[1]!['id']), await status(rooms[2]!['id'])]).toEqual(['ready', 'ready']);
    const emptied = await w.update('stays', stay['id'], { room_id: null });
    expect(emptied.effects?.map((e) => e.after?.['status'])).toEqual(['cleaning']);
    expect(await status(rooms[0]!['id'])).toBe('cleaning');
  });

  it.runIf(available)('judges a quote of the move the same way, and writes nothing', async () => {
    const { rooms, stay } = await house(3);
    const quote = (room: unknown) => w.writes.update({ target: w.targetOf('stays'), pk: { id: stay['id'] }, values: { room_id: room }, context: w.desk, mode: 'dry', announce: async () => {} });
    await quote(rooms[1]!['id']);
    expect([String(await roomOf(stay['id'])), await status(rooms[0]!['id']), await status(rooms[1]!['id'])]).toEqual([String(rooms[0]!['id']), 'occupied', 'ready']);
    await h.rows(`update ${h.real('rooms')} set status = 'cleaning' where id = ${String(rooms[2]!['id'])}`);
    await expect(quote(rooms[2]!['id'])).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED' });
  });

  it.runIf(available)('moves the rooms through the staff route; a bulk change of counted stays is refused whole, as before', async () => {
    const { rooms, stay } = await house(3);
    const res = await routes.patch('stays', stay['id'], { values: { room_id: rooms[1]!['id'] } });
    expect(res.statusCode, res.body).toBe(200);
    expect([await status(rooms[0]!['id']), await status(rooms[1]!['id'])]).toEqual(['cleaning', 'occupied']);
    // Stays counted by the night are written one at a time: a bulk change of their room never runs, rooms and all.
    const bulk = await routes.t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${routes.connectionId}/${routes.table('stays')}/bulk`,
      headers: asUser(routes.t.users.admin),
      payload: { action: 'update', ids: [stay['id']], values: { room_id: rooms[2]!['id'] } },
    });
    expect(bulk.statusCode, bulk.body).toBe(409);
    expect([await status(rooms[1]!['id']), await status(rooms[2]!['id'])]).toEqual(['occupied', 'ready']);
  });

  it.runIf(available && dialect !== 'sqlite')('holds the rooms before the stay, as a writer holding a room and then the stay does', async () => {
    const { rooms, stay } = await house(2);
    vi.useRealTimers();
    const { db } = await h.manager.data(h.connectionId);
    let during: Promise<unknown> | undefined;
    await db.transaction().execute(async (trx) => {
      await sql`select id from ${sql.table(h.real('rooms'))} where id = ${rooms[1]!['id']} for update`.execute(trx);
      during = w.update('stays', stay['id'], { room_id: rooms[1]!['id'] }).catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await sql`select id from ${sql.table(h.real('stays'))} where id = ${stay['id']} for update`.execute(trx);
    });
    expect(await during).toMatchObject({ count: 1 });
    expect(await status(rooms[1]!['id'])).toBe('occupied');
  });
});

/** The same house with no night counts: the rooms' own moves are all that stands between two guests and one room. */
function noCounts(): Doc {
  const tables = houseTables().map((table) => (table['ref'] === 'stays' ? { ...table, capacity: undefined } : table));
  return houseManifest(tables.map((table) => Object.fromEntries(Object.entries(table).filter(([, value]) => value !== undefined))));
}

/** The house whose room change moves the rooms for a booked guest too, beside the check-in's own effect. */
function bookedToo(): Doc {
  const tables = houseTables().map((table) => {
    if (table['ref'] !== 'stays') return table;
    const states = table['states'] as Doc;
    const effects = (states['effects'] as Doc[]).map((effect) => ('change' in (effect['on'] as Doc) ? { ...effect, on: { change: 'room_id', in: ['booked', 'in_house'] } } : effect));
    return { ...table, states: { ...states, effects } };
  });
  return houseManifest(tables);
}

describe.each(LEGS)('a check-in into another room, the rooms moved by both effects — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, bookedToo());
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const status = async (key: unknown) => (await h.rows(`select status from ${h.real('rooms')} where id = ${String(key)}`))[0]!['status'];

  it.runIf(available)('turns the new room occupied once, by the check-in, and the old one to cleaning', async () => {
    at('2026-11-02T16:00:00Z');
    const type = await w.create('room_types', { name: 'Twin' });
    const a = await w.create('rooms', { number: '31', room_type_id: type['id'] });
    const b = await w.create('rooms', { number: '32', room_type_id: type['id'] });
    const stay = await w.create('stays', { guest: 'G', room_type_id: type['id'], room_id: a['id'], arrive: '2026-11-02', depart: '2026-11-03' });
    const moved = await w.update('stays', stay['id'], { status: 'in_house', room_id: b['id'] });
    expect(moved.count).toBe(1);
    expect([await status(a['id']), await status(b['id'])]).toEqual(['cleaning', 'occupied']);
  });
});

describe.each(LEGS)('rooms moved by a bulk change, and two desks moving two guests into one ready room at once — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let routes: DataRoutes;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, noCounts());
    w = await writerFor(h, 'Europe/London');
    routes = await dataRoutesOver(h, dialect);
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await routes.close();
    await h.close();
  });
  afterEach(() => vi.useRealTimers());
  const status = async (key: unknown) => (await h.rows(`select status from ${h.real('rooms')} where id = ${String(key)}`))[0]!['status'];

  it.runIf(available)('moves the rooms of a bulk change of rooms, and refuses the whole change into a room being cleaned', async () => {
    at('2026-11-02T16:00:00Z');
    const type = await w.create('room_types', { name: 'Twin' });
    const rooms = [];
    for (const number of ['21', '22', '23', '24']) rooms.push(await w.create('rooms', { number, room_type_id: type['id'] }));
    const stays = [];
    for (const room of rooms.slice(0, 2)) {
      const stay = await w.create('stays', { guest: `G${String(room['number'])}`, room_type_id: type['id'], room_id: room['id'], arrive: '2026-11-02', depart: '2026-11-04' });
      await w.update('stays', stay['id'], { status: 'in_house' });
      stays.push(stay);
    }
    const bulk = (ids: unknown[], room: unknown) =>
      routes.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${routes.connectionId}/${routes.table('stays')}/bulk`,
        headers: asUser(routes.t.users.admin),
        payload: { action: 'update', ids, values: { room_id: room } },
      });
    const moved = await bulk([stays[0]!['id']], rooms[2]!['id']);
    expect(moved.statusCode, moved.body).toBe(200);
    expect([await status(rooms[0]!['id']), await status(rooms[2]!['id'])]).toEqual(['cleaning', 'occupied']);
    await h.rows(`update ${h.real('rooms')} set status = 'cleaning' where id = ${String(rooms[3]!['id'])}`);
    const refused = await bulk([stays[1]!['id']], rooms[3]!['id']);
    expect(refused.statusCode, refused.body).toBe(409);
    expect([await status(rooms[1]!['id']), await status(rooms[3]!['id'])]).toEqual(['occupied', 'cleaning']);
    expect(String((await h.rows(`select room_id from ${h.real('stays')} where id = ${String(stays[1]!['id'])}`))[0]!['room_id'])).toBe(String(rooms[1]!['id']));
  });

  it.runIf(available && dialect !== 'sqlite')('gives the room to exactly one', async () => {
    at('2026-11-02T16:00:00Z');
    const type = await w.create('room_types', { name: 'Double' });
    const [a, b, free] = [await w.create('rooms', { number: '1', room_type_id: type['id'] }), await w.create('rooms', { number: '2', room_type_id: type['id'] }), await w.create('rooms', { number: '3', room_type_id: type['id'] })];
    const guests = [];
    for (const room of [a, b]) {
      const stay = await w.create('stays', { guest: `G${String(room['number'])}`, room_type_id: type['id'], room_id: room['id'], arrive: '2026-11-02', depart: '2026-11-04' });
      await w.update('stays', stay['id'], { status: 'in_house' });
      guests.push(stay);
    }
    vi.useRealTimers();
    const results = await Promise.allSettled(guests.map((stay) => w.update('stays', stay['id'], { room_id: free!['id'] })));
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won.length).toBe(1);
    expect(lost.length).toBe(1);
    expect((lost[0] as PromiseRejectedResult).reason).toMatchObject({ code: expect.stringMatching(/^(STATE_MOVE_REFUSED|WRITE_CONFLICT)$/) });
    const rows = await h.rows(`select id, room_id from ${h.real('stays')} where room_id = ${String(free!['id'])}`);
    expect(rows.length).toBe(1);
    const statuses = await h.rows(`select id, status from ${h.real('rooms')} where room_type_id = ${String(type['id'])} order by id`);
    expect(statuses.map((r) => r['status']).sort()).toEqual(['cleaning', 'occupied', 'occupied']);
  });
});
