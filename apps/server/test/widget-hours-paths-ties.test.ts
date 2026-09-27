// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Three things an ordering venue's overview asks of its cards, on every
 * engine, at a fixed time, in a venue that is not on UTC (Los Angeles):
 *
 * - pickups by the hour of the day, a week folded into the venue's hours;
 * - order lines counted through their order (`order_id.status`,
 *   `order_id.pickup_at`), read-checked as a lookup is;
 * - a ranking whose last place is a tie, settled by the label shown.
 *
 * Run it once more with the process in another zone (`TZ=…`): a zone-less
 * column keeps this server's wall clock, and the hours must not move.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overridesRepo, permissionsRepo, rolesRepo, usersRepo, createFirstSuperAdmin } from '@adminium/meta';

import { wallTimeToInstant } from '../src/crud/venue-time.js';
import { adminPasswordHash, ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { filled, LEGS, types, type Dialect, type World } from './capacity.helpers.js';

const ZONE = 'America/Los_Angeles';
const at = (wall: string) => wallTimeToInstant(wall, ZONE)!;
const iso = (wall: string) => at(wall).toISOString();

type Reply = { status: number; body: Record<string, unknown> };

/** A venue of menu items, customers, orders and their lines. */
async function venue(dialect: Dialect, fill: (w: World) => Promise<void>): Promise<World> {
  return filled(
    dialect,
    {
      zone: ZONE,
      ddl: (d) => {
        const t = types(d);
        return [
          `create table menu_items (id ${t.key}, name ${t.text(40)} not null)`,
          `create table customers (id ${t.key}, name ${t.text(40)}, phone ${t.text(20)})`,
          `create table orders (id ${t.key}, customer_id integer null, pickup_at ${t.at} null, status ${t.text(16)} not null default 'placed', ${t.fk('customer_id', 'customers')})`,
          `create table order_items (id ${t.key}, order_id integer null, menu_item_id integer not null, qty integer not null, ${t.fk('order_id', 'orders')}, ${t.fk('menu_item_id', 'menu_items')})`,
        ];
      },
      overrides: () => [],
    },
    fill,
  );
}

/** Widget-data reads as the super admin, or as a desk that reads only some tables (one sign-in each: sign-ins are rate limited). */
function reader(w: World) {
  const cookies = new Map<string, string>();
  const post = async (cookie: string, descriptor: Record<string, unknown>, params?: Record<string, unknown>): Promise<Reply> => {
    const res = await w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie }, payload: { descriptor, ...(params === undefined ? {} : { params }) } as never });
    return { status: res.statusCode, body: (res.body === '' ? {} : JSON.parse(res.body)) as Record<string, unknown> };
  };
  const source = (table: string) => {
    const id = w.id(table);
    return { name: table, ...(id.includes('.') ? { schema: id.split('.')[0] } : {}) };
  };
  const card = (table: string, rest: Record<string, unknown>) => ({ connectionId: w.connectionId, source: source(table), ...rest });
  let members = 0;
  return {
    admin: async (table: string, rest: Record<string, unknown>, params?: Record<string, unknown>) => {
      let cookie = cookies.get('*');
      if (cookie === undefined) {
        await createFirstSuperAdmin(w.meta, { email: ADMIN_EMAIL, name: ADMIN_NAME, passwordHash: await adminPasswordHash() });
        cookie = (await login(w.app as never, ADMIN_EMAIL, ADMIN_PASSWORD)).cookie ?? '';
        cookies.set('*', cookie);
      }
      return post(cookie, card(table, rest), params);
    },
    desk: async (tables: readonly string[], table: string, rest: Record<string, unknown>) => {
      const key = tables.join(',');
      let cookie = cookies.get(key);
      if (cookie === undefined) {
        members += 1;
        const role = await rolesRepo(w.meta).create({ slug: `line-desk-${String(members)}`, name: `Line desk ${String(members)}` });
        for (const name of tables) {
          await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${w.id(name)}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
        }
        const email = `line${String(members)}@venue.example.com`;
        const user = await usersRepo(w.meta).create({ email, name: `Line ${String(members)}`, passwordHash: await adminPasswordHash(), status: 'active' });
        await rolesRepo(w.meta).assignToUser(user.id, role.id);
        cookie = (await login(w.app as never, email, ADMIN_PASSWORD)).cookie ?? '';
        cookies.set(key, cookie);
      }
      return post(cookie, card(table, rest));
    },
  };
}

