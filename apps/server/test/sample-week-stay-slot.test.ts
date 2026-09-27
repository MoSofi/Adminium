// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Three sample directives, on the venue's clock:
 *
 *  - `@week`: a sample's days count from its anchor weekday in the week nearest
 *    the adding day, so a weekend stay stays on a weekend whatever day the
 *    sample is added on — across the night the clocks go back too (Europe/
 *    London, 25 October 2026);
 *  - `@byStay`: a stay's status by where the adding moment falls against its
 *    arrival and departure (read at the house's arrive-from and leave-by
 *    times): booked before, in house during, departed after;
 *  - `@in` + `@slot`: an order's pickup at the first open time of the orders'
 *    slot limit at least that far ahead — its hours, closures and pauses, on
 *    its grid — on the next day it opens when today has none; added at 21:10
 *    after closing, the live orders land on the next morning's first times,
 *    and the next timed tick leaves them live.
 *
 * The directives are checked against the manifest (a `@week` day needs the
 * bundle's anchor; a `@slot` needs a table with a slot limit; a row takes one
 * row directive), and the whole sample is added for real on every engine.
 */
import { validateManifest, sampleBundleIssues, sampleBundleSchema, type Manifest } from '@adminium/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp, resolveSampleRow, zonedWeekDay } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { readDay, readInstant } from '../src/crud/moments.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = { write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;
type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const london = 'Europe/London';
const ctx = (iso: string, extra: Doc = {}) => ({ now: Date.parse(iso), timeZone: london, locale: 'en-US', labels: new Map(), assets: new Map(), ...extra });
const weekday = (date: string) => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(`${date}T00:00:00Z`).getUTCDay()];

describe('a @week day keeps the weekday it was written for', () => {
  it('counts from the anchor weekday nearest the adding day, never more than three days away', () => {
    // Written on a Tuesday; added on Thursday 30 July 2026: the Tuesday before is nearest.
    expect(zonedWeekDay(Date.parse('2026-07-30T09:00:00Z'), london, 'tue', 0)).toEqual({ y: 2026, m: 7, d: 28 });
    // Added on Saturday 1 August: the Tuesday after is nearest.
    expect(zonedWeekDay(Date.parse('2026-08-01T09:00:00Z'), london, 'tue', 0)).toEqual({ y: 2026, m: 8, d: 4 });
  });

  it('lands a Friday-to-Sunday stay on a Friday and a Sunday, added on any day of the week', () => {
    for (let day = 26; day <= 32; day += 1) {
      const now = new Date(Date.UTC(2026, 6, day, 9, 5)).toISOString();
      const row = resolveSampleRow({ arrive: { '@day': 3, '@week': true }, depart: { '@day': 5, '@week': true } }, ctx(now, { weekAnchor: 'tue' }))!;
      expect([weekday(String(row['arrive'])), weekday(String(row['depart']))]).toEqual(['fri', 'sun']);
    }
  });

  it("reads the day on the venue's calendar across the night the clocks go back", () => {
    // 23:30 UTC on Saturday 24 October is 00:30 on Sunday 25 October in London (summer time until 02:00).
    const row = resolveSampleRow({ arrive: { '@day': 0, '@week': true }, doors: { '@day': 0, '@week': true, '@time': '19:00' } }, ctx('2026-10-24T23:30:00Z', { weekAnchor: 'sun' }))!;
    expect(row['arrive']).toBe('2026-10-25');
    // 19:00 on the 25th is winter time again: 19:00Z.
    expect((row['doors'] as Date).toISOString()).toBe('2026-10-25T19:00:00.000Z');
  });
});

describe("a stay's status by where the adding moment falls against its dates", () => {
  const stay = (arrive: number, depart: number) => ({
    arrive: { '@day': arrive },
    depart: { '@day': depart },
    '@byStay': { from: 'arrive', to: 'depart', times: { from: '15:00', to: '11:00' }, before: { status: 'booked' }, during: { status: 'in_house' }, after: { status: 'departed' } },
  });
  it('is booked before arrival, in house during, departed after — at the house times', () => {
    const at = ctx('2026-07-28T08:05:00Z'); // 09:05 in London
    expect(resolveSampleRow(stay(1, 3), at)!['status']).toBe('booked');
    // Arriving today: not until 15:00.
    expect(resolveSampleRow(stay(0, 2), at)!['status']).toBe('booked');
    expect(resolveSampleRow(stay(-2, 1), at)!['status']).toBe('in_house');
    // Leaving today: still in until 11:00.
    expect(resolveSampleRow(stay(-2, 0), at)!['status']).toBe('in_house');
    expect(resolveSampleRow(stay(-3, -1), at)!['status']).toBe('departed');
    expect(resolveSampleRow(stay(-2, 0), ctx('2026-07-28T10:30:00Z'))!['status']).toBe('departed');
  });

  it('leaves a row out by its set, and reads the two times across the clock change', () => {
    const skip = { total: 10, '@byStay': { from: { '@day': 0, '@time': '01:30' }, to: { '@day': 0, '@time': '03:00' }, during: { '@skip': true } } };
    // 01:45 GMT on the 25th, after the clocks went back: between 01:30 (the first, 00:30Z) and 03:00 (03:00Z).
    expect(resolveSampleRow(skip, ctx('2026-10-25T01:45:00Z'))).toBeNull();
    expect(resolveSampleRow(skip, ctx('2026-10-25T03:30:00Z'))).toEqual({ total: 10 });
  });
});

