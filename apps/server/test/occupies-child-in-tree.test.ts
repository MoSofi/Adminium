// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BATCH, ITS MACHINE BOOKING AND ITS STOCK MOVEMENT IN ONE STAFF WRITE.
 *
 * A batch is cut on a machine for a time, and the app keeps the machine's
 * time in a table with `occupies` (a row a machine for a time, an overlap
 * refused). Starting a batch is one staff create: the batch, its booking and
 * the movement of the sheets it takes, every row or none. The booking, a row
 * below the batch, is placed as a root booking is: its machine's lock named
 * with the write's other locks, the row judged under it inside the
 * transaction — a time that is taken refuses the whole tree, naming the
 * child, and nothing is written. Two batches sent at once for the same
 * machine take turns: one is made, the other is refused, and neither waits
 * on the other for ever. A quote still refuses such a row.
 *
 * On every engine this run reaches, through the whole server.
 */
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { ENGINES, world, type World } from './row-limit-world.js';

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a batch, its machine booking and its stock movement in one staff write [${dialect}]`, () => {
    let w: World;
    const ids = new Map<string, string>();
    const id = (table: string): string => ids.get(table)!;
    /** The list of a batch's rows of a child table, by the child's link to it. */
    const list = (child: string) => `fk:${id(child)}(batch_id)->${id('batches')}(id)`;
    const post = (payload: unknown, dry = false) =>
      w.app.inject({ method: 'POST', url: `/api/v1/data/${w.connectionId}/${encodeURIComponent(id('batches'))}${dry ? '/dry-run' : ''}`, headers: { cookie: w.owner.cookie }, payload: payload as never });
    const error = (body: string) => (JSON.parse(body) as { error?: { code?: string; details?: Record<string, unknown> } }).error;
    const count = async (table: string) => Number((await w.rows(`select count(*) as n from ${table}`))[0]!['n']);
    const counts = async () => [await count('batches'), await count('machine_bookings'), await count('stock_movements')];
    /** A batch on the laser from `from` to `to` (UTC, 6 August), with its booking and the sheet it takes. */
    const batch = (label: string, from: string, to: string) => ({
      values: { machine_id: 1, label },
      children: {
        [list('machine_bookings')]: [{ values: { machine_id: 1, starts_at: `2026-08-06T${from}:00Z`, ends_at: `2026-08-06T${to}:00Z` } }],
        [list('stock_movements')]: [{ values: { material: 'wal6', quantity: -1 } }],
      },
    });

    beforeAll(async () => {
      w = await world(dialect);
      const at = dialect === 'postgres' ? 'timestamptz' : dialect === 'mysql' ? 'datetime' : 'timestamp';
      for (const statement of [
        `CREATE TABLE machines (id INTEGER PRIMARY KEY, name VARCHAR(40) NOT NULL)`,
        `CREATE TABLE batches (id INTEGER PRIMARY KEY ${dialect === 'mysql' ? 'AUTO_INCREMENT' : ''}, machine_id INTEGER NOT NULL, label VARCHAR(80) NOT NULL, FOREIGN KEY (machine_id) REFERENCES machines(id))`,
        `CREATE TABLE machine_bookings (id INTEGER PRIMARY KEY ${dialect === 'mysql' ? 'AUTO_INCREMENT' : ''}, machine_id INTEGER NOT NULL, batch_id INTEGER, starts_at ${at} NOT NULL, ends_at ${at} NOT NULL, FOREIGN KEY (machine_id) REFERENCES machines(id), FOREIGN KEY (batch_id) REFERENCES batches(id))`,
        `CREATE TABLE stock_movements (id INTEGER PRIMARY KEY ${dialect === 'mysql' ? 'AUTO_INCREMENT' : ''}, batch_id INTEGER, material VARCHAR(16) NOT NULL, quantity INTEGER NOT NULL, FOREIGN KEY (batch_id) REFERENCES batches(id))`,
        `INSERT INTO machines (id, name) VALUES (1, 'The laser'), (2, 'The router')`,
        `INSERT INTO machine_bookings (id, machine_id, starts_at, ends_at) VALUES (1, 1, '2026-08-06 14:00:00', '2026-08-06 16:40:00')`,
      ]) {
        await w.run(statement);
      }
      if (dialect === 'postgres') {
        for (const table of ['batches', 'machine_bookings', 'stock_movements']) {
          await w.run(`CREATE SEQUENCE ${table}_id_seq OWNED BY ${table}.id`);
          await w.run(`ALTER TABLE ${table} ALTER COLUMN id SET DEFAULT nextval('${table}_id_seq')`);
          await w.run(`SELECT setval('${table}_id_seq', 100)`);
        }
      }
      await w.meta.db.updateTable('adminium_connections').set({ timezone: 'UTC' }).where('id', '=', w.connectionId).execute();
      await runIntrospection({ manager: w.manager, meta: w.meta, connectionId: w.connectionId });
      const tables = ((await snapshotsRepo(w.meta).latest(w.connectionId))!.schema as { tables: { id: string; name: string }[] }).tables;
      for (const table of tables) ids.set(table.name, table.id);
      await overridesRepo(w.meta).create({ connectionId: w.connectionId, op: 'table.occupies', tableName: id('machine_bookings'), value: { resource: 'machine_id', start: 'starts_at', end: 'ends_at' }, origin: 'user' });
    }, 120_000);
    afterAll(async () => {
      await w?.close();
    });

    it('makes the batch, its booking and its movement together when the machine is free then', async () => {
      const res = await post(batch('Walnut sheet · 6 pieces', '16:40', '18:55'));
      expect(res.statusCode, res.body).toBe(201);
      expect(await counts()).toEqual([1, 2, 1]);
      const made = await w.rows(`select b.label, m.batch_id from machine_bookings m join batches b on b.id = m.batch_id`);
      expect(made.map((row) => row['label'])).toEqual(['Walnut sheet · 6 pieces']);
    });

    it('refuses the whole tree when the booking overlaps another, naming the child, and writes nothing', async () => {
      const before = await counts();
      const res = await post(batch('Ply sheet', '17:00', '18:00'));
      expect(res.statusCode, res.body).toBe(409);
      expect(JSON.stringify(error(res.body))).toContain('BOOKING_TAKEN');
      expect(error(res.body)?.details).toMatchObject({ relation: list('machine_bookings'), row: 0 });
      expect(await counts()).toEqual(before);
    });

    it('judges two bookings of one tree against each other', async () => {
      const before = await counts();
      const twice = batch('Two at once', '20:00', '21:00');
      const bookings = twice.children[list('machine_bookings')]!;
      bookings.push({ values: { machine_id: 1, starts_at: '2026-08-06T20:30:00Z', ends_at: '2026-08-06T21:30:00Z' } });
      const res = await post(twice);
      expect(res.statusCode, res.body).toBe(409);
      expect(JSON.stringify(error(res.body))).toContain('BOOKING_TAKEN');
      expect(await counts()).toEqual(before);
    });

    it('takes two batches sent at once for the same machine and time in turn: one is made, the other refused', async () => {
      const before = await counts();
      const [first, second] = await Promise.all([post(batch('First come', '09:00', '10:00')), post(batch('Second come', '09:30', '10:30'))]);
      expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
      const refused = first.statusCode === 409 ? first : second;
      expect(JSON.stringify(error(refused.body))).toMatch(/BOOKING_TAKEN|BOOKING_BUSY/);
      expect(await counts()).toEqual([before[0]! + 1, before[1]! + 1, before[2]! + 1]);
      // Another machine at the same time is no clash: both are made.
      const router = (label: string) => {
        const sent = batch(label, '09:00', '10:00');
        return { values: { machine_id: 2, label }, children: { ...sent.children, [list('machine_bookings')]: [{ values: { machine_id: 2, starts_at: '2026-08-06T09:00:00Z', ends_at: '2026-08-06T10:00:00Z' } }] } };
      };
      const other = batch('Laser again', '11:00', '12:00');
      const [a, b] = await Promise.all([post(router('On the router')), post(other)]);
      expect([a.statusCode, b.statusCode], `${a.body} ${b.body}`).toEqual([201, 201]);
    });

    it('still refuses such a row in a quote, which holds no lock', async () => {
      const res = await post(batch('Only asking', '22:00', '23:00'), true);
      expect(res.statusCode, res.body).toBe(409);
      expect(error(res.body)?.details?.['reason']).toBe('CAPACITY_ONE_AT_A_TIME');
    });
  });
}
