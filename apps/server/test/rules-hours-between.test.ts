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
    {
      // A visit starts when it is written down, unless someone says when.
      ref: 'visits',
      columns: [
        id,
        { ref: 'started_at', type: 'timestamptz', default: 'now' },
        { ref: 'stopped_at', type: 'timestamptz', nullable: true },
        { ref: 'hours', type: 'decimal', scale: 2, nullable: true, rules: { formula: hours } },
      ],
    },
  ]);
}

/**
 * A table the app did not make: a zone-less pair and a zoned pair of each
 * engine's own kinds, each with its hours as an operator's rule; a stop
 * stamped when the punch moves to `stopped`, with its own hours; and hours
 * kept in a column too narrow for a long span.
 */
function punchesDdl(dialect: Dialect, name: string): string {
  if (dialect === 'postgres') {
    return `create table ${name} (id serial primary key, wall_in timestamp, wall_out timestamp, at_in timestamptz, at_out timestamptz, wall_hours numeric(10,2), at_hours numeric(10,2), state varchar(20), stamped_out timestamptz, stamped_hours numeric(10,2), short_hours numeric(6,2))`;
  }
  if (dialect === 'mysql') {
    return `create table ${name} (id int auto_increment primary key, wall_in datetime(3) null, wall_out datetime(3) null, at_in timestamp(3) null default null, at_out timestamp(3) null default null, wall_hours decimal(10,2) null, at_hours decimal(10,2) null, state varchar(20) null, stamped_out timestamp(3) null default null, stamped_hours decimal(10,2) null, short_hours decimal(6,2) null)`;
  }
  // SQLite has no zone to keep: both pairs are wall times there.
  return `create table ${name} (id integer primary key autoincrement, wall_in timestamp, wall_out timestamp, at_in timestamp, at_out timestamp, wall_hours decimal(10,2), at_hours decimal(10,2), state varchar(20), stamped_out timestamp, stamped_hours decimal(10,2), short_hours decimal(6,2))`;
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
      for (const [target, pair] of [
        ['wall_hours', ['wall_in', 'wall_out']],
        ['at_hours', ['at_in', 'at_out']],
        ['stamped_hours', ['at_in', 'stamped_out']],
        ['short_hours', ['at_in', 'at_out']],
      ] as const) {
        expect(columnRuleIssue('column.formula', { formula: { hoursBetween: pair } }, column(target), model)).toBeNull();
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.formula', tableName: punches.id, columnName: target, value: { formula: { hoursBetween: pair } }, origin: 'user' });
        await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.scale', tableName: punches.id, columnName: target, value: { scale: 2 }, origin: 'user' });
      }
      expect(columnRuleIssue('column.formula', { formula: { hoursBetween: ['id', 'wall_out'] } }, column('wall_hours'), model)).toContain('is not a moment');
      await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.stamp', tableName: punches.id, columnName: 'stamped_out', value: { set: 'now', on: { column: 'state', values: ['stopped'] } }, origin: 'user' });
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

    /** Milliseconds of a stored moment: a Date from the drivers, a wall time (SQLite) on this server's clock. */
    const ms = (value: unknown) => (value instanceof Date ? value.getTime() : new Date(String(value).replace(' ', 'T')).getTime());

    it('counts the hours to a stop stamped now, on a column that keeps a zone', async () => {
      // An hour ago, as an instant: the stamp's "now" must be read as the moment it is.
      const punch = await w.create('punches', { at_in: new Date(Date.now() - 3_600_000).toISOString(), state: 'running' });
      await w.update('punches', punch['id'], { state: 'stopped' });
      const stored = await row('punches', punch['id']);
      expect(ms(stored['stamped_out']) - Date.now()).toBeLessThan(60_000);
      const elapsed = (ms(stored['stamped_out']) - ms(stored['at_in'])) / 3_600_000;
      expect(elapsed).toBeCloseTo(1, 2);
      expect(at(stored['stamped_hours'])).toBe('100');
    });

    it('reads a zone-less time sent for a zoned column on this server’s clock, as it stores it', async () => {
      const punch = await w.create('punches', { at_in: '2026-09-25T08:15:00Z', at_out: '2026-09-25T09:15:00Z' });
      // 11:45 on a London wall in September is 10:45 UTC, whatever zone the database's session is in.
      await w.update('punches', punch['id'], { at_out: '2026-09-25 11:45:00' });
      const stored = await row('punches', punch['id']);
      expect(ms(stored['at_out'])).toBe(Date.parse('2026-09-25T10:45:00Z'));
      expect((ms(stored['at_out']) - ms(stored['at_in'])) / 3_600_000).toBe(2.5);
      expect(at(stored['at_hours'])).toBe('250');
    });

    it('starts a visit when it is written down, on this server’s clock, and counts its hours', async () => {
      const before = Date.now();
      const visit = await w.create('visits', { stopped_at: new Date(before + 2 * 3_600_000).toISOString() });
      const stored = await row('visits', visit['id']);
      // Adminium fills the start: the hours are there on the create, not left for a later write.
      expect(Math.abs(ms(stored['started_at']) - before)).toBeLessThan(60_000);
      expect(Number(at(stored['hours']))).toBeGreaterThanOrEqual(199);
      expect(Number(at(stored['hours']))).toBeLessThanOrEqual(200);
      if (dialect === 'mysql') {
        // The DATETIME has no database default: its UTC session would fill UTC's wall clock.
        const [column] = await h.rows(
          `select column_default as d from information_schema.columns where table_schema = database() and table_name = '${h.real('visits')}' and column_name = 'started_at'`,
        );
        expect(column!['d'] ?? null).toBeNull();
        // A DATETIME the database fills itself (one made before, or an operator's own) is filled by Adminium on its writes.
        await h.rows(`create table ${h.real('stays')} (id int auto_increment primary key, arrived datetime(3) not null default current_timestamp(3))`);
        await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
        const stay = await (await writerFor(h)).create('stays', {});
        const [arrived] = await h.rows(`select arrived from ${h.real('stays')} where id = ${String(stay['id'])}`);
        expect(Math.abs(ms(arrived!['arrived']) - Date.now())).toBeLessThan(60_000);
      }
    });

    it('refuses hours the column cannot hold, naming the moments they are counted from', async () => {
      // 10 000 hours and more do not fit a numeric(6, 2); SQLite would keep them, the others refuse them unnamed.
      const refusal = w.create('punches', { at_in: '2026-01-01T00:00:00Z', at_out: '2027-12-01T00:00:00Z' });
      await expect(refusal).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { fields: { at_in: { code: 'out-of-range' }, at_out: { code: 'out-of-range' } } } });
      const punch = await w.create('punches', { at_in: '2026-01-01T00:00:00Z', at_out: '2026-01-02T00:00:00Z' });
      await expect(w.update('punches', punch['id'], { at_out: '2027-12-01T00:00:00Z' })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { at_out: { code: 'out-of-range' } } },
      });
      expect(at((await row('punches', punch['id']))['short_hours'])).toBe('2400');
    });
  });
}

