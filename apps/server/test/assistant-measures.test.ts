// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A figure over related rows, and a list ordered by it, on every engine.
 *
 * "Customers by number of orders" is one read: a fold over the rows that
 * point at each listed row, computed by the database over all of them, and
 * the order of the list. Here: rooms by their stays.
 *
 * - The order is the same on SQLite, PostgreSQL and MySQL, rows with no
 *   value LAST whichever way it runs (left to each engine, a room with no
 *   stays leads on one and trails on another).
 * - It is resolved as the person: a fold over a table they may not read, or
 *   over a column they are not shown, comes back empty and marked, and the
 *   list cannot be ordered by it.
 * - Paging by offset works; a keyset cursor is refused by name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runList } from '../src/crud/list.js';
import { resolveMeasures } from '../src/crud/measures.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { TurnSetup } from '../src/assistant/turn-setup.js';
import { legs, person, stack, turnAs, type Stack } from './assistant-lodge.helpers.js';

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`a list ordered by a figure over related rows — ${dialect}`, () => {
    let s: Stack;
    let all: { cookie: string; id: string };
    let hk: { cookie: string; id: string };
    let roomsOnly: { cookie: string; id: string };

    const run = (setup: TurnSetup, args: Record<string, unknown>) => setup.execute({ id: 'c1', tool: 'read_rows', args: { connectionId: s.connectionId, table: s.table.rooms, ...args } });
    const rows = (out: { result?: unknown }) => (out.result as { rows: Record<string, unknown>[] }).rows;
    const numbers = (out: { result?: unknown }) => rows(out).map((row) => String(row.number));
    const stays = (id: string, fn = 'count', of?: unknown) => ({ id, table: s.table.stays, fkColumn: 'room_id', fn, ...(of === undefined ? {} : { of }) });
    const money = { terms: [{ sign: 'plus', factors: ['total'] }] };

    beforeAll(async () => {
      s = await stack(dialect);
      for (const number of ['101', '102', '103', '104']) await s.run(`INSERT INTO lodge_rooms (number) VALUES ('${number}')`);
      // 101: one stay of 50. 102: three stays, 600 in all. 103: two stays, 900 in all. 104: none.
      const seed: [number, number][] = [[1, 50], [2, 100], [2, 200], [2, 300], [3, 400], [3, 500]];
      for (const [room, total] of seed) {
        await s.run(`INSERT INTO lodge_stays (room_id, arrive, depart, guest_name, total, status) VALUES (${String(room)}, '2026-11-01', '2026-11-02', 'G', ${String(total)}, 'booked')`);
      }
      all = await person(s, 'all@lodge.dev', [], [`table:${s.connectionId}:${s.table.rooms}:read`, `table:${s.connectionId}:${s.table.stays}:read`]);
      hk = await person(s, 'hk@lodge.dev', ['housekeeping']);
      roomsOnly = await person(s, 'rooms@lodge.dev', [], [`table:${s.connectionId}:${s.table.rooms}:read`]);
    }, 180_000);
    afterAll(async () => s?.close());

    it('orders rooms by how many stays each has, and by what they came to, the room with none last both ways', async () => {
      const setup = await turnAs(s, all.id, 'data');
      const byCount = await run(setup, { measures: [stays('stay_count')], sort: 'stay_count.desc' });
      expect(byCount.error, JSON.stringify(byCount.error)).toBeUndefined();
      expect(numbers(byCount)).toEqual(['102', '103', '101', '104']);
      expect(rows(byCount).map((row) => Number(row.stay_count))).toEqual([3, 2, 1, 0]);
      // A count is never empty: the room with no stays is 0 and leads the other way.
      expect(numbers(await run(setup, { measures: [stays('stay_count')], sort: 'stay_count.asc' }))).toEqual(['104', '101', '103', '102']);

      const byMoney = await run(setup, { measures: [stays('revenue', 'sum', money)], sort: 'revenue.desc' });
      expect(byMoney.error, JSON.stringify(byMoney.error)).toBeUndefined();
      expect(numbers(byMoney)).toEqual(['103', '102', '101', '104']);
      expect(rows(byMoney).slice(0, 3).map((row) => Number(row.revenue))).toEqual([900, 600, 50]);
      // A sum over no rows is no value, and it is LAST whichever way the order runs.
      expect(numbers(await run(setup, { measures: [stays('revenue', 'sum', money)], sort: 'revenue.asc' }))).toEqual(['101', '102', '103', '104']);
      // Two figures at once, ordered by one and then by a column.
      const two = await run(setup, { measures: [stays('stay_count'), stays('top', 'max', money)], sort: 'top.desc,number.asc' });
      expect(numbers(two)).toEqual(['103', '102', '101', '104']);
    });

    it('reads on from an offset in the same order, and says how many rooms there are', async () => {
      const setup = await turnAs(s, all.id, 'data');
      const first = await run(setup, { measures: [stays('stay_count')], sort: 'stay_count.desc', limit: 2 });
      const next = await run(setup, { measures: [stays('stay_count')], sort: 'stay_count.desc', limit: 2, offset: 2 });
      expect(numbers(first)).toEqual(['102', '103']);
      expect(numbers(next)).toEqual(['101', '104']);
      expect(first.result).toMatchObject({ returned: 2, total: 4 });
    });

    it('is resolved as the person: a fold they may not see is empty, and no order may be made of it', async () => {
      // Housekeeping reads stays without `total`: they may count stays, not add them up.
      const asHk = await turnAs(s, hk.id, 'data');
      expect(numbers(await run(asHk, { measures: [stays('stay_count')], sort: 'stay_count.desc' }))).toEqual(['102', '103', '101', '104']);
      const hidden = await run(asHk, { measures: [stays('revenue', 'sum', money)] });
      expect(hidden.error, JSON.stringify(hidden.error)).toBeUndefined();
      // Empty for every room, and nothing of the sums in the reply.
      for (const row of rows(hidden)) expect(row.revenue ?? null).toBeNull();
      expect(JSON.stringify(hidden)).not.toMatch(/900|600/);
      const ordered = await run(asHk, { measures: [stays('revenue', 'sum', money)], sort: 'revenue.desc' });
      expect(ordered.error?.code).toBe('COLUMN_FORBIDDEN');
      expect(ordered.result).toBeUndefined();

      // Someone who reads rooms and not stays at all: the same, for a plain count.
      const asRooms = await turnAs(s, roomsOnly.id, 'data');
      const counted = await run(asRooms, { measures: [stays('stay_count')] });
      for (const row of rows(counted)) expect(row.stay_count ?? null).toBeNull();
      expect((await run(asRooms, { measures: [stays('stay_count')], sort: 'stay_count.desc' })).error?.code).toBe('COLUMN_FORBIDDEN');
    });

    it('refuses a figure that is not one, by name', async () => {
      const setup = await turnAs(s, all.id, 'data');
      // Named like a column of the list.
      expect((await run(setup, { measures: [stays('number')] })).error?.code).toBe('BAD_MEASURE');
      // Twice the same name; too many; not the engine's shape.
      expect((await run(setup, { measures: [stays('a'), stays('a')] })).error?.code).toBe('BAD_MEASURE');
      expect((await run(setup, { measures: [stays('a'), stays('b'), stays('c'), stays('d')] })).error?.code).toBe('BAD_ARGS');
      expect((await run(setup, { measures: [{ as: 'x', fn: 'count', over: s.table.stays }] })).error?.code).toBe('BAD_MEASURE');
      // A table that does not point at rooms, and a column that is not there: the engine's own refusals, as data.
      expect((await run(setup, { measures: [{ id: 'x', table: s.table.rooms, fkColumn: 'number', fn: 'count' }] })).error).toBeDefined();
      expect((await run(setup, { measures: [stays('x', 'sum', { terms: [{ sign: 'plus', factors: ['no_such_column'] }] })] })).error).toBeDefined();
      // A sort by a name that is neither a column nor a figure of this call.
      expect((await run(setup, { sort: 'stay_count.desc' })).error).toBeDefined();
    });

    it('refuses a keyset cursor on such an order, and a negative constant turns the order round', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const table = view.table(s.table.rooms);
      const { db, dialect: engine } = await s.manager.data(s.connectionId);
      const resolve = (factor?: string) =>
        resolveMeasures({ view, table, specs: [{ id: 'revenue', table: s.table.stays, fkColumn: 'room_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['total'] }], ...(factor === undefined ? {} : { factor }) } }], canReadPii: true, canReadTable: () => Promise.resolve(true) });
      const list = async (measures: Awaited<ReturnType<typeof resolve>>, params: Record<string, unknown>) =>
        runList({ db, view, table, measures, params: { order: 'revenue.desc', ...params }, canReadPii: true, dialect: engine });
      await expect(list(await resolve(), { cursor: '' })).rejects.toThrow(/Keyset pagination is unavailable/);
      // The constant is applied after the fetch: the database orders the raw sums, so the key is turned round for it.
      const negated = await list(await resolve('-1'), { count: 'none' });
      expect(negated.data.slice(0, 3).map((row) => String(row.number))).toEqual(['101', '102', '103']);
      expect(String(negated.data.at(-1)?.number)).toBe('104');
    });

    it('refuses to rank more rows than the cap, counted UNDER the filters: narrowing the list is the way round', async () => {
      const view = await loadSnapshotView(s.meta, s.connectionId);
      const table = view.table(s.table.rooms);
      const { db, dialect: engine } = await s.manager.data(s.connectionId);
      const measures = await resolveMeasures({ view, table, specs: [{ id: 'stay_count', table: s.table.stays, fkColumn: 'room_id', fn: 'count' }], canReadPii: true, canReadTable: () => Promise.resolve(true) });
      const ranked = (params: Record<string, unknown>) =>
        runList({ db, view, table, measures, params: { order: 'stay_count.desc', count: 'none', ...params }, canReadPii: true, dialect: engine, measureSortMaxRows: 2 });
      // Four rooms, and at most two may be ranked.
      await expect(ranked({})).rejects.toThrow(/Too many rows to order by a computed value \(4; the most is 2\)/);
      // The same list narrowed to two rooms is ranked: what is counted is what would be ranked.
      const narrowed = await ranked({ where: JSON.stringify({ column: 'number', op: 'in', value: ['101', '104'] }) });
      expect(narrowed.data.map((row) => String(row.number))).toEqual(['101', '104']);
      // A list that is not ordered by a fold is not counted at all.
      const plain = await runList({ db, view, table, measures, params: { order: 'number.asc', count: 'none' }, canReadPii: true, dialect: engine, measureSortMaxRows: 2 });
      expect(plain.data).toHaveLength(4);
    });
  });
}