const ok = (reply: Reply) => {
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body['result'] as Record<string, unknown>;
};
const refused = (reply: Reply) => [reply.status, (reply.body['error'] as { code?: string } | undefined)?.code];
const hours = (result: Record<string, unknown>) => Object.fromEntries((result['points'] as { t: string; v: number }[]).map((point) => [point.t.slice(11, 16), point.v]));

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`an ordering venue's overview cards on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it("folds a week of pickups into the venue's hours of the day", async () => {
      vi.setSystemTime(at('2026-09-21 09:00')); // a Monday morning in Los Angeles
      w = await venue(dialect, async (v) => {
        const orders: Record<string, unknown>[] = [];
        // Last week, Monday to Sunday: one pickup a quarter past each hour from 11:00 to 20:00.
        for (let day = 14; day <= 20; day += 1) {
          for (let hour = 11; hour <= 20; hour += 1) orders.push({ pickup_at: iso(`2026-09-${String(day)} ${String(hour).padStart(2, '0')}:15`) });
        }
        // Outside the week: the Sunday before, late, and this morning.
        orders.push({ pickup_at: iso('2026-09-13 23:30') }, { pickup_at: iso('2026-09-21 08:00') });
        await v.seed('orders', orders);
      });
      const cards = reader(w);
      const week = { shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }], bucket: { column: 'pickup_at', unit: 'hour-of-day' }, window: { column: 'pickup_at', last: 7, unit: 'day', calendar: true, offset: 1 } };
      const folded = ok(await cards.admin('orders', week));
      // Ten bars, not seventy: each hour seven times, on the venue's clock (never UTC's 18:00 to 03:00).
      expect(hours(folded)).toEqual(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`${String(11 + i)}:00`, 7])));
      expect((folded['points'] as { t: string }[])[0]!.t).toBe('1970-01-01T11:00:00.000Z');
      // Without a window every row folds in: the late Sunday at 23:00 and this morning at 08:00 too.
      const all = ok(await cards.admin('orders', { ...week, window: undefined }));
      expect(hours(all)).toMatchObject({ '08:00': 1, '11:00': 7, '23:00': 1 });
      // A window is whole periods: `hour-of-day` is refused there.
      expect((await cards.admin('orders', { ...week, window: { column: 'pickup_at', last: 1, unit: 'hour-of-day' } })).status).toBe(422);
    });

    it('keeps each pickup in its own hour across the weeks the clocks go forward and back', async () => {
      vi.setSystemTime(at('2026-11-05 09:00'));
      // Thursday 29 October to Wednesday 4 November: noon every day; the clocks go back on Sunday the 1st.
      const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
      w = await venue(dialect, async (v) => {
        await v.seed('orders', days.map((day) => ({ pickup_at: iso(`${day} 12:00`) })));
      });
      const cards = reader(w);
      const folded = ok(
        await cards.admin('orders', { shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }], bucket: { column: 'pickup_at', unit: 'hour-of-day' }, window: { column: 'pickup_at', last: 7, unit: 'day', calendar: true, offset: 1 } }),
      );
      expect(hours(folded)).toEqual({ '12:00': 7 });
      // With no window, a week in spring across the clocks going forward (Sunday 8 March) folds in too.
      await w.seed('orders', ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10', '2026-03-11'].map((day) => ({ pickup_at: iso(`${day} 12:00`) })));
      const year = ok(
        await cards.admin('orders', { shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }], bucket: { column: 'pickup_at', unit: 'hour-of-day' } }),
      );
      expect(hours(year)).toEqual({ '12:00': 14 });
      // And by the hour, day by day across the change: every one at noon.
      const byHour = ok(
        await cards.admin('orders', { shape: 'timeseries', aggregations: [{ fn: 'count', alias: 'n' }], bucket: { column: 'pickup_at', unit: 'hour' }, window: { column: 'pickup_at', last: 7, unit: 'day', calendar: true, offset: 1 } }),
      );
      expect((byHour['points'] as { t: string; v: number }[]).filter((point) => point.v > 0).map((point) => point.t)).toEqual(days.map((day) => iso(`${day} 12:00`)));
    });

    it('counts order lines through their order: its status and its pickup day, as the reader may read them', async () => {
      vi.setSystemTime(at('2026-09-21 13:00'));
      w = await venue(dialect, async (v) => {
        await v.seed('customers', [{ id: 1, name: 'Ada', phone: '555-0101' }]);
        await v.seed('menu_items', [{ id: 1, name: 'Apple tart' }, { id: 2, name: 'Bun' }, { id: 3, name: 'Cake' }]);
        await v.seed('orders', [
          { id: 1, customer_id: 1, pickup_at: iso('2026-09-21 12:00'), status: 'placed' },
          { id: 2, customer_id: 1, pickup_at: iso('2026-09-21 12:30'), status: 'cancelled' },
          { id: 3, customer_id: null, pickup_at: iso('2026-09-21 14:00'), status: 'ready' },
          { id: 4, customer_id: null, pickup_at: iso('2026-09-20 12:00'), status: 'placed' },
        ]);
        await v.seed('order_items', [
          { order_id: 1, menu_item_id: 1, qty: 10 },
          { order_id: 2, menu_item_id: 2, qty: 100 },
          { order_id: 3, menu_item_id: 2, qty: 9 },
          { order_id: 4, menu_item_id: 3, qty: 50 },
          // A line with no order matches no filter through one.
          { order_id: null, menu_item_id: 3, qty: 1000 },
        ]);
      });
      const cards = reader(w);
      const sum = { shape: 'single-metric', aggregations: [{ fn: 'sum', column: 'qty', alias: 'qty' }] };
      const notCancelled = { column: 'order_id.status', op: 'neq', value: 'cancelled' };
      const today = { column: 'order_id.pickup_at', last: 1, unit: 'day', calendar: true };
      expect(ok(await cards.admin('order_items', { ...sum, filters: [notCancelled], window: today }))['value']).toBe(19);
      expect(ok(await cards.admin('order_items', { ...sum, window: today }))['value']).toBe(119);
      expect(ok(await cards.admin('order_items', { ...sum, filters: [notCancelled] }))['value']).toBe(69);
      // The day control's yesterday, through the order.
      expect(ok(await cards.admin('order_items', { ...sum, window: { ...today, param: 'day' } }, { day: 'yesterday' }))['value']).toBe(50);
      // A path filter beside one of the line's own.
      expect(ok(await cards.admin('order_items', { ...sum, filters: [notCancelled, { column: 'menu_item_id', op: 'eq', value: 2 }] }))['value']).toBe(9);
      // In a ranking, labelled through the menu.
      const top = ok(await cards.admin('order_items', { shape: 'categorical', aggregations: [{ fn: 'sum', column: 'qty', alias: 'qty' }], groupBy: ['menu_item_id'], groupLabel: 'menu_item_id.name', filters: [notCancelled], window: today }));
      expect(top['items']).toEqual([
        { key: '1', label: 'Apple tart', value: 10 },
        { key: '2', label: 'Bun', value: 9 },
      ]);

      // One link only; and a column that points nowhere reaches nothing.
      expect((await cards.admin('order_items', { ...sum, filters: [{ column: 'order_id.customer_id.name', op: 'eq', value: 'Ada' }] })).status).toBe(422);
      expect((await cards.admin('order_items', { ...sum, filters: [{ column: 'qty.name', op: 'eq', value: 'x' }] })).status).toBe(422);
      expect((await cards.admin('order_items', { ...sum, filters: [{ column: 'order_id.nothing', op: 'eq', value: 'x' }] })).status).toBe(422);

      // A reader who may not read the orders: refused, never counted without the filter.
      expect(refused(await cards.desk(['order_items', 'menu_items'], 'order_items', { ...sum, filters: [notCancelled] }))).toEqual([403, 'TABLE_FORBIDDEN']);
      expect(refused(await cards.desk(['order_items', 'menu_items'], 'order_items', { ...sum, window: today }))).toEqual([403, 'TABLE_FORBIDDEN']);
      // With the orders: counted.
      expect(ok(await cards.desk(['order_items', 'orders'], 'order_items', { ...sum, filters: [notCancelled], window: today }))['value']).toBe(19);
      // A masked column of the order reads only for a reader who sees personal data.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: w.id('orders'), columnName: 'status', value: { masked: true, kind: 'other' } as never });
      expect(refused(await cards.desk(['order_items', 'orders'], 'order_items', { ...sum, filters: [notCancelled] }))).toEqual([403, 'COLUMN_FORBIDDEN']);
      expect(ok(await cards.admin('order_items', { ...sum, filters: [notCancelled], window: today }))['value']).toBe(19);
      // A masked key on the line itself, likewise.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: w.id('order_items'), columnName: 'order_id', value: { masked: true, kind: 'other' } as never });
      expect(refused(await cards.desk(['order_items', 'orders'], 'order_items', { ...sum, window: today }))).toEqual([403, 'COLUMN_FORBIDDEN']);
    });

    it('settles a tie for the last place a ranking keeps by the label shown, then the key', async () => {
      vi.setSystemTime(at('2026-09-21 13:00'));
      w = await venue(dialect, async (v) => {
        // Fig's key is before Elderflower's; Elderflower's name is before Fig's.
        await v.seed('menu_items', [
          { id: 1, name: 'Apple tart' },
          { id: 2, name: 'Bun' },
          { id: 3, name: 'Cake' },
          { id: 4, name: 'Doughnut' },
          { id: 5, name: 'Fig roll' },
          { id: 6, name: 'Elderflower' },
        ]);
        await v.seed('orders', [
          { id: 1, pickup_at: iso('2026-09-21 12:00'), status: 'placed' },
          { id: 2, pickup_at: iso('2026-09-21 12:00'), status: 'ready' },
        ]);
        await v.seed('order_items', [
          { order_id: 1, menu_item_id: 1, qty: 10 },
          { order_id: 1, menu_item_id: 2, qty: 9 },
          { order_id: 1, menu_item_id: 3, qty: 8 },
          { order_id: 1, menu_item_id: 4, qty: 7 },
          { order_id: 1, menu_item_id: 5, qty: 5 },
          { order_id: 2, menu_item_id: 6, qty: 5 },
        ]);
      });
      const cards = reader(w);
      const top5 = { shape: 'categorical', aggregations: [{ fn: 'sum', column: 'qty', alias: 'qty' }], groupBy: ['menu_item_id'], groupLabel: 'menu_item_id.name', limit: 5 };
      for (let run = 0; run < 3; run += 1) {
        const items = ok(await cards.admin('order_items', { ...top5, filters: [{ column: 'qty', op: 'gt', value: run - 10 }] }))['items'] as { label: string }[];
        expect(items.map((item) => item.label)).toEqual(['Apple tart', 'Bun', 'Cake', 'Doughnut', 'Elderflower']);
      }
      // No label asked: the key is the label, and the smaller key keeps the place.
      const byKey = ok(await cards.admin('order_items', { ...top5, groupLabel: undefined }))['items'] as { key: string }[];
      expect(byKey.map((item) => item.key)).toEqual(['1', '2', '3', '4', '5']);
      // A choice column ranks by its words: "Awaiting" before "Placed", though `placed` < `ready`.
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.enumLabels', tableName: w.id('orders'), columnName: 'status', value: { labels: { placed: 'Placed', ready: 'Awaiting pickup' } } as never });
      const first = ok(await cards.admin('orders', { shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['status'], limit: 1 }))['items'];
      expect(first).toEqual([{ key: 'ready', label: 'Awaiting pickup', value: 1 }]);
      // A group whose row has no label comes after a labelled one on every engine, though its key is smaller.
      await w.seed('customers', [{ id: 1, name: null }, { id: 2, name: 'Zed' }]);
      await w.query(`update ${w.id('orders')} set customer_id = id`);
      const byCustomer = { shape: 'categorical', aggregations: [{ fn: 'count', alias: 'n' }], groupBy: ['customer_id'], groupLabel: 'customer_id.name', limit: 1 };
      expect((ok(await cards.admin('orders', byCustomer))['items'] as { key: string }[]).map((item) => item.key)).toEqual(['2']);
    });
  });
}
