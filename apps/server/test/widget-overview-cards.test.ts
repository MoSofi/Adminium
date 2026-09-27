// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an overview page's cards ask of widget-data, on every engine, at a
 * fixed time, in a venue that is not on UTC (Los Angeles, a Monday just
 * before midnight — already Tuesday in UTC):
 *
 * - filters joined by `or` / `and`, a day on the venue's calendar in a filter
 *   ("rooms out of service today or later": active, and ending today or
 *   later or with no end), a filter one link away inside a group;
 * - a ranking with two figures (received and still owed, by show), put in
 *   date order by a column of the show;
 * - a KPI over a night limit's counts: how full the house is tonight, what
 *   its rooms earn tonight at each night's own rate, against last night;
 * - a list of shows, each with its tickets sold and held of what it can sell.
 *
 * Run it once more with the process in another zone (`TZ=…`): the venue's
 * day must not move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { SnapshotView } from '../src/crud/identifiers.js';
import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { queryDescriptorSchema } from '@adminium/engine/config';

import { WidgetDataCache } from '../src/widget-data/cache.js';
import { answerCapacityCounts } from '../src/widget-data/capacity.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { filled, LEGS, types, type Dialect, type World } from './capacity.helpers.js';

const ZONE = 'America/Los_Angeles';
const at = (wall: string) => wallTimeToInstant(wall, ZONE)!;
const iso = (wall: string) => at(wall).toISOString();
/** Monday 27 July, 23:30 where the venue is; Tuesday 06:30 in UTC. */
const NOW = at('2026-07-27 23:30');

type Reply = { status: number; body: Record<string, unknown> };

function venueDdl(dialect: Dialect): string[] {
  const t = types(dialect);
  const money = 'decimal(10,2)';
  return [
    `create table room_types (id ${t.key}, name ${t.text(40)} not null, base_rate ${money} not null)`,
    `create table rooms (id ${t.key}, room_type_id integer not null, number ${t.text(8)} not null, floor integer not null, ${t.fk('room_type_id', 'room_types')})`,
    `create table room_closures (id ${t.key}, room_id integer not null, reason ${t.text(80)} null, from_date date not null, to_date date null, active ${t.bool} not null, made_at ${t.at} null, ${t.fk('room_id', 'rooms')})`,
    `create table rate_rules (id ${t.key}, room_type_id integer null, name ${t.text(40)} not null, weekdays ${t.text(40)} null, amount ${money} not null, ${t.fk('room_type_id', 'room_types')})`,
    `create table stays (id ${t.key}, arrive date not null, depart date not null, room_type_id integer not null, status ${t.text(16)} not null default 'booked', held_until ${t.at} null, room_total ${money} null, ${t.fk('room_type_id', 'room_types')})`,
    `create table events (id ${t.key}, name ${t.text(40)} not null, doors_at ${t.at} null, sell_limit integer not null)`,
    `create table ticket_types (id ${t.key}, event_id integer not null, name ${t.text(40)} not null, capacity integer not null, ${t.fk('event_id', 'events')})`,
    `create table orders (id ${t.key}, status ${t.text(16)} not null default 'held', held_until ${t.at} null)`,
    `create table tickets (id ${t.key}, order_id integer not null, ticket_type_id integer not null, event_id integer null, status ${t.text(16)} not null default 'valid', ${t.fk('order_id', 'orders')}, ${t.fk('ticket_type_id', 'ticket_types')}, ${t.fk('event_id', 'events')})`,
    `create table bookings (id ${t.key}, event_id integer null, type_id integer null, received ${money} not null, owed ${money} null, ${t.fk('event_id', 'events')}, ${t.fk('type_id', 'ticket_types')})`,
  ];
}

