// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `hoursBetween`: a time entry's hours from its start and its stop, worked out
 * by the write path on every engine, over real rows.
 *
 * What "hours" means: the time that really passed. A moment with a zone is
 * that moment; a time without one is read on the server's clock — the clock
 * Adminium writes such times on (`crud/write-values.ts`), and the one the
 * Postgres and MySQL drivers read them back on. So on the night the clocks go
 * forward, 00:30 → 03:30 on a London wall is two hours, not three, whether the
 * column keeps a zone (Postgres `timestamptz`, MySQL `TIMESTAMP`) or not
 * (Postgres `timestamp`, MySQL `DATETIME`, SQLite text). This file runs the
 * server on London's clock to say so.
 *
 * An empty start or stop leaves the hours empty, and so does a stop before its
 * start: a negative span is a typo, and a negative number of hours would
 * quietly take pay off a total.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { columnRuleIssue } from '../src/connections/column-rules-validation.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type Dialect, type InvoicingHarness } from './invoicing-install.helpers.js';
import { units } from './invoicing-writes.helpers.js';

// This file's server runs on London's clock (a process of its own: vitest forks one per file).
process.env.TZ = 'Europe/London';

const id = { ref: 'id', type: 'int', role: 'pk' };
const hours = { hoursBetween: ['started_at', 'stopped_at'] };

/** A time entry: its start, its stop, its hours, and the pay the hours make at a rate. */
function manifest(): Record<string, unknown> {
  return invoicingManifest([
    {
      ref: 'shifts',
      columns: [
        id,
        { ref: 'started_at', type: 'timestamptz', nullable: true },
        { ref: 'stopped_at', type: 'timestamptz', nullable: true },
        { ref: 'hours', type: 'decimal', scale: 2, nullable: true, rules: { formula: hours } },
        { ref: 'rate', type: 'decimal', scale: 2, nullable: true },
        { ref: 'pay', type: 'decimal', scale: 2, nullable: true, rules: { formula: { mul: ['hours', { coalesce: ['rate', 0] }] } } },
      ],
    },
  ]);
}

/**
 * A table the app did not make: a zone-less pair and a zoned pair of each
 * engine's own kinds, each with its hours as an operator's rule.
 */
function punchesDdl(dialect: Dialect, name: string): string {
  if (dialect === 'postgres') {
    return `create table ${name} (id serial primary key, wall_in timestamp, wall_out timestamp, at_in timestamptz, at_out timestamptz, wall_hours numeric(10,2), at_hours numeric(10,2))`;
  }
  if (dialect === 'mysql') {
    return `create table ${name} (id int auto_increment primary key, wall_in datetime(3) null, wall_out datetime(3) null, at_in timestamp(3) null default null, at_out timestamp(3) null default null, wall_hours decimal(10,2) null, at_hours decimal(10,2) null)`;
  }
  // SQLite has no zone to keep: both pairs are wall times there.
  return `create table ${name} (id integer primary key autoincrement, wall_in timestamp, wall_out timestamp, at_in timestamp, at_out timestamp, wall_hours decimal(10,2), at_hours decimal(10,2))`;
}

