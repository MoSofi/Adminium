// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Many writers for the last places of a pool, at once, over real HTTP and the
 * write service: exactly as many win as there are places, whatever the
 * engine and however small the source pool — and while they queue, a guest
 * asking what is left is answered at once.
 *
 * Run with the source pool at one (`poolMax: 1`) beside the default: a guard
 * that checked out a second connection inside its transaction would stall.
 * And across ten servers over one database: each has its own queue in front
 * of the database's locks, so only the database's locks keep them apart.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { filled, LEGS, refusal, types, type Dialect, type World } from './capacity.helpers.js';
import { house, iso, kitchen, at } from './capacity-worlds.js';

function showDdl(dialect: Dialect): string[] {
  const t = types(dialect);
  return [
    `create table ticket_types (id ${t.key}, name ${t.text(40)}, capacity integer)`,
    `create table cart_lines (id ${t.key}, ticket_type_id integer not null, qty integer not null, ${t.fk('ticket_type_id', 'ticket_types')})`,
  ];
}

/** 260 places, 246 taken: 14 left. */
async function lastFourteen(dialect: Dialect, poolMax: number | undefined): Promise<World> {
  return filled(
    dialect,
    {
      zone: 'Europe/London',
      ddl: showDdl,
      overrides: () => [{ op: 'table.capacity', table: 'cart_lines', value: { kind: 'parent', via: 'ticket_type_id', size: { column: 'capacity' }, amount: 'qty' } }],
      endpoints: {
        ticket_types: { source: 'ticket_types', methods: ['GET'], select: ['id', 'name'] },
        cart_lines: { source: 'cart_lines', methods: ['POST'], select: ['id'], writable: ['ticket_type_id', 'qty'] },
        lines_availability: { source: 'cart_lines', methods: ['GET'], kind: 'availability', show_left: { below: 20 } },
      },
      poolMax,
    },
    async (w) => {
      await w.seed('ticket_types', [{ id: 1, name: 'Standard', capacity: 260 }]);
      await w.seed('cart_lines', [{ ticket_type_id: 1, qty: 246 }]);
    },
  );
}

const POOLS: [string, number | undefined][] = [
  ['the default pool', undefined],
  ['a pool of one', 1],
];

for (const [dialect, available] of LEGS) {
  for (const [label, poolMax] of POOLS) {
    describe.skipIf(!available)(`the last places, raced, on ${dialect} with ${label}`, () => {
      let w: World | null = null;
      afterEach(async () => {
        await w?.close();
        w = null;
      });

      it.skipIf(dialect === 'sqlite' || poolMax === undefined)('runs with the source pool it was asked for', async () => {
        w = await lastFourteen(dialect, poolMax);
        const sleep = dialect === 'postgres' ? sql`select pg_sleep(0.2)` : sql`select sleep(0.2)`;
        const started = Date.now();
        await Promise.all([0, 1, 2].map(() => sleep.execute(w!.db)));
        expect(Date.now() - started).toBeGreaterThanOrEqual(550);
      });

      it('sells 20 checkouts of 2 for the last 14 to exactly 7, and answers a guest meanwhile', async () => {
        w = await lastFourteen(dialect, poolMax);
        const writers = Array.from({ length: 20 }, () => w!.post('records/cart_lines', { values: { ticket_type_id: 1, qty: 2 } }));
        const started = Date.now();
        const asked = await w.get('availability/lines_availability');
        const waited = Date.now() - started;
        const answers = await Promise.all(writers);
        const codes = answers.map((a) => (a.status === 201 ? 'sold' : (a.body['error'] as { code: string }).code));
        expect(codes.filter((c) => c === 'sold')).toHaveLength(7);
        expect(new Set(codes.filter((c) => c !== 'sold'))).toEqual(new Set(['PUBLIC_SOLD_OUT']));
        const [total] = await w.query('select sum(qty) as n from cart_lines');
        expect(Number(total!['n'])).toBe(260);
        expect(asked.status).toBe(200);
        expect(waited).toBeLessThan(1000);
      }, 20_000);

      // Two servers over one SQLite file is not a deployment: one server serialises its writers.
      it.skipIf(dialect === 'sqlite')('sells 20 checkouts of 2 for the last 14 to exactly 7 across ten servers', async () => {
        w = await lastFourteen(dialect, poolMax);
        // Ten servers, two guests each: each server's queue lets one of its two in at a time, so ten meet at the database.
        const servers = [await w.target('cart_lines')];
        for (let i = 1; i < 10; i += 1) servers.push(await (await w.twin()).target('cart_lines'));
        const context = { origin: 'public' as const, hops: 0, actor: null, request: null };
        const outcomes = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            refusal(w!.writes.create({ target: servers[i % 10]!, values: { ticket_type_id: 1, qty: 2 }, context, announce: async () => {} })),
          ),
        );
        expect(outcomes.filter((o) => o === 'ok')).toHaveLength(7);
        expect(new Set(outcomes.filter((o) => o !== 'ok').map((o) => (o as { code: string }).code))).toEqual(new Set(['CAPACITY_FULL']));
        const [total] = await w.query('select sum(qty) as n from cart_lines');
        expect(Number(total!['n'])).toBe(260);
      }, 30_000);

      it('fills the last four places of a pickup slot with five orders at once', async () => {
        w = await kitchen(dialect, undefined, poolMax);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(at('2026-07-28 11:40'));
        try {
          const outcomes = await Promise.all(Array.from({ length: 5 }, () => refusal(w!.create('orders', { pickup_at: iso('2026-07-28 12:15') }, 'public'))));
          expect(outcomes.filter((o) => o === 'ok')).toHaveLength(4);
          expect(outcomes.filter((o) => o !== 'ok')).toMatchObject([{ code: 'CAPACITY_FULL' }]);
          // Orders moved to the slot while lines are written against the day's portions: one order of locks, no one waits crosswise.
          const orders = await w.query(`select id from orders order by id`);
          const moves = orders.slice(0, 3).map((o) => refusal(w!.update('orders', o['id'], { pickup_at: iso('2026-07-28 13:00') })));
          const lines = orders.slice(0, 3).map((o) => refusal(w!.create('order_items', { order_id: o['id'], menu_item_id: 2, qty: 1 })));
          const all = await Promise.all([...moves, ...lines]);
          expect(all.filter((o) => o !== 'ok' && ['CAPACITY_BUSY', 'WRITE_CONFLICT'].includes(o.code))).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      }, 20_000);

      it('lets six stays race for the last four Lofts, and one of two desks give a room', async () => {
        w = await house(dialect, undefined, poolMax);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-07-20T09:00:00.000Z'));
        try {
          const stays = await Promise.all(Array.from({ length: 6 }, () => refusal(w!.create('stays', { arrive: '2026-08-10', depart: '2026-08-12', room_type_id: 1 }, 'public'))));
          expect(stays.filter((o) => o === 'ok')).toHaveLength(4);
          const room = (await w.query(`select id from rooms where number = '204'`))[0]!['id'];
          const desks = await Promise.all([
            refusal(w.create('stays', { arrive: '2026-08-20', depart: '2026-08-22', room_type_id: 3, room_id: room })),
            refusal(w.create('stays', { arrive: '2026-08-21', depart: '2026-08-23', room_type_id: 3, room_id: room })),
          ]);
          expect(desks.filter((o) => o === 'ok')).toHaveLength(1);
        } finally {
          vi.useRealTimers();
        }
      }, 20_000);
    });
  }
}
