// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A figure over a date or a time, on a real database of each engine.
 *
 * A figure is a number: every card reads `value` as one. The earliest or the
 * latest of a date column is a date, and used to be answered as `0`, a
 * figure that looked like one and meant nothing. It is refused now (`422`),
 * with the column and what to ask instead: the row itself, a list in the
 * column's order with a limit of one, which is read as its reader reaches
 * the rows. Counting the dates is still a figure.
 *
 * Dana reaches deals 1, 2, 5 and 9 (her own two, and Lena's two that she
 * covers); each deal closes on its own day of November 2026.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
type Reply = { statusCode: number; body: string };
type Refusal = { error: { code: string; message: string; details?: Record<string, unknown> } };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a figure over a date [${dialect}]`, () => {
    let w: World;
    const cookies = new Map<PersonName | 'owner', string>();
    const as = async (who: PersonName | 'owner'): Promise<string> => {
      if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
      return cookies.get(who)!;
    };
    const json = <T>(res: Reply): T => JSON.parse(res.body) as T;
    const source = () => ({ name: 'deals', ...(dialect === 'postgres' ? { schema: 'public' } : {}) });
    const card = async (who: PersonName | 'owner', descriptor: Record<string, unknown>): Promise<Reply> =>
      w.app.inject({ method: 'POST', url: '/api/v1/widget-data/query', headers: { cookie: await as(who) }, payload: { descriptor: { connectionId: w.connectionId, source: source(), ...descriptor } } }) as unknown as Reply;
    const day = (value: unknown): string => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`ALTER TABLE deals ADD COLUMN touched_at ${dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TIMESTAMP'}`);
      for (let id = 1; id <= 9; id += 1) await w.run(`UPDATE deals SET touched_at = '2026-07-0${String(id)} 12:00:00' WHERE id = ${String(id)}`);
      const { runIntrospection } = await import('../src/connections/introspect.js');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } } });
      await w.give('dana', 'rep');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    for (const fn of ['min', 'max', 'sum', 'avg'] as const) {
      for (const column of ['close_on', 'touched_at'] as const) {
        it(`refuses the ${fn} of ${column} with the column and what to ask instead, never a 0`, async () => {
          for (const who of ['owner', 'dana'] as const) {
            const res = await card(who, { shape: 'single-metric', aggregations: [{ fn, column, alias: 'when' }] });
            expect(res.statusCode, res.body).toBe(422);
            const { error } = json<Refusal>(res);
            expect(error.code).toBe('VALIDATION_FAILED');
            expect(error.message).toContain(column);
            expect(error.details).toMatchObject({ aggregation: 'when', column, reason: 'not-a-number' });
          }
        });
      }
    }

    it('refuses it in a chart by group and by month too', async () => {
      const grouped = await card('owner', { shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'min', column: 'close_on', alias: 'first' }] });
      expect(grouped.statusCode, grouped.body).toBe(422);
      const second = await card('owner', { shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'count', alias: 'n' }, { fn: 'max', column: 'touched_at', alias: 'last' }] });
      expect(second.statusCode, second.body).toBe(422);
      expect(json<Refusal>(second).error.details).toMatchObject({ aggregation: 'last', column: 'touched_at' });
    });

    it('still counts dates, and adds up and compares numbers', async () => {
      const value = async (who: PersonName | 'owner', aggregation: Record<string, unknown>): Promise<number> => {
        const res = await card(who, { shape: 'single-metric', aggregations: [aggregation] });
        expect(res.statusCode, res.body).toBe(200);
        return json<{ result: { value: number } }>(res).result.value;
      };
      expect(await value('owner', { fn: 'count', column: 'close_on', alias: 'n' })).toBe(9);
      expect(await value('owner', { fn: 'count_distinct', column: 'touched_at', alias: 'n' })).toBe(9);
      expect(await value('owner', { fn: 'min', column: 'amount', alias: 'least' })).toBe(5000);
      expect(await value('dana', { fn: 'max', column: 'amount', alias: 'most' })).toBe(40000);
      expect(await value('dana', { fn: 'count', column: 'close_on', alias: 'n' })).toBe(4);
    });

    it('answers the earliest date as a row, of the rows its reader reaches', async () => {
      const first = async (who: PersonName | 'owner', dir: 'asc' | 'desc'): Promise<string> => {
        const res = await card(who, { shape: 'record-list', select: ['id', 'close_on'], orderBy: [{ column: 'close_on', dir }], limit: 1 });
        expect(res.statusCode, res.body).toBe(200);
        const rows = json<{ result: { rows: Record<string, unknown>[] } }>(res).result.rows;
        expect(rows).toHaveLength(1);
        return day(rows[0]!['close_on']);
      };
      // Omar's deal 3 closes before any of hers and nobody's deal 7 after: her earliest and latest are her own.
      await w.run(`UPDATE deals SET close_on = '2026-10-01' WHERE id = 3`);
      await w.run(`UPDATE deals SET close_on = '2026-12-01' WHERE id = 7`);
      expect(await first('owner', 'asc')).toBe('2026-10-01');
      expect(await first('owner', 'desc')).toBe('2026-12-01');
      expect(await first('dana', 'asc')).toBe('2026-11-01');
      expect(await first('dana', 'desc')).toBe('2026-11-09');
    });
  });
}
