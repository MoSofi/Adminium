// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A chart's periods name the same moment on every engine, wherever the server
 * and the database keep their clocks.
 *
 * A bucket of a day or longer is said as the first day of its period at
 * midnight UTC: a day of the calendar, which a chart reads in UTC fields. A
 * `date` column has no clock at all, so July is `2026-07-01T00:00:00.000Z`
 * whatever zone anything runs in. A column that keeps instants is cut on the
 * connection's own clock (its venue's month, here Tokyo's), and on the UTC
 * calendar where it names none; never on the clock the server or the
 * database happens to run on.
 *
 * Postgres used to cut on its session's clock (the host's zone, where nobody
 * set another), so on a server in Berlin July was answered as 30 June,
 * 22:00Z, and a screen that read the month off the bucket showed July's
 * figure under June. Each engine is run here with the server process, and
 * the Postgres database, in Berlin and in Auckland.
 *
 * Each of the nine deals closes on its own day; a held reader's buckets are
 * of her own rows.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../src/connections/manager.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type PersonName, type World } from './row-limit-world.js';

const OWN = { reach: 'own' } as const;
type Reply = { statusCode: number; body: string };
type Points = { t: string; v: number }[];

/** When each deal closes, and the instant it was last touched (deals 6 to 9 never were). */
const CLOSES: Record<number, string> = { 1: '2026-07-01', 2: '2026-07-31', 3: '2026-12-01', 4: '2026-11-04', 5: '2026-11-05', 6: '2026-11-06', 7: '2026-11-07', 8: '2026-11-08', 9: '2026-01-01' };
const TOUCHED: Record<number, string> = {
  // Half past midnight on 1 July in Berlin: still June in UTC.
  1: '2026-06-30 22:30:00',
  2: '2026-07-01 00:30:00',
  // The last half hour of July in UTC: August already in Berlin and in Auckland.
  3: '2026-07-31 23:30:00',
  // Either side of midnight on 1 July in Auckland: June in UTC.
  4: '2026-06-30 11:30:00',
  5: '2026-06-30 12:30:00',
};