describe('hours from what SQLite keeps', () => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let w: Awaited<ReturnType<typeof writerFor>>;
  const row = async (key: unknown) => (await h.rows(`select * from ${h.real('clocks')} where id = ${String(key)}`))[0]!;

  beforeAll(async () => {
    h = await installInvoicing('sqlite', manifest());
    // A start SQLite fills with the seconds since 1970, as `unixepoch()` does.
    await h.rows(`create table ${h.real('clocks')} (id integer primary key autoincrement, clock_in timestamp default (unixepoch()), clock_out timestamp, clock_hours decimal(10,2))`);
    await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
    const model = parseDatabaseModel((await snapshotsRepo(h.meta).latest(h.connectionId))!.schema);
    const clocks = model.tables.find((t) => t.name === h.real('clocks'))!;
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.formula', tableName: clocks.id, columnName: 'clock_hours', value: { formula: { hoursBetween: ['clock_in', 'clock_out'] } }, origin: 'user' });
    await overridesRepo(h.meta).create({ connectionId: h.connectionId, op: 'column.scale', tableName: clocks.id, columnName: 'clock_hours', value: { scale: 2 }, origin: 'user' });
    w = await writerFor(h);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('counts from seconds since 1970, a zone after a space, and never from a day the calendar lacks', async () => {
    // The database fills the start with a number; the stop, moved later, is counted from it.
    const clock = await w.create('clocks', {});
    expect(typeof (await row(clock['id']))['clock_in']).toBe('number');
    await w.update('clocks', clock['id'], { clock_out: new Date(Date.now() + 90 * 60_000).toISOString() });
    expect(Number(at((await row(clock['id']))['clock_hours'])) / 100).toBeCloseTo(1.5, 1);
    // A zone after a space, as a text a tool wrote.
    const spaced = await w.create('clocks', { clock_in: '2026-09-25 09:15:00 +02:00', clock_out: '2026-09-25 11:45:00 +02:00' });
    expect(at((await row(spaced['id']))['clock_hours'])).toBe('250');
    // 30 February is no time: no hours, rather than the hours to 2 March.
    const impossible = await w.create('clocks', { clock_in: '2026-02-28 10:00:00', clock_out: '2026-02-30 10:00:00' });
    expect((await row(impossible['id']))['clock_hours']).toBeNull();
  });
});
