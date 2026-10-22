// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The middle value, and the earliest and the latest of a day, on a real
 * database of each engine.
 *
 * `median` is a figure beside any other: Postgres reads it with its
 * ordered-set aggregates, SQLite and MySQL with window functions over the
 * same rows the query reads (never a scan in this process, which could not
 * stand beside another figure). Of an even count of numbers it is the mean of
 * the two middle ones; of a day or a time, the earlier of the two middle ones,
 * so it is always one of the column's own days. Empty values are left out, as
 * every figure leaves them out.
 *
 * The world's deals (id: state, amount, close_on), with a `score` and a
 * `met_at` added here:
 *
 *   1 open 12,000  Nov 1   10     5 open 20,000  Nov 5   —      9 won 40,000  Nov 9  2
 *   2 won  30,000  Nov 2   —      6 won  15,000  Nov 6   1
 *   3 open  8,000  Nov 3   4      7 open  9,000  Nov 7   3
 *   4 lost  5,000  Nov 4   7      8 open  7,000  —       —
 *
 * Dana reaches deals 1, 2, 5 and 9 (her own two, and Lena's two she covers).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
type Reply = { statusCode: number; body: string };
type Refusal = { error: { code: string; message: string; details?: Record<string, unknown> } };
type Item = { key: string; value: number; values?: Record<string, number | string | null> };

const SCORES: Record<number, number | null> = { 1: 10, 2: null, 3: 4, 4: 7, 5: null, 6: 1, 7: 3, 8: null, 9: 2 };

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`the middle value, and the earliest and latest of a day [${dialect}]`, () => {
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
    const ok = async <T>(who: PersonName | 'owner', descriptor: Record<string, unknown>): Promise<T> => {
      const res = await card(who, descriptor);
      expect(res.statusCode, res.body).toBe(200);
      return json<{ result: T }>(res).result;
    };
    /** A single figure: its value, and how a day is written where it is one. */
    const metric = async (who: PersonName | 'owner', aggregation: Record<string, unknown>, filters?: unknown[]): Promise<{ value: number | string | null; date?: string }> => {
      const { shape, ...figure } = await ok<{ shape: string; value: number | string | null; date?: string }>(who, { shape: 'single-metric', aggregations: [aggregation], ...(filters === undefined ? {} : { filters }) });
      expect(shape).toBe('single-metric');
      return figure;
    };
    /** An instant as the list reads it, for comparing with a figure's: the same moment, whatever the spelling. */
    const listed = async (id: number): Promise<number> => {
      const result = await ok<{ rows: Record<string, unknown>[] }>('owner', { shape: 'record-list', select: ['id', 'met_at'], filters: [{ column: 'id', op: 'eq', value: id }] });
      const value = result.rows[0]!['met_at'];
      return new Date(value as string).getTime();
    };

    beforeAll(async () => {
      w = await world(dialect);
      await w.run(`ALTER TABLE deals ADD COLUMN score INTEGER`);
      await w.run(`ALTER TABLE deals ADD COLUMN met_at ${dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TIMESTAMP'}`);
      for (const [id, score] of Object.entries(SCORES)) {
        await w.run(`UPDATE deals SET score = ${score === null ? 'NULL' : String(score)}, met_at = '2026-07-0${id} 12:00:00' WHERE id = ${id}`);
      }
      await w.run(`UPDATE deals SET close_on = NULL WHERE id = 8`);
      const { runIntrospection } = await import('../src/connections/introspect.js');
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } } });
      await w.give('dana', 'rep');
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('answers the middle of an odd count, and the mean of the two middle ones of an even count', async () => {
      // Nine amounts: the fifth of them.
      expect((await metric('owner', { fn: 'median', column: 'amount', alias: 'mid' })).value).toBe(12000);
      // Six scores (three are empty, and left out): 1 2 3 | 4 7 10.
      expect((await metric('owner', { fn: 'median', column: 'score', alias: 'mid' })).value).toBe(3.5);
      // Five open amounts, and the four of them that are not deal 1.
      expect((await metric('owner', { fn: 'median', column: 'amount', alias: 'mid' }, [{ column: 'state', op: 'eq', value: 'open' }])).value).toBe(9000);
      expect((await metric('owner', { fn: 'median', column: 'amount', alias: 'mid' }, [{ column: 'state', op: 'eq', value: 'open' }, { column: 'id', op: 'neq', value: 1 }])).value).toBe(8500);
      // One value is its own middle; no value has none, which a figure says as 0, as an average of nothing does.
      expect((await metric('owner', { fn: 'median', column: 'score', alias: 'mid' }, [{ column: 'id', op: 'eq', value: 4 }])).value).toBe(7);
      expect((await metric('owner', { fn: 'median', column: 'score', alias: 'mid' }, [{ column: 'id', op: 'eq', value: 8 }])).value).toBe(0);
    });

    it('answers the earliest, the latest and the middle day as days: the earlier of the two middle ones', async () => {
      // Eight days (deal 8 has none): Nov 1 2 3 4 | 5 6 7 9.
      expect(await metric('owner', { fn: 'min', column: 'close_on', alias: 'first' })).toEqual({ value: '2026-11-01', date: 'date' });
      expect(await metric('owner', { fn: 'max', column: 'close_on', alias: 'last' })).toEqual({ value: '2026-11-09', date: 'date' });
      expect(await metric('owner', { fn: 'median', column: 'close_on', alias: 'mid' })).toEqual({ value: '2026-11-04', date: 'date' });
      // An odd count's middle day: the three won deals.
      expect(await metric('owner', { fn: 'median', column: 'close_on', alias: 'mid' }, [{ column: 'state', op: 'eq', value: 'won' }])).toEqual({ value: '2026-11-06', date: 'date' });
      // No day at all is no day: never a 0.
      expect(await metric('owner', { fn: 'min', column: 'close_on', alias: 'first' }, [{ column: 'id', op: 'eq', value: 8 }])).toEqual({ value: null, date: 'date' });
      expect(await metric('owner', { fn: 'median', column: 'close_on', alias: 'mid' }, [{ column: 'id', op: 'eq', value: 8 }])).toEqual({ value: null, date: 'date' });
    });

    it('answers the earliest, the latest and the middle moment as instants', async () => {
      const at = async (fn: string, filters?: unknown[]): Promise<number> => {
        const answer = await metric('owner', { fn, column: 'met_at', alias: 'when' }, filters);
        expect(answer.date).toBe('instant');
        expect(typeof answer.value).toBe('string');
        expect(answer.value as string).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        return new Date(answer.value as string).getTime();
      };
      expect(await at('min')).toBe(await listed(1));
      expect(await at('max')).toBe(await listed(9));
      expect(await at('median')).toBe(await listed(5));
      // Four moments (deals 1 to 4): the earlier of the two middle ones.
      expect(await at('median', [{ column: 'id', op: 'lte', value: 4 }])).toBe(await listed(2));
    });

    it('stands beside other figures in a ranking, each group its own middle', async () => {
      const result = await ok<{ items: Item[]; total: number; dates?: Record<string, string> }>('owner', {
        shape: 'categorical',
        groupBy: ['state'],
        aggregations: [
          { fn: 'count', alias: 'n' },
          { fn: 'sum', column: 'amount', alias: 'worth' },
          { fn: 'median', column: 'amount', alias: 'typical' },
          { fn: 'median', column: 'score', alias: 'score' },
          { fn: 'median', column: 'close_on', alias: 'middle_day' },
          { fn: 'min', column: 'close_on', alias: 'first_day' },
          { fn: 'max', column: 'close_on', alias: 'last_day' },
        ],
      });
      const by = Object.fromEntries(result.items.map((item) => [item.key, item.values]));
      // Open: amounts 7 8 [9] 12 20 thousand; scores 3 [4] 10; days Nov 1 [3] 5 7 (deal 8 has none).
      expect(by['open']).toEqual({ n: 5, worth: 56000, typical: 9000, score: 4, middle_day: '2026-11-03', first_day: '2026-11-01', last_day: '2026-11-07' });
      // Won: amounts 15 [30] 40 thousand; scores 1 2, an even two; days Nov 2 [6] 9.
      expect(by['won']).toEqual({ n: 3, worth: 85000, typical: 30000, score: 1.5, middle_day: '2026-11-06', first_day: '2026-11-02', last_day: '2026-11-09' });
      expect(by['lost']).toEqual({ n: 1, worth: 5000, typical: 5000, score: 7, middle_day: '2026-11-04', first_day: '2026-11-04', last_day: '2026-11-04' });
      expect(result.total).toBe(9);
      expect(result.dates).toEqual({ middle_day: 'date', first_day: 'date', last_day: 'date' });
      // A ranking put in order by its middle: won, open, lost.
      const ordered = await ok<{ items: Item[] }>('owner', {
        shape: 'categorical',
        groupBy: ['state'],
        aggregations: [{ fn: 'median', column: 'amount', alias: 'typical' }, { fn: 'count', alias: 'n' }],
        orderBy: [{ column: 'typical', dir: 'desc' }],
      });
      expect(ordered.items.map((item) => [item.key, item.value])).toEqual([['won', 30000], ['open', 9000], ['lost', 5000]]);
    });

    it('takes the middle of each time bucket', async () => {
      const result = await ok<{ points: { t: string; v: number }[] }>('owner', { shape: 'timeseries', bucket: { column: 'close_on', unit: 'week' }, aggregations: [{ fn: 'median', column: 'amount', alias: 'typical' }, { fn: 'count', alias: 'n' }] });
      const week = (point: { t: string }) => point.t.slice(0, 10);
      const dated = result.points.filter((point) => /^\d{4}-/.test(point.t));
      // The weeks from Monday: Oct 26 (deal 1), Nov 2 (deals 2 to 7: 5 8 9 | 15 20 30 thousand), Nov 9 (deal 9).
      expect(dated.map((point) => [week(point), point.v])).toEqual([['2026-10-26', 12000], ['2026-11-02', 12000], ['2026-11-09', 40000]]);
    });

    it('is the middle of the rows its reader reaches, and no other', async () => {
      // Dana reaches deals 1, 2, 5 and 9: amounts 12 20 | 30 40 thousand, and scores 2 and 10.
      expect((await metric('dana', { fn: 'median', column: 'amount', alias: 'mid' })).value).toBe(25000);
      expect((await metric('dana', { fn: 'median', column: 'score', alias: 'mid' })).value).toBe(6);
      expect(await metric('dana', { fn: 'median', column: 'close_on', alias: 'mid' })).toEqual({ value: '2026-11-02', date: 'date' });
      expect(await metric('dana', { fn: 'max', column: 'close_on', alias: 'last' })).toEqual({ value: '2026-11-09', date: 'date' });
    });

    it('still refuses a sum or an average of days, a day where a chart draws numbers, and a ranking by a day', async () => {
      for (const fn of ['sum', 'avg']) {
        const res = await card('owner', { shape: 'single-metric', aggregations: [{ fn, column: 'close_on', alias: 'when' }] });
        expect(res.statusCode, res.body).toBe(422);
        expect(json<Refusal>(res).error.details).toMatchObject({ aggregation: 'when', column: 'close_on', reason: 'not-a-number' });
      }
      const charted = await card('owner', { shape: 'timeseries', bucket: { column: 'met_at', unit: 'month' }, aggregations: [{ fn: 'median', column: 'close_on', alias: 'mid' }] });
      expect(charted.statusCode, charted.body).toBe(422);
      expect(json<Refusal>(charted).error.details).toMatchObject({ aggregation: 'mid', reason: 'date-figure-shape' });
      const ranked = await card('owner', { shape: 'categorical', groupBy: ['state'], aggregations: [{ fn: 'min', column: 'close_on', alias: 'first' }] });
      expect(ranked.statusCode, ranked.body).toBe(422);
      expect(json<Refusal>(ranked).error.details).toMatchObject({ aggregation: 'first', reason: 'date-figure-first' });
    });

    it('answers a day beside its prior window, with no percentage between two days', async () => {
      const result = await ok<Record<string, unknown>>('owner', { shape: 'metric+delta', aggregations: [{ fn: 'max', column: 'close_on', alias: 'last' }] });
      expect(result).toEqual({ shape: 'metric+delta', value: '2026-11-09', date: 'date' });
    });
  });
}