for (const zone of ['Europe/Berlin', 'Pacific/Auckland'] as const) {
  for (const [dialect, available] of ENGINES) {
    describe.skipIf(!available)(`a chart's periods with the server in ${zone} [${dialect}]`, () => {
      let w: World;
      const before = process.env.TZ;
      const cookies = new Map<PersonName | 'owner', string>();
      const as = async (who: PersonName | 'owner'): Promise<string> => {
        if (!cookies.has(who)) cookies.set(who, who === 'owner' ? w.owner.cookie : (await w.signIn(who)).cookie);
        return cookies.get(who)!;
      };
      /** The connection's own zone: the venue's, or UTC. Asked as a param too, so no answer of the other zone is served again. */
      let venue = 'UTC';
      const at = async (timezone: string): Promise<void> => {
        venue = timezone;
        await w.meta.db.updateTable('adminium_connections').set({ timezone }).where('id', '=', w.connectionId).execute();
      };
      const points = async (who: PersonName | 'owner', column: string, unit: string): Promise<Points> => {
        const res = (await w.app.inject({
          method: 'POST',
          url: '/api/v1/widget-data/query',
          headers: { cookie: await as(who) },
          payload: {
            descriptor: {
              connectionId: w.connectionId,
              source: { name: 'deals', ...(dialect === 'postgres' ? { schema: 'public' } : {}) },
              shape: 'timeseries',
              bucket: { column, unit },
              filters: [{ column, op: 'not_null' }],
              aggregations: [{ fn: 'count', alias: 'n' }],
            },
            params: { venue },
          },
        })) as unknown as Reply;
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { result: { points: Points } }).result.points;
      };

      beforeAll(async () => {
        process.env.TZ = zone;
        // The process really is there: its dates, and what the compiler reads as the server's zone.
        expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
        expect(new Date('2026-07-01T00:00:00Z').getHours()).toBe(zone === 'Europe/Berlin' ? 2 : 12);
        w = await world(dialect);
        await w.run(`ALTER TABLE deals ADD COLUMN touched_at ${dialect === 'postgres' ? 'TIMESTAMPTZ' : 'TIMESTAMP'}`);
        if (dialect === 'postgres') {
          // The database's own clock, as a host in this zone gives it: taken by every connection opened from here on.
          const name = String((await w.rows('SELECT current_database() AS name'))[0]!['name']);
          await w.run(`ALTER DATABASE "${name}" SET timezone TO '${zone}'`);
          await w.manager.dispose(w.connectionId);
        }
        const db = (await w.manager.data(w.connectionId)).db as Kysely<SourceDatabase>;
        if (dialect === 'postgres') expect((await sql<{ TimeZone: string }>`show timezone`.execute(db)).rows[0]!.TimeZone).toBe(zone);
        for (const [id, day] of Object.entries(CLOSES)) await sql.raw(`UPDATE deals SET close_on = '${day}' WHERE id = ${id}`).execute(db);
        // An instant as each engine keeps one: with its zone on Postgres, on a UTC session on MySQL, as ISO text on SQLite.
        const instant = (text: string): string => (dialect === 'postgres' ? `${text}+00` : dialect === 'mysql' ? text : `${text.replace(' ', 'T')}.000Z`);
        for (const [id, at] of Object.entries(TOUCHED)) await sql.raw(`UPDATE deals SET touched_at = '${instant(at)}' WHERE id = ${id}`).execute(db);
        await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
        await w.role('rep', { deals: { actions: ['read'], rows: { read: OWN } } });
        await w.give('dana', 'rep');
      }, 120_000);
      afterAll(async () => {
        await w?.close();
        if (before === undefined) delete process.env.TZ;
        else process.env.TZ = before;
      });

      it('names a month of a date column by its first day at midnight UTC, whatever zone the connection names', async () => {
        for (const timezone of ['UTC', 'Asia/Tokyo', zone]) {
          await at(timezone);
          expect(await points('owner', 'close_on', 'month'), timezone).toEqual([
            { t: '2026-01-01T00:00:00.000Z', v: 1 },
            { t: '2026-07-01T00:00:00.000Z', v: 2 },
            { t: '2026-11-01T00:00:00.000Z', v: 5 },
            { t: '2026-12-01T00:00:00.000Z', v: 1 },
          ]);
        }
      });

      it('names a day, a week, a quarter and a year of a date column the same way', async () => {
        await at('Asia/Tokyo');
        expect((await points('owner', 'close_on', 'day')).map((point) => point.t).slice(0, 3)).toEqual(['2026-01-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', '2026-07-31T00:00:00.000Z']);
        // 1 July 2026 is a Wednesday, and 1 January a Thursday: their weeks start on the Monday before.
        expect((await points('owner', 'close_on', 'week')).map((point) => point.t).slice(0, 3)).toEqual(['2025-12-29T00:00:00.000Z', '2026-06-29T00:00:00.000Z', '2026-07-27T00:00:00.000Z']);
        expect(await points('owner', 'close_on', 'quarter')).toEqual([
          { t: '2026-01-01T00:00:00.000Z', v: 1 },
          { t: '2026-07-01T00:00:00.000Z', v: 2 },
          { t: '2026-10-01T00:00:00.000Z', v: 6 },
        ]);
        expect(await points('owner', 'close_on', 'year')).toEqual([{ t: '2026-01-01T00:00:00.000Z', v: 9 }]);
      });

      it('cuts a column of instants on the venue’s calendar, and says a week or longer by its first day', async () => {
        await at('Asia/Tokyo');
        // In Tokyo deals 4 and 5 were touched in June, 1 and 2 on 1 July, 3 on 1 August.
        expect(await points('owner', 'touched_at', 'month')).toEqual([
          { t: '2026-06-01T00:00:00.000Z', v: 2 },
          { t: '2026-07-01T00:00:00.000Z', v: 2 },
          { t: '2026-08-01T00:00:00.000Z', v: 1 },
        ]);
        // 30 June 2026 is a Tuesday and 1 August a Saturday.
        expect(await points('owner', 'touched_at', 'week')).toEqual([
          { t: '2026-06-29T00:00:00.000Z', v: 4 },
          { t: '2026-07-27T00:00:00.000Z', v: 1 },
        ]);
        expect(await points('owner', 'touched_at', 'quarter')).toEqual([
          { t: '2026-04-01T00:00:00.000Z', v: 2 },
          { t: '2026-07-01T00:00:00.000Z', v: 3 },
        ]);
        expect(await points('owner', 'touched_at', 'year')).toEqual([{ t: '2026-01-01T00:00:00.000Z', v: 5 }]);
        // Its days are the venue's too, said as before: the instant each begins there.
        expect(await points('owner', 'touched_at', 'day')).toEqual([
          { t: '2026-06-29T15:00:00.000Z', v: 2 },
          { t: '2026-06-30T15:00:00.000Z', v: 2 },
          { t: '2026-07-31T15:00:00.000Z', v: 1 },
        ]);
      });

      it('cuts a column of instants on the UTC calendar where the connection names no zone, month and day', async () => {
        await at('UTC');
        expect(await points('owner', 'touched_at', 'month')).toEqual([
          { t: '2026-06-01T00:00:00.000Z', v: 3 },
          { t: '2026-07-01T00:00:00.000Z', v: 2 },
        ]);
        expect(await points('owner', 'touched_at', 'day')).toEqual([
          { t: '2026-06-30T00:00:00.000Z', v: 3 },
          { t: '2026-07-01T00:00:00.000Z', v: 1 },
          { t: '2026-07-31T00:00:00.000Z', v: 1 },
        ]);
      });

      it('names an hour of an instant as that hour', async () => {
        await at('UTC');
        expect(await points('owner', 'touched_at', 'hour')).toEqual([
          { t: '2026-06-30T11:00:00.000Z', v: 1 },
          { t: '2026-06-30T12:00:00.000Z', v: 1 },
          { t: '2026-06-30T22:00:00.000Z', v: 1 },
          { t: '2026-07-01T00:00:00.000Z', v: 1 },
          { t: '2026-07-31T23:00:00.000Z', v: 1 },
        ]);
      });

      it('cuts a held reader’s own rows, under the same names', async () => {
        // Dana reaches deals 1 and 2 (her own), and 5 and 9 (Lena's, whom she covers).
        await at('UTC');
        expect(await points('dana', 'close_on', 'month')).toEqual([
          { t: '2026-01-01T00:00:00.000Z', v: 1 },
          { t: '2026-07-01T00:00:00.000Z', v: 2 },
          { t: '2026-11-01T00:00:00.000Z', v: 1 },
        ]);
        expect(await points('dana', 'touched_at', 'month')).toEqual([
          { t: '2026-06-01T00:00:00.000Z', v: 2 },
          { t: '2026-07-01T00:00:00.000Z', v: 1 },
        ]);
        await at('Asia/Tokyo');
        expect(await points('dana', 'touched_at', 'month')).toEqual([
          { t: '2026-06-01T00:00:00.000Z', v: 1 },
          { t: '2026-07-01T00:00:00.000Z', v: 2 },
        ]);
      });
    });
  }
}