const at = (value: unknown) => (value === null || value === undefined ? null : units(value, 2).toString());

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`hours between two moments, on ${dialect}`, () => {
    let h: InvoicingHarness & { reply: Record<string, unknown> };
    let w: Awaited<ReturnType<typeof writerFor>>;
    const row = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;

    beforeAll(async () => {
      // London's clock, not the machine's: noon UTC in September is 13:00 here.
      expect(new Date('2026-09-25T12:00:00Z').getHours()).toBe(13);
      h = await installInvoicing(dialect, manifest());
      expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
      await h.rows(punchesDdl(dialect, h.real('punches')));
      await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
      const snapshot = (await snapshotsRepo(h.meta).latest(h.connectionId))!;
      const model = parseDatabaseModel(snapshot.schema);
      const punches = model.tables.find((t) => t.name === h.real('punches'))!;
      const column = (name: string) => punches.columns.find((c) => c.name === name)!;
      // The live check an operator's rule passes: both pairs are moments, a key is not.
      for (const [target, pair] of [['wall_hours', ['wall_in', 'wall_out']], ['at_hours', ['at_in', 'at_out']]] as const) {
        expect(columnRuleIssue('column.formula', { formula: { hoursBetween: pair } }, column(target), model)).toBeNull();
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.formula', tableName: punches.id, columnName: target, value: { formula: { hoursBetween: pair } }, origin: 'user' });
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.scale', tableName: punches.id, columnName: target, value: { scale: 2 }, origin: 'user' });
      }
      expect(columnRuleIssue('column.formula', { formula: { hoursBetween: ['id', 'wall_out'] } }, column('wall_hours'), model)).toContain('is not a moment');
      w = await writerFor(h);
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('works a shift out: 09:15 → 11:45 is 2.50, and the pay after it', async () => {
      // 25 September: London is an hour ahead of UTC.
      const shift = await w.create('shifts', { started_at: '2026-09-25T08:15:00Z', stopped_at: '2026-09-25T10:45:00Z', rate: '40', hours: '99', pay: '1' });
      let stored = await row('shifts', shift['id']);
      expect(at(stored['hours'])).toBe('250');
      expect(at(stored['pay'])).toBe('10000');
      // The stop moved: the hours, and the pay after them, from the start as stored.
      await w.update('shifts', shift['id'], { stopped_at: '2026-09-25T12:45:00Z' });
      stored = await row('shifts', shift['id']);
      expect(at(stored['hours'])).toBe('450');
      expect(at(stored['pay'])).toBe('18000');
      // A writer's hours are dropped, not taken.
      await w.update('shifts', shift['id'], { hours: '1' });
      expect(at((await row('shifts', shift['id']))['hours'])).toBe('450');
    });

    it('counts across midnight, and leaves an open or backwards shift without hours', async () => {
      const night = await w.create('shifts', { started_at: '2026-09-25T21:30:00Z', stopped_at: '2026-09-26T00:15:00Z' });
      expect(at((await row('shifts', night['id']))['hours'])).toBe('275');
      const open = await w.create('shifts', { started_at: '2026-09-25T08:00:00Z', rate: '40' });
      let stored = await row('shifts', open['id']);
      expect(stored['hours']).toBeNull();
      expect(stored['pay']).toBeNull();
      // Stopped before it started: no hours, rather than negative ones.
      await w.update('shifts', open['id'], { stopped_at: '2026-09-25T07:00:00Z' });
      stored = await row('shifts', open['id']);
      expect(stored['hours']).toBeNull();
      await w.update('shifts', open['id'], { stopped_at: '2026-09-25T08:20:00Z' });
      // A third of an hour, rounded once.
      expect(at((await row('shifts', open['id']))['hours'])).toBe('33');
    });

    it('counts the hours that passed on the nights London changes its clocks', async () => {
      // 29 March: 00:30 GMT → 03:30 BST on the wall, two hours on any clock.
      const spring = await w.create('shifts', { started_at: '2026-03-29T00:30:00Z', stopped_at: '2026-03-29T02:30:00Z' });
      expect(at((await row('shifts', spring['id']))['hours'])).toBe('200');
      // 25 October: 00:30 BST → 02:30 GMT on the wall, three hours.
      const autumn = await w.create('shifts', { started_at: '2026-10-24T23:30:00Z', stopped_at: '2026-10-25T02:30:00Z' });
      expect(at((await row('shifts', autumn['id']))['hours'])).toBe('300');
    });

    it("counts a zone-less pair and a zoned pair of the engine's own kinds alike", async () => {
      const punch = await w.create('punches', {
        wall_in: '2026-03-29 00:30:00',
        wall_out: '2026-03-29 03:30:00',
        at_in: '2026-03-29T00:30:00Z',
        at_out: '2026-03-29T02:30:00Z',
      });
      let stored = await row('punches', punch['id']);
      expect([at(stored['wall_hours']), at(stored['at_hours'])]).toEqual(['200', '200']);
      // Each stop moved alone: the start is read back as the driver hands it.
      await w.update('punches', punch['id'], { wall_out: '2026-03-29 04:00:00', at_out: '2026-03-29T03:00:00Z' });
      stored = await row('punches', punch['id']);
      expect([at(stored['wall_hours']), at(stored['at_hours'])]).toEqual(['250', '250']);
      // The night the clocks go back, on the wall: 00:30 BST → 02:30 GMT is three hours.
      const autumn = await w.create('punches', { wall_in: '2026-10-25 00:30:00', wall_out: '2026-10-25 02:30:00' });
      expect(at((await row('punches', autumn['id']))['wall_hours'])).toBe('300');
      // An ordinary day, across midnight.
      const late = await w.create('punches', { wall_in: '2026-09-25 22:30:00', wall_out: '2026-09-26 01:15:00', at_in: '2026-09-25T21:30:00Z', at_out: '2026-09-26T00:15:00Z' });
      stored = await row('punches', late['id']);
      expect([at(stored['wall_hours']), at(stored['at_hours'])]).toEqual(['275', '275']);
    });
  });
}