async function venue(dialect: Dialect): Promise<World> {
  return filled(
    dialect,
    {
      zone: ZONE,
      ddl: venueDdl,
      overrides: (id) => [
        {
          op: 'table.capacity',
          table: 'stays',
          value: {
            kind: 'night',
            from: 'arrive',
            to: 'depart',
            countWhere: { column: 'status', values: ['booked', 'in_house', 'held'] },
            hold: { states: ['held'], column: 'held_until' },
            pool: {
              via: 'room_type_id',
              count: { table: id('rooms'), column: 'room_type_id', outOfService: { table: id('room_closures'), room: 'room_id', from: 'from_date', to: 'to_date', active: 'active' } },
            },
          },
        },
        {
          op: 'column.perNight',
          table: 'stays',
          column: 'room_total',
          value: {
            from: 'arrive',
            to: 'depart',
            rate: { via: 'room_type_id', column: 'base_rate' },
            adjust: { table: id('rate_rules'), match: { via: 'room_type_id', weekdays: 'weekdays' }, add: 'amount', name: 'name' },
          },
        },
        { op: 'column.copy', table: 'tickets', column: 'event_id', value: { via: 'ticket_type_id', from: 'event_id' } },
        {
          op: 'table.capacity',
          table: 'tickets',
          value: {
            kind: 'parent',
            via: 'ticket_type_id',
            size: { column: 'capacity' },
            also: [{ via: 'event_id', size: { column: 'sell_limit' } }],
            countWhere: [
              { column: 'status', values: ['valid'] },
              { via: 'order_id', column: 'status', values: ['held', 'paid'] },
            ],
            hold: { via: 'order_id', states: ['held'], column: 'held_until' },
          },
        },
      ],
    },
    async (w) => {
      await w.seed('room_types', [
        { id: 1, name: 'Loft', base_rate: '100.00' },
        { id: 2, name: 'Garden', base_rate: '150.00' },
      ]);
      await w.seed('rooms', [
        { id: 1, room_type_id: 1, number: '101', floor: 1 },
        { id: 2, room_type_id: 1, number: '102', floor: 1 },
        { id: 3, room_type_id: 2, number: '201', floor: 2 },
        { id: 4, room_type_id: 2, number: '202', floor: 2 },
        { id: 5, room_type_id: 2, number: '203', floor: 2 },
      ]);
      await w.seed('room_closures', [
        // Ended on Sunday: back in service.
        { id: 1, room_id: 1, reason: 'Paint', from_date: '2026-07-20', to_date: '2026-07-26', active: true, made_at: iso('2026-07-19 09:00') },
        // Out with no end: out tonight and on.
        { id: 2, room_id: 5, reason: 'Waiting on the window repair', from_date: '2026-07-20', to_date: null, active: true, made_at: iso('2026-07-27 10:00') },
        // Ends today on the venue's calendar (already yesterday in UTC).
        { id: 3, room_id: 2, reason: 'Leak in the shower', from_date: '2026-08-10', to_date: '2026-07-27', active: true, made_at: iso('2026-07-27 23:10') },
        // Called off: no longer a closure, whatever its dates.
        { id: 4, room_id: 3, reason: 'Carpet', from_date: '2026-07-01', to_date: null, active: false, made_at: iso('2026-07-01 08:00') },
        // Ahead.
        { id: 5, room_id: 4, reason: null, from_date: '2026-08-01', to_date: '2026-08-04', active: true, made_at: iso('2026-07-28 00:10') },
      ]);
      // Saturdays cost more in a Loft.
      await w.seed('rate_rules', [{ id: 1, room_type_id: 1, name: 'Weekend', weekdays: 'sat', amount: '20.00' }]);
      await w.seed('stays', [
        // Loft, Sunday to Wednesday: priced as the rates say (3 × 100).
        { id: 1, arrive: '2026-07-26', depart: '2026-07-29', room_type_id: 1, status: 'booked', room_total: '300.00' },
        // Garden, one night: tonight.
        { id: 2, arrive: '2026-07-27', depart: '2026-07-28', room_type_id: 2, status: 'in_house', room_total: '150.00' },
        // Cancelled: counts for nothing.
        { id: 3, arrive: '2026-07-27', depart: '2026-07-28', room_type_id: 2, status: 'cancelled', room_total: '150.00' },
        // Loft, priced before the rates changed: 250 for two nights, where the rates now say 200.
        { id: 4, arrive: '2026-07-27', depart: '2026-07-29', room_type_id: 1, status: 'booked', room_total: '250.00' },
        // Next Saturday: not tonight.
        { id: 5, arrive: '2026-08-01', depart: '2026-08-02', room_type_id: 1, status: 'booked', room_total: '120.00' },
        // Garden tonight, in a checkout for ten more minutes: taken, and earning nothing yet.
        { id: 6, arrive: '2026-07-27', depart: '2026-07-28', room_type_id: 2, status: 'held', held_until: iso('2026-07-27 23:40'), room_total: '150.00' },
      ]);
      await w.seed('events', [
        { id: 1, name: 'Neon Circuit', doors_at: iso('2026-07-28 20:00'), sell_limit: 414 },
        { id: 2, name: 'Velvet Hour', doors_at: iso('2026-07-31 19:30'), sell_limit: 100 },
        { id: 3, name: 'Paper Moons', doors_at: iso('2026-07-20 20:00'), sell_limit: 50 },
        { id: 4, name: 'To be announced', doors_at: null, sell_limit: 80 },
      ]);
      await w.seed('ticket_types', [
        { id: 1, event_id: 1, name: 'Standing', capacity: 300 },
        { id: 2, event_id: 1, name: 'Balcony', capacity: 114 },
        { id: 3, event_id: 2, name: 'Seated', capacity: 100 },
      ]);
      await w.seed('orders', [
        { id: 1, status: 'paid', held_until: null },
        { id: 2, status: 'held', held_until: iso('2026-07-27 23:40') },
        // A checkout that ran out: counts for nothing.
        { id: 3, status: 'held', held_until: iso('2026-07-27 23:00') },
      ]);
      await w.seed('tickets', [
        ...Array.from({ length: 5 }, () => ({ order_id: 1, ticket_type_id: 1, event_id: 1, status: 'valid' })),
        ...Array.from({ length: 2 }, () => ({ order_id: 2, ticket_type_id: 2, event_id: 1, status: 'valid' })),
        { order_id: 3, ticket_type_id: 2, event_id: 1, status: 'valid' },
        ...Array.from({ length: 3 }, () => ({ order_id: 1, ticket_type_id: 3, event_id: 2, status: 'valid' })),
      ]);
      await w.seed('bookings', [
        { id: 1, event_id: 1, type_id: 1, received: '100.10', owed: '0.00' },
        { id: 2, event_id: 1, type_id: 2, received: '50.20', owed: '25.00' },
        { id: 3, event_id: 2, type_id: 3, received: '300.00', owed: '12.50' },
        { id: 4, event_id: 3, type_id: null, received: '1920.00', owed: '0.00' },
        { id: 5, event_id: 4, type_id: null, received: '10.00', owed: '10.00' },
      ]);
    },
  );
}