/** A kitchen taking pickups on a 15-minute grid from its weekly hours, closed some days, with orders cancelled at closing. */
function kitchen(perSlot = 20): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'kitchen',
    name: 'Kitchen',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A kitchen' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'hours',
          columns: [id, { ref: 'weekday', type: 'enum', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, { ref: 'open', type: 'bool', default: true }, { ref: 'opens', type: 'text', maxLength: 5, nullable: true }, { ref: 'closes', type: 'text', maxLength: 5, nullable: true }],
        },
        { ref: 'closures', columns: [id, { ref: 'from_date', type: 'date' }, { ref: 'to_date', type: 'date', nullable: true }] },
        {
          ref: 'orders',
          columns: [id, { ref: 'name', type: 'text', maxLength: 40 }, { ref: 'pickup_at', type: 'timestamptz' }, { ref: 'status', type: 'enum', enum: ['placed', 'collected', 'cancelled'], default: 'placed' }],
          capacity: {
            kind: 'slot',
            slot: 'pickup_at',
            amount: 1,
            perSlot,
            slotMinutes: 15,
            countWhere: { column: 'status', values: ['placed', 'collected'] },
            hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' },
            closures: { table: 'closures', from: 'from_date', to: 'to_date' },
          },
          states: {
            column: 'status',
            initial: 'placed',
            moves: { placed: ['collected', 'cancelled'] },
            timed: [{ from: 'placed', to: 'cancelled', at: { column: 'pickup_at', time: { hours: { table: 'hours', weekday: 'weekday', open: 'open', opens: 'opens', closes: 'closes' }, edge: 'closes' } } }],
          },
        },
        {
          ref: 'stays',
          columns: [id, { ref: 'arrive', type: 'date' }, { ref: 'depart', type: 'date' }, { ref: 'status', type: 'enum', enum: ['booked', 'in_house', 'departed'], default: 'booked' }],
        },
      ],
    },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'kitchen', icon: 'home', order: 1 } }],
    frontends: [{ side: 'staff', kind: 'spa' }],
    sampleData: { file: 'seeds/kitchen.sample.json' },
  };
}

const HOURS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => (day === 'mon' ? { weekday: day, open: false } : { weekday: day, open: true, opens: '11:30', closes: '21:00' }));

function bundle(closedTomorrow: boolean): Doc {
  return {
    format: 'adminium.sample/1',
    app: 'kitchen',
    weekAnchor: 'tue',
    tables: [
      { ref: 'hours', rows: HOURS },
      { ref: 'closures', rows: closedTomorrow ? [{ from_date: { '@day': 1 }, to_date: { '@day': 1 } }] : [{ from_date: { '@day': -30 }, to_date: { '@day': -29 } }] },
      {
        ref: 'orders',
        rows: [
          { name: 'Soon', pickup_at: { '@in': 'PT20M', '@slot': 'orders' } },
          { name: 'Later', pickup_at: { '@in': 'PT90M', '@slot': 'orders' } },
        ],
      },
      {
        ref: 'stays',
        rows: [
          {
            arrive: { '@day': 3, '@week': true },
            depart: { '@day': 5, '@week': true },
            '@byStay': { from: 'arrive', to: 'depart', times: { from: '15:00', to: '11:00' }, before: { status: 'booked' }, during: { status: 'in_house' }, after: { status: 'departed' } },
          },
        ],
      },
    ],
  };
}

describe('the sample directives, checked against the manifest', () => {
  const issues = (b: Doc) => {
    const manifest = validateManifest(kitchen());
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.issues));
    return sampleBundleIssues(sampleBundleSchema.parse(b), manifest.manifest as Manifest).map((i) => i.message);
  };
  it('takes the bundle', () => {
    expect(issues(bundle(false))).toEqual([]);
  });
  it('refuses a @week day with no anchor, a @slot on a table with no slot limit, a grid beside a slot, and two row directives', () => {
    const noAnchor = bundle(false);
    delete noAnchor['weekAnchor'];
    expect(issues(noAnchor).join('\n')).toContain('week anchor');
    const noSlot = bundle(false);
    ((noSlot['tables'] as Doc[])[2]!['rows'] as Doc[])[0]!['pickup_at'] = { '@in': 'PT20M', '@slot': 'stays' };
    expect(issues(noSlot).join('\n')).toContain('"stays" keeps no slot limit');
    expect(sampleBundleSchema.safeParse({ ...bundle(false), tables: [{ ref: 'orders', rows: [{ pickup_at: { '@in': 'PT20M', '@slot': 'orders', '@grid': 15 } }] }] }).success).toBe(true);
    const grid = { ...bundle(false), tables: [{ ref: 'orders', rows: [{ name: 'x', pickup_at: { '@in': 'PT20M', '@slot': 'orders', '@grid': 15 } }] }] };
    expect(issues(grid).join('\n')).toContain('not well formed');
    const both = bundle(false);
    const row = ((both['tables'] as Doc[])[3]!['rows'] as Doc[])[0]!;
    row['@byClock'] = { at: 'arrive', before: { status: 'booked' } };
    expect(issues(both).join('\n')).toContain('A row takes @byClock or @byStay, not both.');
  });
});

