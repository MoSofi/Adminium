// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A table limit's counts as a card reads them (`kind: 'capacity-counts'`):
 * the desk's counts route, answered through the widget-data API — the same
 * rows, on the same read rules — on every engine, at a fixed time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { adminPasswordHash, ADMIN_EMAIL, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { LEGS, type World } from './capacity.helpers.js';
import { at, kitchen, neon, NEON_NOW } from './capacity-worlds.js';

type Reply = { status: number; body: Record<string, unknown> };

const answer = (res: { statusCode: number; body: string }): Reply => ({ status: res.statusCode, body: (res.body === '' ? {} : JSON.parse(res.body)) as Record<string, unknown> });

/** A card's binding over a table of the world. */
function binding(w: World, table: string, shape: string, capacity: Record<string, unknown> = {}) {
  const id = w.id(table);
  const source = { name: table, ...(id.includes('.') ? { schema: id.split('.')[0] } : {}) };
  return { kind: 'capacity-counts', connectionId: w.connectionId, source, shape, capacity };
}

/** Widget-data reads signed in as the super admin (after `w.staff` made them) or as a desk that reads only some tables. */
function reader(w: World) {
  let members = 0;
  let admin: string | null = null;
  const desks = new Map<string, string>();
  const query = async (cookie: string, descriptor: unknown, params?: Record<string, unknown>) =>
    answer(await w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie }, payload: { descriptor, ...(params === undefined ? {} : { params }) } as never }));
  return {
    asAdmin: async (descriptor: unknown, params?: Record<string, unknown>) => {
      admin ??= (await login(w.app as never, ADMIN_EMAIL, ADMIN_PASSWORD)).cookie ?? '';
      return query(admin, descriptor, params);
    },
    asDesk: async (tables: readonly string[], descriptor: unknown, params?: Record<string, unknown>) => {
      // One sign-in per desk: sign-ins are rate limited.
      const key = tables.join(',');
      let cookie = desks.get(key);
      if (cookie === undefined) {
        members += 1;
        const role = await rolesRepo(w.meta).create({ slug: `card-desk-${String(members)}`, name: `Card desk ${String(members)}` });
        for (const table of tables) {
          await permissionsRepo(w.meta).grant(role.id, 'table', `${w.connectionId}/${w.id(table)}`, { read: true, create: false, update: false, delete: false, export: false, import: false });
        }
        const email = `card${String(members)}@venue.example.com`;
        const user = await usersRepo(w.meta).create({ email, name: `Card ${String(members)}`, passwordHash: await adminPasswordHash(), status: 'active' });
        await rolesRepo(w.meta).assignToUser(user.id, role.id);
        cookie = (await login(w.app as never, email, ADMIN_PASSWORD)).cookie ?? '';
        desks.set(key, cookie);
      }
      return query(cookie, descriptor, params);
    },
  };
}