/** Widget-data reads as the super admin, or as a desk that reads only some tables (one sign-in each: sign-ins are rate limited). */
function reader(w: World) {
  const cookies = new Map<string, string>();
  let members = 0;
  const post = async (cookie: string, descriptor: Record<string, unknown>, params?: Record<string, unknown>): Promise<Reply> => {
    const res = await w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie }, payload: { descriptor, ...(params === undefined ? {} : { params }) } as never });
    return { status: res.statusCode, body: (res.body === '' ? {} : JSON.parse(res.body)) as Record<string, unknown> };
  };
  const source = (table: string) => {
    const id = w.id(table);
    return { name: table, ...(id.includes('.') ? { schema: id.split('.')[0] } : {}) };
  };
  const card = (table: string, rest: Record<string, unknown>) => ({ connectionId: w.connectionId, source: source(table), ...rest });
  return {
    /** A staff write through the data route, as the super admin (after a first `admin` read). */
    write: async (table: string, values: Record<string, unknown>) =>
      w.app.inject({ method: 'POST', url: `/api/v1/data/${w.connectionId}/${w.id(table)}`, headers: { cookie: cookies.get('*') ?? '' }, payload: { values } as never }),
    admin: async (table: string, rest: Record<string, unknown>, params?: Record<string, unknown>) => {
      let cookie = cookies.get('*');
      if (cookie === undefined) {
        await w.staff('rooms'); // makes the super admin
        cookie = (await login(w.app as never, ADMIN_EMAIL, ADMIN_PASSWORD)).cookie ?? '';
        cookies.set('*', cookie);
      }
      return post(cookie, card(table, rest), params);
    },
    desk: async (tables: readonly string[], table: string, rest: Record<string, unknown>, params?: Record<string, unknown>) => {
      const key = tables.join(',');
      let cookie = cookies.get(key);
      if (cookie === undefined) {
        members += 1;
        const role = await rolesRepo(w.meta).create({ slug: `overview-desk-${String(members)}`, name: `Overview desk ${String(members)}` });
        for (const name of tables) {
          await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${w.id(name)}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
        }
        const email = `overview${String(members)}@venue.example.com`;
        const user = await usersRepo(w.meta).create({ email, name: `Overview ${String(members)}`, passwordHash: await adminPasswordHash(), status: 'active' });
        await rolesRepo(w.meta).assignToUser(user.id, role.id);
        cookie = (await login(w.app as never, email, ADMIN_PASSWORD)).cookie ?? '';
        cookies.set(key, cookie);
      }
      return post(cookie, card(table, rest), params);
    },
  };
}