describe.each(LEGS)('the sample added for real — %s', (dialect, available) => {
  let h: InvoicingHarness | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    await h?.close();
    h = undefined;
  });
  const add = async (b: Doc, now: string, perSlot = 20, before?: (harness: InvoicingHarness) => Promise<void>) => {
    h = await installInvoicing(dialect, kitchen(perSlot), undefined, { 'seeds/kitchen.sample.json': JSON.stringify(b) });
    await before?.(h);
    await h.meta.db.updateTable('adminium_connections').set({ timezone: london } as never).where('id', '=', h.connectionId).execute();
    const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(now));
    await service.add((await findSampleApp(h.meta, 'kitchen'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.parse(now) });
    return h;
  };
  const pickups = async (harness: InvoicingHarness) =>
    (await harness.rows(`select name, pickup_at, status from ${harness.real('orders')} order by id`)).map((row) => [row['name'], readInstant(row['pickup_at'])?.toISOString(), row['status']]);

  it.runIf(available)("puts the orders on the next morning's first times when added after closing, and the clock leaves them live", async () => {
    // Tuesday 28 July 2026, 21:10 in London (20:10Z): closed since 21:00; Wednesday opens 11:30 (10:30Z).
    const harness = await add(bundle(false), '2026-07-28T20:10:00Z');
    expect(await pickups(harness)).toEqual([
      ['Soon', '2026-07-29T10:30:00.000Z', 'placed'],
      ['Later', '2026-07-29T10:30:00.000Z', 'placed'],
    ]);
    const tick = await runTimedMoves({ meta: harness.meta, manager: harness.manager }, harness.connectionId, {}, new Date('2026-07-28T20:11:00Z'));
    expect(tick.moved).toBe(0);
    expect((await pickups(harness)).map((row) => row[2])).toEqual(['placed', 'placed']);
    // Added on a Tuesday, the Friday-to-Sunday stay lands on Friday 31 July to Sunday 2 August, still to come.
    const [stay] = await harness.rows(`select arrive, depart, status from ${harness.real('stays')}`);
    expect([readDay(stay!['arrive']), readDay(stay!['depart']), stay!['status']]).toEqual(['2026-07-31', '2026-08-02', 'booked']);
  }, 120_000);

  it.runIf(available)('skips a closed day and a day the kitchen does not open, landing on the next one it does', async () => {
    // Sunday 26 July 2026, 22:00 in London: Monday does not open, and the sample closes Monday too; Tuesday it is.
    const harness = await add(bundle(true), '2026-07-26T21:00:00Z');
    expect((await pickups(harness)).map((row) => row[1])).toEqual(['2026-07-28T10:30:00.000Z', '2026-07-28T10:30:00.000Z']);
  }, 120_000);

  it.runIf(available)('never fills a time past its limit: the next rows go on the next times with room', async () => {
    const b = bundle(false);
    ((b['tables'] as Doc[])[2]!['rows'] as Doc[]).push({ name: 'Third', pickup_at: { '@in': 'PT20M', '@slot': 'orders' } });
    // Two orders a time; an operator's own order already at the next morning's first time.
    const harness = await add(b, '2026-07-28T20:10:00Z', 2, async (hh) => {
      // A zone-less time is this server's wall clock, as the write path stores one.
      const at = new Date('2026-07-29T10:30:00Z');
      const pad = (n: number) => String(n).padStart(2, '0');
      const wall = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}:00`;
      await hh.rows(`insert into ${hh.real('orders')} (name, pickup_at, status) values ('Real', '${dialect === 'postgres' ? at.toISOString() : wall}', 'placed')`);
    });
    const rows = await pickups(harness);
    const at = (name: string) => rows.find((row) => row[0] === name)![1];
    expect(at('Soon')).toBe('2026-07-29T10:30:00.000Z');
    expect([at('Later'), at('Third')]).toEqual(['2026-07-29T10:45:00.000Z', '2026-07-29T10:45:00.000Z']);
  }, 120_000);

  it.runIf(available)('lands a time already open today on the grid, at least that far ahead', async () => {
    // Wednesday 29 July, 12:07 in London (11:07Z): 20 minutes on is 12:27 → 12:30; 90 minutes on is 13:37 → 13:45.
    const harness = await add(bundle(false), '2026-07-29T11:07:00Z');
    expect((await pickups(harness)).map((row) => row[1])).toEqual(['2026-07-29T11:30:00.000Z', '2026-07-29T12:45:00.000Z']);
    // Added on the Wednesday, the Friday stay is still that week's: Friday 31 July.
    const [stay] = await harness.rows(`select arrive, status from ${harness.real('stays')}`);
    expect([readDay(stay!['arrive']), stay!['status']]).toEqual(['2026-07-31', 'booked']);
  }, 120_000);
});