const errorCode = (reply: Reply) => (reply.body['error'] as { code?: string } | undefined)?.code;
const resultOf = (reply: Reply) => reply.body['result'] as Record<string, unknown>;
const capacityOf = (reply: Reply) => resultOf(reply)['capacity'] as { kind: string; date: string | null; days: number; now: { day: string; minute: number }; closed: boolean; rows: Record<string, unknown>[] };

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`a limit's counts on a card on ${dialect}`, () => {
    let w: World | null = null;
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
    afterEach(async () => {
      vi.useRealTimers();
      await w?.close();
      w = null;
    });

    it("draws the kitchen's slots as the desk's route counts them: the page's day, today, a closed day and the week", async () => {
      vi.setSystemTime(at('2026-07-28 11:40'));
      w = await kitchen(dialect);
      const route = await w.staff('orders/capacity-counts?date=2026-07-28');
      expect(route.status, JSON.stringify(route.body)).toBe(200);
      const routeRows = (route.body['data'] as { rows: Record<string, unknown>[] }).rows;
      const cards = reader(w);

      // The page's day control names the day.
      const list = await cards.asAdmin(binding(w, 'orders', 'record-list'), { day: '2026-07-28' });
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(resultOf(list)['rows']).toEqual(routeRows);
      expect(capacityOf(list)).toMatchObject({ kind: 'slot', date: '2026-07-28', days: 1, closed: false, now: { day: '2026-07-28', minute: 11 * 60 + 40 } });

      // No day control: today on the venue's clock. A bar per slot, as tall as what is taken.
      const bars = await cards.asAdmin(binding(w, 'orders', 'categorical'));
      expect(bars.status, JSON.stringify(bars.body)).toBe(200);
      const items = resultOf(bars)['items'] as { key: string; label: string; value: number }[];
      expect(items.map((item) => item.key)).toEqual(routeRows.map((row) => row['time']));
      expect(items.find((item) => item.key === '12:15')).toEqual({ key: '12:15', label: '12:15', value: 2 });
      expect(resultOf(bars)['total']).toBe(2);
      expect(capacityOf(bars).rows).toEqual(routeRows);
      expect(capacityOf(bars).rows.find((row) => row['time'] === '12:30')).toMatchObject({ paused: true });

      // The binding's own day, where the page has no day control.
      const own = await cards.asAdmin(binding(w, 'orders', 'record-list', { date: '2026-07-29' }));
      expect(resultOf(own)['rows']).toEqual(((await w.staff('orders/capacity-counts?date=2026-07-29')).body['data'] as { rows: unknown[] }).rows);

      // Thursday is closed: said.
      const closed = await cards.asAdmin(binding(w, 'orders', 'categorical'), { day: '2026-07-30' });
      expect(capacityOf(closed).closed).toBe(true);

      // The control's week: Monday on, day by day, as the route's strip.
      const week = await cards.asAdmin(binding(w, 'orders', 'record-list'), { day: 'week' });
      expect(week.status, JSON.stringify(week.body)).toBe(200);
      expect(resultOf(week)['rows']).toEqual(((await w.staff('orders/capacity-counts?from=2026-07-27&days=7')).body['data'] as { rows: unknown[] }).rows);
      expect(capacityOf(week)).toMatchObject({ date: '2026-07-27', days: 7, closed: false });

      // What the route refuses, the card refuses: a limit the table does not keep, a day that is not one.
      expect((await cards.asAdmin(binding(w, 'orders', 'categorical', { rule: 2 }))).status).toBe(422);
      expect((await cards.asAdmin(binding(w, 'orders', 'categorical'), { day: 'someday' })).status).toBe(422);
      // A counts card is not a query: a table query's parts are refused by name.
      expect((await cards.asAdmin({ ...binding(w, 'orders', 'categorical'), groupBy: ['status'] })).status).toBe(422);
      expect((await cards.asAdmin(binding(w, 'orders', 'timeseries'))).status).toBe(422);
      // A table that keeps no limit.
      expect((await cards.asAdmin(binding(w, 'menu_items', 'categorical'))).status).toBe(404);
    });

    it("lists the box office's types with what is left, as the route counts them, each by its name", async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      const route = await w.staff('tickets/capacity-counts?under=event_id&value=1');
      expect(route.status, JSON.stringify(route.body)).toBe(200);
      const routeRows = (route.body['data'] as { rows: Record<string, unknown>[] }).rows;
      const card = await reader(w).asAdmin(binding(w, 'tickets', 'record-list', { under: 'event_id', value: '1' }));
      expect(card.status, JSON.stringify(card.body)).toBe(200);
      expect(resultOf(card)['rows']).toEqual(routeRows.map((row, i) => ({ ...row, label: ['Neon Standard', 'Balcony', 'Guest list'][i] })));
      expect(resultOf(card)['columns']).toEqual([
        { name: 'label', logicalType: 'varchar', nullable: true, isPrimaryKey: false },
        { name: 'left', logicalType: 'integer', nullable: true, isPrimaryKey: false, semantic: 'capacity-left' },
      ]);
      expect(capacityOf(card)).toMatchObject({ kind: 'parent', date: null });
      // By ids, as a categorical: each type valued by what is taken.
      const bars = await reader(w).asAdmin(binding(w, 'tickets', 'categorical', { ids: ['2', '1'] }));
      expect(resultOf(bars)['items']).toEqual([
        { key: '2', label: 'Balcony', value: 0 },
        { key: '1', label: 'Neon Standard', value: 246 },
      ]);
    });

    it("counts only for a reader who may read the pools' rows, under a column they see — refused as the route refuses", async () => {
      vi.setSystemTime(NEON_NOW);
      w = await neon(dialect);
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'column.pii', tableName: w.id('ticket_types'), columnName: 'name', value: { masked: true, kind: 'name' } as never });
      const cards = reader(w);
      const types = binding(w, 'tickets', 'record-list', { under: 'event_id', value: '1' });

      // No read of the ticket types: the route's 403, the card's 403.
      const routeRefused = await w.staffOf(['tickets'], 'tickets/capacity-counts?under=event_id&value=1');
      const cardRefused = await cards.asDesk(['tickets'], types);
      expect([routeRefused.status, errorCode(routeRefused)]).toEqual([403, 'TABLE_FORBIDDEN']);
      expect([cardRefused.status, errorCode(cardRefused)]).toEqual([403, 'TABLE_FORBIDDEN']);
      const withoutRequest = (reply: Reply) => ({ ...(reply.body['error'] as Record<string, unknown>), requestId: undefined });
      expect(withoutRequest(cardRefused)).toEqual(withoutRequest(routeRefused));
      expect((await cards.asDesk(['tickets'], binding(w, 'tickets', 'record-list', { ids: ['1'] }))).status).toBe(403);
      // No read of the tickets themselves: refused before anything is counted.
      const noTable = await cards.asDesk(['ticket_types', 'events'], types);
      expect([noTable.status, errorCode(noTable)]).toEqual([403, 'TABLE_FORBIDDEN']);

      const all = ['tickets', 'ticket_types', 'events'];
      // Under a masked column: refused, as the route refuses it.
      const maskedRoute = await w.staffOf(all, 'tickets/capacity-counts?under=name&value=Neon%20Standard');
      const maskedCard = await cards.asDesk(all, binding(w, 'tickets', 'record-list', { under: 'name', value: 'Neon Standard' }));
      expect([maskedRoute.status, errorCode(maskedRoute)]).toEqual([403, 'COLUMN_FORBIDDEN']);
      expect([maskedCard.status, errorCode(maskedCard)]).toEqual([403, 'COLUMN_FORBIDDEN']);

      // Allowed: the three types, the masked name never read for a label.
      const allowed = await cards.asDesk(all, types);
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
      expect(resultOf(allowed)['rows']).toHaveLength(3);
      expect(JSON.stringify(resultOf(allowed))).not.toContain('Neon Standard');
      // A label column named on the card, masked for this reader: the ids, never a failed card.
      const named = await cards.asDesk(all, binding(w, 'tickets', 'record-list', { under: 'event_id', value: '1', label: 'name' }));
      expect(named.status, JSON.stringify(named.body)).toBe(200);
      expect((resultOf(named)['rows'] as { label: string }[]).map((row) => row.label)).toEqual(['1', '2', '3']);
    });
  });
}
