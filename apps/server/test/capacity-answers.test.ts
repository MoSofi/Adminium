// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a guest may ask of a limit over the public API, and what a refused
 * write tells them — per kind, on every engine, at a fixed time. Nothing is
 * faked below the HTTP route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overridesRepo } from '@adminium/meta';

import { filled, LEGS, types, type Dialect, type World } from './capacity.helpers.js';
import { at, house, iso, kitchen, neon, NEON_NOW } from './capacity-worlds.js';

/** Ticket types and cart lines, any number to an order: 260 places, `taken` taken. */
async function lines(dialect: Dialect, taken: number, showLeft: Record<string, number>): Promise<World> {
  return filled(
    dialect,
    {
      zone: 'Europe/London',
      ddl: (d) => {
        const t = types(d);
        return [
          `create table ticket_types (id ${t.key}, name ${t.text(40)}, capacity integer)`,
          `create table cart_lines (id ${t.key}, ticket_type_id integer not null, qty integer not null, ${t.fk('ticket_type_id', 'ticket_types')})`,
        ];
      },
      overrides: () => [{ op: 'table.capacity', table: 'cart_lines', value: { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' }, amount: 'qty' } }],
      endpoints: {
        ticket_types: { source: 'ticket_types', methods: ['GET'], select: ['id', 'name'] },
        lines_availability: { source: 'cart_lines', methods: ['GET'], kind: 'availability', show_left: showLeft },
      },
    },
    async (w) => {
      await w.seed('ticket_types', [{ id: 1, name: 'Standard', capacity: 260 }]);
      await w.seed('cart_lines', [{ ticket_type_id: 1, qty: taken }]);
    },
  );
}

const errorOf = (body: Record<string, unknown>) => body['error'] as { code: string; params?: Record<string, unknown> };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a limit's answers to a guest on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it('answers a kitchen day slot by slot, a strip of days, and a closed day with nothing', async () => {
      w = await kitchen(dialect, {
        orders: { source: 'orders', methods: ['POST'], select: ['id', 'pickup_at'], writable: ['pickup_at'], defaults: { status: 'placed' } },
        orders_availability: { source: 'orders', methods: ['GET'], kind: 'availability' },
      });
      vi.setSystemTime(at('2026-07-28 11:40'));
      const day = await w.get('availability/orders_availability?date=2026-07-28');
      expect(day.status, JSON.stringify(day.body)).toBe(200);
      const slots = Object.fromEntries((day.body['data'] as { time: string; state: string }[]).map((s) => [s.time, s.state]));
      // Noon is twenty minutes off: just in time; 12:15 has two of six; 12:30 is paused; the last slot starts at 20:45.
      expect(slots).toMatchObject({ '12:00': 'free', '12:15': 'free', '12:30': 'paused', '20:45': 'free' });
      expect(Object.keys(slots).at(-1)).toBe('20:45');
      expect(slots['21:00']).toBeUndefined();
      // Thursday is closed: no times at all.
      expect((await w.get('availability/orders_availability?date=2026-07-30')).body).toEqual({ data: [] });
      const strip = await w.get('availability/orders_availability?from=2026-07-27&days=4');
      expect(strip.body['data']).toEqual([
        { date: '2026-07-27', open: 0, state: 'closed' },
        { date: '2026-07-28', open: 35, state: 'open' },
        { date: '2026-07-29', open: 36, state: 'open' },
        { date: '2026-07-30', open: 0, state: 'closed' },
      ]);
      // What a slot does not take is refused, not ignored.
      expect(errorOf((await w.get('availability/orders_availability?date=2026-07-28&guests=2')).body).code).toBe('PUBLIC_QUERY_REFUSED');
      // A guest's order for the paused slot: refused with its column and why.
      const paused = await w.post('records/orders', { values: { pickup_at: iso('2026-07-28 12:30') } });
      expect(paused.status).toBe(400);
      expect(errorOf(paused.body)).toMatchObject({ code: 'PUBLIC_WRITE_REFUSED', params: { column: 'pickup_at', reason: 'paused' } });
      for (let i = 0; i < 4; i += 1) expect((await w.post('records/orders', { values: { pickup_at: iso('2026-07-28 12:15') } })).status).toBe(201);
      const full = await w.post('records/orders', { values: { pickup_at: iso('2026-07-28 12:15') } });
      expect(full.status).toBe(409);
      expect(errorOf(full.body)).toMatchObject({ code: 'PUBLIC_SLOT_FULL', params: { column: 'pickup_at' } });
    });

    it("lists a show's types a guest may see, says what is left only when it is low, and asks no more than an order takes", async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect, 300, {
        ticket_types: { source: 'ticket_types', methods: ['GET'], select: ['id', 'name'], filters: [{ column: 'visibility', op: 'eq', value: 'public' }] },
        tickets_availability: { source: 'tickets', methods: ['GET'], kind: 'availability', under: 'event_id', show_left: { below_share: 15 } },
        tickets: { source: 'tickets', methods: ['POST'], select: ['id'], writable: ['order_id', 'ticket_type_id'] },
      });
      const answer = await w.get('availability/tickets_availability?under=1');
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // The box office's guest list is never listed; 14 of 260 is under 15 %: shown.
      expect(answer.body['data']).toEqual([
        { id: '1', state: 'on', left: 14 },
        { id: '2', state: 'soon' },
      ]);
      // Asking for 20 is asking for 6, the most one order takes.
      expect((await w.get('availability/tickets_availability?under=1&qty=20')).body['data']).toMatchObject([{ id: '1', state: 'on' }, { id: '2' }]);
      // Another's held order named to be left out, with no session to own it: ignored, the same answer.
      expect((await w.get('availability/tickets_availability?under=1&exclude=2')).body['data']).toEqual(answer.body['data']);
      // A typed code travels in a header, never the URL (the header's own cases are the typed codes' tests).
      expect(errorOf((await w.get('availability/tickets_availability?under=1&code=BLOOMEARLY')).body).code).toBe('PUBLIC_QUERY_REFUSED');
      // No event asked: nothing listed.
      expect((await w.get('availability/tickets_availability')).body['data']).toEqual([]);
      // Several events in one ask (a page of shows): each one's rows, in one list — a show nobody has adds none.
      expect((await w.get('availability/tickets_availability?under=999,1')).body['data']).toEqual(answer.body['data']);
      expect((await w.get('availability/tickets_availability?under=999,998')).body['data']).toEqual([]);
      // Eleven minutes on, the hold is over: 17 left, still under 15 %.
      vi.setSystemTime(new Date(NEON_NOW.getTime() + 11 * 60_000));
      expect((await w.get('availability/tickets_availability?under=1')).body['data']).toEqual([
        { id: '1', state: 'on', left: 17 },
        { id: '2', state: 'soon' },
      ]);
      // 40 left is above 15 % of 260: not shown.
      await w.query('delete from tickets where id <= 23');
      expect((await w.get('availability/tickets_availability?under=1')).body['data']).toEqual([
        { id: '1', state: 'on' },
        { id: '2', state: 'soon' },
      ]);
      // A guest's line past the last place: sold out, naming the line's column.
      await w.query('update ticket_types set capacity = 220 where id = 1');
      const order = await w.create('orders', { status: 'held', held_until: new Date(Date.now() + 600_000).toISOString() });
      const refused = await w.post('records/tickets', { values: { order_id: order['id'], ticket_type_id: 1 } });
      expect(refused.status).toBe(409);
      expect(errorOf(refused.body)).toEqual({ code: 'PUBLIC_SOLD_OUT', params: { column: 'ticket_type_id' }, message: 'That is sold out.' });
    });

    it('asks no more of a pool than the entry would say is left, where one order may take any number', async () => {
      w = await lines(dialect, 246, { below: 10 });
      // 14 left, not below 10: not said. Asking whether 15 are left would say it.
      expect((await w.get('availability/lines_availability')).body['data']).toEqual([{ id: '1', state: 'on' }]);
      expect((await w.get('availability/lines_availability?qty=15')).body['data']).toEqual([{ id: '1', state: 'on' }]);
      expect((await w.get('availability/lines_availability?qty=50')).body['data']).toEqual([{ id: '1', state: 'on' }]);
      // Nine left: said, and asking for ten is sold out.
      await w.seed('cart_lines', [{ ticket_type_id: 1, qty: 5 }]);
      expect((await w.get('availability/lines_availability?qty=10')).body['data']).toEqual([{ id: '1', state: 'soldout', left: 9 }]);
      await w.close();
      // Said below 5 % of 260 (13): 14 left is not said, and 14 may not be asked.
      w = await lines(dialect, 246, { below_share: 5 });
      expect((await w.get('availability/lines_availability?qty=14')).body['data']).toEqual([{ id: '1', state: 'on' }]);
    });

    it("lists only the room types a guest may read", async () => {
      vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
      w = await house(dialect, {
        room_types: { source: 'room_types', methods: ['GET'], select: ['id', 'name'], filters: [{ column: 'name', op: 'neq', value: 'Harbour' }] },
        stays_availability: { source: 'stays', methods: ['GET'], kind: 'availability' },
      });
      const answer = await w.get('availability/stays_availability?from=2026-07-31&to=2026-08-02');
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect((answer.body['data'] as { pool: string }[]).map((p) => p.pool)).toEqual(['1', '2']);
      await w.close();
      // No plain public read of the room types: none listed.
      w = await house(dialect, { stays_availability: { source: 'stays', methods: ['GET'], kind: 'availability' } });
      expect((await w.get('availability/stays_availability?from=2026-07-31&to=2026-08-02')).body['data']).toEqual([]);
    });

    it('answers each room type over a stay, drops the ones too small, and finds the earliest arrival with room', async () => {
      vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
      w = await house(dialect, {
        room_types: { source: 'room_types', methods: ['GET'], select: ['id', 'name'] },
        stays: { source: 'stays', methods: ['POST'], select: ['id'], writable: ['arrive', 'depart', 'room_type_id'] },
        stays_availability: { source: 'stays', methods: ['GET'], kind: 'availability', show_left: { below: 3 } },
      });
      for (let i = 0; i < 4; i += 1) await w.create('stays', { arrive: '2026-07-31', depart: '2026-08-03', room_type_id: 1 });
      await w.create('stays', { arrive: '2026-07-31', depart: '2026-08-01', room_type_id: 3 });
      const answer = await w.get('availability/stays_availability?from=2026-07-31&to=2026-08-02&earliest=10');
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      expect(answer.body).toEqual({
        data: [
          { pool: '1', state: 'full', left: 0, earliest: '2026-08-03' },
          { pool: '2', state: 'open', earliest: '2026-08-01' },
          { pool: '3', state: 'open', left: 2, earliest: '2026-08-01' },
        ],
        earliest: '2026-08-01',
      });
      // Three guests: only the Garden rooms sleep three.
      expect((await w.get('availability/stays_availability?from=2026-07-31&to=2026-08-02&guests=3')).body['data']).toEqual([{ pool: '2', state: 'open' }]);
      // A one-night Saturday arrival is not a stay the house sells.
      expect((await w.get('availability/stays_availability?from=2026-08-01&to=2026-08-02')).body['data']).toMatchObject([{ state: 'closed' }, { state: 'closed' }, { state: 'closed' }]);
      expect(errorOf((await w.get('availability/stays_availability?from=2026-07-31')).body).code).toBe('PUBLIC_QUERY_REFUSED');
      const noRoom = await w.post('records/stays', { values: { arrive: '2026-07-31', depart: '2026-08-02', room_type_id: 1 } });
      expect(noRoom.status).toBe(409);
      expect(errorOf(noRoom.body)).toMatchObject({ code: 'PUBLIC_NO_ROOM', params: { column: 'room_type_id' } });
    });
  });
}

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a limit's counts for the desk on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it("answers the kitchen's slots, the box office's types and the house's nights with sizes, what is taken, held and left", async () => {
      vi.setSystemTime(at('2026-07-28 11:40'));
      w = await kitchen(dialect);
      const slots = await w.staff('orders/capacity-counts?date=2026-07-28');
      expect(slots.status, JSON.stringify(slots.body)).toBe(200);
      const data = slots.body['data'] as { kind: string; rows: Record<string, unknown>[] };
      expect(data.kind).toBe('slot');
      expect(data.rows.find((r) => r['time'] === '12:15')).toEqual({ time: '12:15', size: 6, taken: 2, held: 0 });
      expect(data.rows.find((r) => r['time'] === '12:30')).toEqual({ time: '12:30', size: 6, taken: 0, held: 0, paused: true });
      const days = ((await w.staff('orders/capacity-counts?from=2026-07-28&days=3')).body['data'] as { rows: unknown[] }).rows;
      expect(days).toEqual([
        { date: '2026-07-28', size: 216, taken: 2, held: 0 },
        { date: '2026-07-29', size: 216, taken: 0, held: 0 },
        { date: '2026-07-30', size: 216, taken: 0, held: 0, closed: true },
      ]);
      expect((await w.staff('orders/capacity-counts?rule=1&date=2026-07-28')).status).toBe(422);
      await w.close();

      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      const types = await w.staff('tickets/capacity-counts?under=event_id&value=1');
      expect(types.status, JSON.stringify(types.body)).toBe(200);
      expect((types.body['data'] as { rows: unknown[] }).rows).toEqual([
        { id: '1', size: 260, taken: 246, held: 3, kept: 0, left: 14, also: [{ key: '1', size: 300, taken: 246, held: 3 }] },
        { id: '2', size: 40, taken: 0, held: 0, kept: 0, left: 40, also: [{ key: '1', size: 300, taken: 246, held: 3 }] },
        { id: '3', size: 20, taken: 0, held: 0, kept: 0, left: 20, also: [{ key: '1', size: 300, taken: 246, held: 3 }] },
      ]);
      // A page of shows in one ask: each row says which show it is under; an unknown show adds none.
      const page = await w.staff('tickets/capacity-counts?under=event_id&values=1,999');
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      expect((page.body['data'] as { rows: { id: string; under?: string }[] }).rows.map((row) => [row.id, row.under])).toEqual([
        ['1', '1'],
        ['2', '1'],
        ['3', '1'],
      ]);
      await w.close();

      vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
      w = await house(dialect);
      await w.create('stays', { arrive: '2026-07-31', depart: '2026-08-02', room_type_id: 1 });
      const nights = ((await w.staff('stays/capacity-counts?from=2026-07-31&days=2&ids=1')).body['data'] as { rows: unknown[] }).rows;
      expect(nights).toEqual([
        { pool: '1', date: '2026-07-31', size: 4, outOfService: 0, taken: 1, held: 0, left: 3 },
        { pool: '1', date: '2026-08-01', size: 4, outOfService: 0, taken: 1, held: 0, left: 3 },
      ]);
      // Room 101 closed for the Saturday night: one fewer, and said.
      await w.query(`insert into room_closures (room_id, from_date, to_date) values (1, '2026-08-01', '2026-08-01')`);
      const closed = ((await w.staff('stays/capacity-counts?from=2026-07-31&days=2&ids=1')).body['data'] as { rows: unknown[] }).rows;
      expect(closed).toEqual([
        { pool: '1', date: '2026-07-31', size: 4, outOfService: 0, taken: 1, held: 0, left: 3 },
        { pool: '1', date: '2026-08-01', size: 3, outOfService: 1, taken: 1, held: 0, left: 2 },
      ]);
    });

    it("counts a limit only for a desk that may read the pools' rows, under a column it sees", async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: w.id('ticket_types'), columnName: 'name', value: { masked: true, kind: 'name' } as never });
      const onlyTickets = await w.staffOf(['tickets'], 'tickets/capacity-counts?under=event_id&value=1');
      expect(onlyTickets.status).toBe(403);
      expect((onlyTickets.body['error'] as { code: string }).code).toBe('TABLE_FORBIDDEN');
      expect((await w.staffOf(['tickets'], 'tickets/capacity-counts?ids=1')).status).toBe(403);
      const all = ['tickets', 'ticket_types', 'events'];
      const masked = await w.staffOf(all, 'tickets/capacity-counts?under=name&value=Neon%20Standard');
      expect(masked.status).toBe(403);
      expect((masked.body['error'] as { code: string }).code).toBe('COLUMN_FORBIDDEN');
      const allowed = await w.staffOf(all, 'tickets/capacity-counts?under=event_id&value=1');
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      expect((allowed.body['data'] as { rows: unknown[] }).rows).toHaveLength(3);
      await w.close();
      w = await house(dialect);
      expect((await w.staffOf(['stays'], 'stays/capacity-counts?from=2026-07-31&days=2')).status).toBe(403);
      expect((await w.staffOf(['stays', 'room_types', 'rooms', 'room_closures'], 'stays/capacity-counts?from=2026-07-31&days=2')).status).toBe(200);
    });
  });
}