const ok = (reply: Reply) => {
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body['result'] as Record<string, unknown>;
};
const refused = (reply: Reply) => [reply.status, (reply.body['error'] as { code?: string } | undefined)?.code];
const ids = (result: Record<string, unknown>) => (result['rows'] as { id: unknown }[]).map((row) => Number(row.id));

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an overview's cards on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it('lists the rooms out of service today or later: filters joined by or and and, on the venue\'s day', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      const list = (filters: unknown[], params?: Record<string, unknown>) =>
        cards.admin('room_closures', { shape: 'record-list', select: ['id', 'reason', 'to_date'], filters, orderBy: [{ column: 'id', dir: 'asc' }] }, params);

      // Active, and ending today or later or with no end: the ended one and the called-off one are out.
      const outOfService = [
        { column: 'active', op: 'eq', value: true },
        { or: [{ column: 'to_date', op: 'gte', day: 'today' }, { column: 'to_date', op: 'is_null' }] },
      ];
      const today = ok(await list(outOfService));
      expect(ids(today)).toEqual([2, 3, 5]);
      expect(today['total']).toBe(3);
      // The same, one `and` group deep, and with the `or` two deep.
      expect(ids(ok(await list([{ and: outOfService }])))).toEqual([2, 3, 5]);
      expect(ids(ok(await list([{ and: [{ column: 'active', op: 'eq', value: true }, { or: [{ column: 'to_date', op: 'gte', day: 'today' }, { column: 'to_date', op: 'is_null' }] }] }])))).toEqual([2, 3, 5]);
      // A day from today: ending tomorrow or later drops the one ending today.
      expect(ids(ok(await list([{ column: 'active', op: 'eq', value: true }, { or: [{ column: 'to_date', op: 'gte', day: 'today+1' }, { column: 'to_date', op: 'is_null' }] }])))).toEqual([2, 5]);

      // A day on a time column is the venue's whole day: made today, where the venue is.
      expect(ids(ok(await list([{ column: 'made_at', op: 'eq', day: 'today' }])))).toEqual([2, 3]);
      expect(ids(ok(await list([{ column: 'made_at', op: 'lte', day: 'today' }])))).toEqual([1, 2, 3, 4]);
      expect(ids(ok(await list([{ column: 'made_at', op: 'gt', day: 'today' }])))).toEqual([5]);

      // A filter one link away inside a group: on the second floor, or a leak.
      expect(ids(ok(await list([{ or: [{ column: 'room_id.floor', op: 'eq', value: 2 }, { column: 'reason', op: 'like', value: '%Leak%' }] }])))).toEqual([2, 3, 4, 5]);

      // An unset control is no filter: in an `or` it keeps every row, in an `and` it drops out.
      const either = [{ or: [{ column: 'reason', op: 'eq', param: 'reason' }, { column: 'to_date', op: 'is_null' }] }];
      expect(ids(ok(await list(either)))).toEqual([1, 2, 3, 4, 5]);
      expect(ids(ok(await list(either, { reason: 'Paint' })))).toEqual([1, 2, 4]);
      const both = [{ and: [{ column: 'reason', op: 'eq', param: 'reason' }, { column: 'active', op: 'eq', value: true }] }];
      expect(ids(ok(await list(both)))).toEqual([1, 2, 3, 5]);
      expect(ids(ok(await list(both, { reason: 'Carpet' })))).toEqual([]);

      // A kept answer is for the venue's day it was made on: past midnight, "today" is tomorrow.
      // Ten seconds before the venue's midnight, then five after: well inside the answer's 30 s.
      const midnight = at('2026-07-28 00:00').getTime();
      vi.setSystemTime(new Date(midnight - 10_000));
      expect(ids(ok(await list(outOfService)))).toEqual([2, 3, 5]);
      expect((await list(outOfService)).body['cached']).toBe(true);
      vi.setSystemTime(new Date(midnight + 5_000));
      const tomorrow = await list(outOfService);
      expect(tomorrow.body['cached']).toBe(false);
      expect(ids(ok(tomorrow))).toEqual([2, 5]);
      vi.setSystemTime(NOW);

      // Counted like the list: a KPI of the same filters.
      const count = ok(await cards.admin('room_closures', { shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'n' }], filters: outOfService }));
      expect(count['value']).toBe(3);
    });

    it('refuses filters it cannot read as written, and a link its reader may not follow', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      const list = (filters: unknown[]) => cards.admin('room_closures', { shape: 'record-list', select: ['id'], filters });
      const condition = { column: 'active', op: 'eq', value: true };
      // Seventeen conditions in all, however they are grouped.
      expect(refused(await list([{ or: Array.from({ length: 9 }, () => condition) }, { and: Array.from({ length: 8 }, () => condition) }]))).toEqual([422, 'VALIDATION_FAILED']);
      // A third group deep, an empty group: the descriptor itself is refused.
      expect(refused(await list([{ or: [{ and: [{ or: [condition] }] }] }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await list([{ or: [] }]))).toEqual([422, 'VALIDATION_FAILED']);
      // A day and a value at once; a day on text; a day that is not one; a day with `in`.
      expect(refused(await list([{ column: 'to_date', op: 'gte', day: 'today', value: '2026-07-01' }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await list([{ column: 'reason', op: 'eq', day: 'today' }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await list([{ column: 'to_date', op: 'eq', day: '2026-02-30' }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await list([{ column: 'to_date', op: 'in', day: 'today' }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await list([{ column: 'to_date', op: 'gte', day: 'today+9999' }]))).toEqual([422, 'VALIDATION_FAILED']);
      // `neq` a day: a date column only (on a time a day is a span).
      expect(refused(await list([{ column: 'made_at', op: 'neq', day: 'today' }]))).toEqual([422, 'VALIDATION_FAILED']);
      expect(ok(await list([{ column: 'to_date', op: 'neq', day: 'today' }]))['total']).toBe(2);
      // A link inside a group is read-checked as one outside it is.
      const linked = [{ or: [{ column: 'room_id.floor', op: 'eq', value: 2 }, { column: 'reason', op: 'is_null' }] }];
      expect(refused(await cards.desk(['room_closures'], 'room_closures', { shape: 'record-list', select: ['id'], filters: linked }))).toEqual([403, 'TABLE_FORBIDDEN']);
      expect(ok(await cards.desk(['room_closures', 'rooms'], 'room_closures', { shape: 'record-list', select: ['id'], filters: linked }))['total']).toBe(3);
    });

    it('draws received and still owed by show, in the shows\' date order', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      const money = (orderBy?: unknown[]) =>
        cards.admin('bookings', {
          shape: 'categorical',
          groupBy: ['event_id'],
          groupLabel: 'event_id.name',
          aggregations: [
            { fn: 'sum', column: 'received', alias: 'received' },
            { fn: 'sum', column: 'owed', alias: 'owed' },
          ],
          ...(orderBy === undefined ? {} : { orderBy }),
        });
      const byDate = ok(await money([{ column: 'event_id.doors_at', dir: 'asc' }]));
      // Paper Moons (20 Jul), Neon Circuit (28 Jul), Velvet Hour (31 Jul); the show with no date last.
      expect(byDate['aggregates']).toEqual(['received', 'owed']);
      expect(byDate['items']).toEqual([
        { key: '3', label: 'Paper Moons', value: 1920, values: { received: 1920, owed: 0 } },
        { key: '1', label: 'Neon Circuit', value: 150.3, values: { received: 150.3, owed: 25 } },
        { key: '2', label: 'Velvet Hour', value: 300, values: { received: 300, owed: 12.5 } },
        { key: '4', label: 'To be announced', value: 10, values: { received: 10, owed: 10 } },
      ]);
      const labels = (result: Record<string, unknown>) => (result['items'] as { label: string }[]).map((item) => item.label);
      expect(labels(ok(await money([{ column: 'event_id.doors_at', dir: 'desc' }])))).toEqual(['Velvet Hour', 'Neon Circuit', 'Paper Moons', 'To be announced']);
      // By the second figure; by the label; by the group's key.
      expect(labels(ok(await money([{ column: 'owed', dir: 'desc' }])))).toEqual(['Neon Circuit', 'Velvet Hour', 'To be announced', 'Paper Moons']);
      expect(labels(ok(await money([{ column: 'event_id.name', dir: 'asc' }])))).toEqual(['Neon Circuit', 'Paper Moons', 'To be announced', 'Velvet Hour']);
      expect(labels(ok(await money([{ column: 'event_id', dir: 'desc' }])))).toEqual(['To be announced', 'Paper Moons', 'Velvet Hour', 'Neon Circuit']);
      // Unordered, as before: the first figure, biggest first.
      expect(labels(ok(await money()))).toEqual(['Paper Moons', 'Velvet Hour', 'Neon Circuit', 'To be announced']);
      // A limit keeps the first shows in the order asked.
      const two = ok(await cards.admin('bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'sum', column: 'received', alias: 'received' }], orderBy: [{ column: 'event_id.doors_at', dir: 'asc' }], limit: 2 }));
      expect((two['items'] as { key: string }[]).map((item) => item.key)).toEqual(['3', '1']);
      expect(two['aggregates']).toBeUndefined();

      // Coming shows only: a venue day one link away (the show's doors, from today on).
      const coming = ok(await cards.admin('bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'sum', column: 'received', alias: 'received' }], filters: [{ column: 'event_id.doors_at', op: 'gte', day: 'today' }], orderBy: [{ column: 'event_id.doors_at', dir: 'asc' }] }));
      expect((coming['items'] as { key: string }[]).map((item) => item.key)).toEqual(['1', '2']);

      // A figure over nothing but empty values (no owed amount on To be announced's bookings) is last, on every engine.
      await w.query('update bookings set owed = null where event_id = 4');
      for (const dir of ['asc', 'desc'] as const) {
        const ranked = ok(await cards.admin('bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'max', column: 'owed', alias: 'owed' }], orderBy: [{ column: 'owed', dir }] }));
        expect((ranked['items'] as { key: string }[]).at(-1)?.key).toBe('4');
      }
      const unordered = ok(await cards.admin('bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'max', column: 'owed', alias: 'owed' }], limit: 3 }));
      expect((unordered['items'] as { key: string }[]).map((item) => item.key)).toEqual(['1', '2', '3']);

      // An alias that is not a plain name (it would read as a table and a column): refused by name, never run.
      expect(refused(await cards.admin('bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'sum', column: 'received', alias: 'event_id.name' }], orderBy: [{ column: 'event_id.name', dir: 'asc' }] }))).toEqual([422, 'VALIDATION_FAILED']);

      // Through another link: no one value per show — refused.
      expect(refused(await money([{ column: 'type_id.name', dir: 'asc' }]))).toEqual([422, 'VALIDATION_FAILED']);
      // The shows' dates are read as a filter's are: a desk that may not read the shows may not order by them.
      const desk = await cards.desk(['bookings'], 'bookings', { shape: 'categorical', groupBy: ['event_id'], aggregations: [{ fn: 'sum', column: 'received', alias: 'received' }], orderBy: [{ column: 'event_id.doors_at', dir: 'asc' }] });
      expect(refused(desk)).toEqual([403, 'TABLE_FORBIDDEN']);
    });

    it("shows how full the house is tonight and what its rooms earn, against last night, on the venue's night", async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      const kpi = (shape: string, metric?: string, more: Record<string, unknown> = {}, params?: Record<string, unknown>) =>
        cards.admin('stays', { kind: 'capacity-counts', shape, capacity: { ...(metric === undefined ? {} : { metric }), ...more } }, params);

      // Tonight (Monday 27 on the venue's calendar): 4 rooms we can sell (203 is out), all 4 taken, one of them held.
      expect(ok(await kpi('single-metric'))['value']).toBe(4);
      expect(ok(await kpi('single-metric', 'size'))['value']).toBe(4);
      expect(ok(await kpi('single-metric', 'left'))['value']).toBe(0);
      expect(ok(await kpi('single-metric', 'held'))['value']).toBe(1);
      const full = ok(await kpi('metric+delta', 'occupancy'));
      // Last night: one Loft taken of three rooms (101 was still being painted).
      expect(full).toMatchObject({ shape: 'metric+delta', value: 1 });
      expect(full['prior']).toBeCloseTo(1 / 3, 10);
      expect(full['deltaPct']).toBeCloseTo(2, 10);
      expect(full['capacity']).toMatchObject({ kind: 'night', date: '2026-07-27', days: 1 });
      // Each room's own rate tonight: 100 (Loft) + 150 (Garden) + 125 (a Loft priced before the rates changed: half its 250); the held Garden earns nothing yet.
      const earned = ok(await kpi('metric+delta', 'earnings'));
      expect(earned).toMatchObject({ value: 375, prior: 100 });
      // One room type only; the page's day control naming Saturday (the weekend rate).
      expect(ok(await kpi('single-metric', 'earnings', { ids: ['2'] }))['value']).toBe(150);
      expect(ok(await kpi('single-metric', 'earnings', {}, { day: '2026-08-01' }))['value']).toBe(120);
      // The day control's week, Monday on: seven nights added up.
      expect(ok(await kpi('single-metric', 'taken', {}, { day: 'week' }))['value']).toBe(7);
      expect(ok(await kpi('single-metric', 'earnings', {}, { day: 'week' }))['value']).toBe(720);

      // What cannot be answered, said: a list takes no figure; earnings for a table priced by no night.
      expect(refused(await kpi('record-list', 'occupancy'))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await cards.admin('tickets', { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'earnings', under: 'event_id', value: '1' } }))).toEqual([422, 'VALIDATION_FAILED']);
      // A parent limit without days: one figure, no span before it.
      const sold = ok(await cards.admin('tickets', { kind: 'capacity-counts', shape: 'metric+delta', capacity: { metric: 'taken', under: 'event_id', value: '1' } }));
      expect(sold).toMatchObject({ value: 7 });
      expect(sold['prior']).toBeUndefined();
      expect(ok(await cards.admin('tickets', { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'occupancy', ids: ['2'] } }))['value']).toBeCloseTo(2 / 114, 10);
    });

    it('reads each rate once for an answer, however many stays it prices', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      // Forty more stays this week, Lofts and Gardens.
      await w.seed(
        'stays',
        Array.from({ length: 40 }, (_, i) => ({ arrive: `2026-07-${String(27 + (i % 4))}`, depart: `2026-07-${String(28 + (i % 4))}`, room_type_id: 1 + (i % 2), status: 'booked', room_total: i % 2 === 0 ? '100.00' : '150.00' })),
      );
      const target = await w.target('stays');
      const statements = async (metric: 'earnings' | 'taken') => {
        let count = 0;
        const db = target.db.withPlugin({ transformQuery: (args) => ((count += 1), args.node), transformResult: async (args) => args.result });
        const answer = await answerCapacityCounts({
          descriptor: queryDescriptorSchema.parse({ kind: 'capacity-counts', connectionId: w!.connectionId, source: { name: 'stays' }, shape: 'metric+delta', capacity: { metric } }),
          params: { day: 'week' },
          connectionId: w!.connectionId,
          view: target.view,
          table: target.table,
          db,
          dialect: target.dialect,
          timezone: ZONE,
          now: NOW,
          access: { table: async () => undefined, column: async () => undefined },
          canReadPii: async () => true,
          currency: 'USD',
        });
        return { count, value: (answer as { value: unknown }).value };
      };
      const taken = await statements('taken');
      const earned = await statements('earnings');
      // Two rates (Loft, Garden), each with its rules, read once each for the week and once for the week before.
      expect(earned.count - taken.count).toBeLessThanOrEqual(2 * (2 + 2) + 2);
      expect(earned.value).toBe(720 + 20 * 100 + 20 * 150);

      // A table that keeps each row's currency: its prices do not add up to one amount — refused, never summed.
      const model = structuredClone(target.view.model);
      const stays = model.tables.find((table) => table.id === target.table.id)!;
      (stays.columns as unknown[]).push({ ...stays.columns.find((column) => column.name === 'status')!, name: 'currency' });
      const priced = new SnapshotView(w.connectionId, model);
      await expect(
        answerCapacityCounts({
          descriptor: queryDescriptorSchema.parse({ kind: 'capacity-counts', connectionId: w.connectionId, source: { name: 'stays' }, shape: 'single-metric', capacity: { metric: 'earnings' } }),
          params: {},
          connectionId: w.connectionId,
          view: priced,
          table: priced.table(target.table.id),
          db: target.db,
          dialect: target.dialect,
          timezone: ZONE,
          now: NOW,
          access: { table: async () => undefined, column: async () => undefined },
          canReadPii: async () => true,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { metric: 'earnings', column: 'currency' } });
    });

    it('says nothing is full where nothing can be sold, and refuses earnings to a reader who may not see them', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      // Every Garden room out tonight: nothing to take in that type — no figure, never a division by zero.
      await w.seed('room_closures', [
        { room_id: 3, reason: 'Flood', from_date: '2026-07-27', to_date: '2026-07-27', active: true },
        { room_id: 4, reason: 'Flood', from_date: '2026-07-27', to_date: '2026-07-27', active: true },
      ]);
      const garden = ok(await cards.admin('stays', { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'occupancy', ids: ['2'] } }));
      expect(garden['value']).toBeNull();

      const earnings = { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'earnings' } };
      // The rates' table unread: refused as the desk's nightly lines are.
      expect(refused(await cards.desk(['stays', 'rooms', 'room_closures'], 'stays', earnings))).toEqual([403, 'TABLE_FORBIDDEN']);
      const all = ['stays', 'rooms', 'room_closures', 'room_types', 'rate_rules'];
      expect(ok(await cards.desk(all, 'stays', earnings))['value']).toBe(375);
      // The price masked for this reader: refused, never read.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: w.id('stays'), columnName: 'room_total', value: { masked: true, kind: 'financial' } as never });
      expect(refused(await cards.desk([...all, 'events'], 'stays', earnings))).toEqual([403, 'COLUMN_FORBIDDEN']);
      // Occupancy reads no price: still answered (four rooms taken of the two left to sell: over-sold, and said so).
      expect(ok(await cards.desk([...all, 'events'], 'stays', { ...earnings, capacity: { metric: 'occupancy' } }))['value']).toBe(2);
    });

    it('lists the coming shows with their tickets sold and held of what each can sell', async () => {
      vi.setSystemTime(NOW);
      w = await venue(dialect);
      const cards = reader(w);
      const coming = {
        shape: 'record-list',
        select: ['id', 'name', 'doors_at'],
        window: { column: 'doors_at', last: 1, unit: 'day', ahead: true },
        orderBy: [{ column: 'doors_at', dir: 'asc' }],
        counts: { table: 'tickets', as: 'sold' },
      };
      const shows = ok(await cards.admin('events', coming));
      // Neon: 5 paid + 2 in a checkout still running (the one that ran out counts for nothing) of 414.
      expect((shows['rows'] as Record<string, unknown>[]).map((row) => [Number(row['id']), row['sold']])).toEqual([
        [1, { taken: 7, held: 2, size: 414, left: 407 }],
        [2, { taken: 3, held: 0, size: 100, left: 97 }],
      ]);
      expect((shows['columns'] as { name: string; semantic?: string }[]).at(-1)).toEqual({ name: 'sold', logicalType: 'json', nullable: true, isPrimaryKey: false, semantic: 'capacity-bar' });

      // The limit's own pools: Neon's ticket types, each with its own.
      const typesOf = ok(await cards.admin('ticket_types', { shape: 'record-list', select: ['id', 'name'], filters: [{ column: 'event_id', op: 'eq', value: 1 }], orderBy: [{ column: 'id', dir: 'asc' }], counts: { table: 'tickets' } }));
      expect((typesOf['rows'] as Record<string, unknown>[]).map((row) => row['counts'])).toEqual([
        { taken: 5, held: 0, size: 300, left: 295 },
        { taken: 2, held: 2, size: 114, left: 112 },
      ]);
      // A night limit's pools: the room types, tonight.
      const roomTypes = { shape: 'record-list', select: ['id', 'name'], orderBy: [{ column: 'id', dir: 'asc' }], counts: { table: 'stays' } };
      const rooms = ok(await cards.admin('room_types', roomTypes));
      expect((rooms['rows'] as Record<string, unknown>[]).map((row) => row['counts'])).toEqual([
        { taken: 2, held: 0, size: 2, left: 0 },
        { taken: 2, held: 1, size: 2, left: 0 },
      ]);
      // Kept for a while, and dropped by a write to any table the counts read: a Garden room closed tonight.
      expect((await cards.admin('room_types', roomTypes)).body['cached']).toBe(true);
      const closed = await cards.write('room_closures', { room_id: 4, reason: 'Flood', from_date: '2026-07-27', to_date: '2026-07-27', active: true });
      expect(closed.statusCode, closed.body).toBe(201);
      const after = await cards.admin('room_types', roomTypes);
      expect(after.body['cached']).toBe(false);
      expect(((ok(after)['rows'] as Record<string, unknown>[])[1]!['counts'] as { size: number }).size).toBe(1);
      // The same for a KPI over the counts: a write to the ticket types' orders drops it.
      const kpi = { kind: 'capacity-counts', shape: 'single-metric', capacity: { metric: 'taken', under: 'event_id', value: '1' } };
      expect(ok(await cards.admin('tickets', kpi))['value']).toBe(7);
      expect((await cards.admin('tickets', kpi)).body['cached']).toBe(true);
      expect((await cards.write('orders', { status: 'paid' })).statusCode).toBe(201);
      expect((await cards.admin('tickets', kpi)).body['cached']).toBe(false);

      // Refused, by name: beside anything but a list; rows that are not the limit's pools; a list without the key; a name the list has.
      expect(refused(await cards.admin('events', { ...coming, shape: 'categorical', groupBy: ['name'], aggregations: [{ fn: 'count', alias: 'n' }], select: undefined, window: undefined, orderBy: undefined }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await cards.admin('orders', { shape: 'record-list', select: ['id'], counts: { table: 'tickets' } }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await cards.admin('events', { ...coming, select: ['name'] }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await cards.admin('events', { ...coming, counts: { table: 'tickets', as: 'name' } }))).toEqual([422, 'VALIDATION_FAILED']);
      expect(refused(await cards.admin('events', { ...coming, counts: { table: 'events' } }))).toEqual([422, 'VALIDATION_FAILED']);
      // The counts are read as the counts route reads them: the tickets, and every table the pools are kept in.
      expect(refused(await cards.desk(['events'], 'events', coming))).toEqual([403, 'TABLE_FORBIDDEN']);
      expect(refused(await cards.desk(['events', 'tickets'], 'events', coming))).toEqual([403, 'TABLE_FORBIDDEN']);
      expect(ok(await cards.desk(['events', 'tickets', 'ticket_types'], 'events', coming))['total']).toBe(2);
    });
  });
}

describe('a cached answer over a list and its counts', () => {
  it('is dropped by a write to either table', () => {
    const cache = new WidgetDataCache();
    cache.set('coming', { rows: [] }, 'c1', 'events', ['tickets']);
    cache.set('other', { rows: [] }, 'c1', 'events');
    cache.invalidateTable('c1', 'tickets');
    expect(cache.get('coming')).toBeUndefined();
    expect(cache.get('other')).toEqual({ rows: [] });
    cache.invalidateTable('c1', 'events');
    expect(cache.get('other')).toBeUndefined();
  });
});
