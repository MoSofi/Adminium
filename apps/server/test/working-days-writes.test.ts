// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `addWorkingDays` on every engine this run can reach, through an app
 * installed by the real installer, on a venue in Europe/London and a server
 * on UTC — so a date that came out on UTC's clock would be caught.
 *
 * A print works promises its jobs in working days (Mon–Fri, a 14:00 cut-off
 * kept as the app's settings); a maker counts from an order's time with a
 * 17:00 cut-off and a workshop closure. The closures are read in the write;
 * a switched-off one is ignored; one on the day an order comes in moves the
 * day it is received. The owner's change of the working week moves the next
 * order's date. A stamp fired by a move counts from now, and a guest's quote
 * gives the date the save stores.
 */
import { addOnSettingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { solveProof } from '../src/public-api/proof.js';
import { venueClock } from '../src/crud/venue-time.js';
import { dayPlus } from '../src/crud/moments.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { onlyInstall } from './only-install.js';

// The server on UTC, the venue in London: a summer afternoon is an hour apart.
process.env.TZ = 'UTC';

const id = { ref: 'id', type: 'int', role: 'pk' };
const CLOSURES = { table: 'closures', from: 'starts_on', to: 'ends_on', active: 'active' };
const ALL_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function manifest(): Record<string, unknown> {
  const m = invoicingManifest([
    { ref: 'closures', columns: [id, { ref: 'name', type: 'text', maxLength: 60 }, { ref: 'starts_on', type: 'date' }, { ref: 'ends_on', type: 'date' }, { ref: 'active', type: 'bool', default: true }] },
    {
      // Print: standard 3 days, express 1, the week and the cut-off the shop's settings.
      ref: 'jobs',
      columns: [
        id,
        { ref: 'received_at', type: 'timestamptz', nullable: true },
        { ref: 'service', type: 'enum', enum: ['standard', 'express'], default: 'standard' },
        {
          ref: 'ready_by',
          type: 'date',
          nullable: true,
          rules: {
            stamp: {
              set: { addWorkingDays: { from: 'received_at', days: 'service', map: { standard: 3, express: 1 }, weekdays: 'working_days', cutoff: 'cutoff', closures: CLOSURES } },
              on: { columns: ['received_at', 'service'] },
            },
          },
        },
      ],
    },
    {
      // Maker: so many days from the order's time, Mon–Fri, a 17:00 cut-off, stated in the rule.
      ref: 'makes',
      columns: [
        id,
        { ref: 'ordered_at', type: 'timestamptz', nullable: true },
        { ref: 'days', type: 'int', nullable: true },
        {
          ref: 'ready_by',
          type: 'date',
          nullable: true,
          rules: { stamp: { set: { addWorkingDays: { from: 'ordered_at', days: 'days', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], cutoff: '17:00', closures: CLOSURES } }, on: { columns: ['ordered_at', 'days'] } } },
        },
      ],
    },
    {
      // A proof approved: the ready-by counts again from that moment.
      ref: 'proofs',
      columns: [
        id,
        { ref: 'proof_state', type: 'enum', enum: ['waiting', 'approved'], default: 'waiting' },
        { ref: 'ready_by', type: 'date', nullable: true, rules: { stamp: { set: { addWorkingDays: { from: 'now', days: 3, weekdays: ALL_WEEK } }, on: { column: 'proof_state', values: ['approved'] } } } },
      ],
    },
    // An order's ready-by: its newest job's.
    { ref: 'press_orders', columns: [id, { ref: 'ready_by', type: 'date', nullable: true, rules: { rollup: { from: 'press_jobs', via: 'order_id', latest: { of: 'ready_by', by: 'ready_by' } } } }] },
    {
      // Days a formula works out: the job's own days and one for each change asked on it (a total of its child rows).
      ref: 'press_jobs',
      columns: [
        id,
        { ref: 'order_id', type: 'fk', references: 'press_orders', nullable: true },
        { ref: 'received_at', type: 'timestamptz', nullable: true },
        { ref: 'base_days', type: 'int', nullable: true },
        { ref: 'changes', type: 'int', nullable: true, rules: { rollup: { from: 'press_changes', via: 'job_id', count: true } } },
        { ref: 'days', type: 'int', nullable: true, rules: { formula: { add: [{ coalesce: ['base_days', 3] }, { coalesce: ['changes', 0] }] } } },
        {
          ref: 'ready_by',
          type: 'date',
          nullable: true,
          rules: { stamp: { set: { addWorkingDays: { from: 'received_at', days: 'days', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], cutoff: '14:00' } }, on: ['create', { columns: ['days'] }] } },
        },
      ],
    },
    { ref: 'press_changes', columns: [id, { ref: 'job_id', type: 'fk', references: 'press_jobs' }, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] },
    {
      // A guest's rush order: two days from now, every day of the week.
      ref: 'rushes',
      columns: [id, { ref: 'note', type: 'text', maxLength: 80, nullable: true }, { ref: 'ready_by', type: 'date', nullable: true, rules: { stamp: { set: { addWorkingDays: { from: 'now', days: 2, weekdays: ALL_WEEK } }, on: 'create' } } }],
    },
    {
      // A week setting whose own default is no week: nothing to fall back on.
      ref: 'odd_jobs',
      columns: [id, { ref: 'received_at', type: 'timestamptz', nullable: true }, { ref: 'ready_by', type: 'date', nullable: true, rules: { stamp: { set: { addWorkingDays: { from: 'received_at', days: 1, weekdays: 'bad_week' } }, on: 'create' } } }],
    },
  ]);
  m['key'] = 'works';
  m['settings'] = [
    { key: 'working_days', type: 'string', default: 'mon,tue,wed,thu,fri' },
    { key: 'cutoff', type: 'string', default: '14:00' },
    { key: 'bad_week', type: 'string', default: 'someday' },
  ];
  (m['pages'] as { bindings: Record<string, string> }[])[0]!.bindings = { rows: 'jobs' };
  m['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  m['publicAccess'] = [{ table: 'rushes', methods: ['POST'], writable: ['note'], select: ['id', 'ready_by'], humanCheck: true, dryRun: true }];
  // A band, a working-day stamp and a ceil or floor are read by Adminium 0.3.43 and later.
  m['compatibility'] = { minAdminiumVersion: '0.3.43' };
  return m;
}

const day = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `${String(value.getFullYear())}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  return String(value).slice(0, 10);
};

describe.each(LEGS)('working days, on %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let w: Awaited<ReturnType<typeof writerFor>>;
  let served: Served;
  const stored = async (ref: string, key: unknown) => (await h.rows(`select * from ${h.real(ref)} where id = ${String(key)}`))[0]!;
  const job = async (at: string, service: 'standard' | 'express' = 'standard') => day((await stored('jobs', (await w.create('jobs', { received_at: at, service }))['id']))['ready_by']);
  const make = async (at: string, days: number) => day((await stored('makes', (await w.create('makes', { ordered_at: at, days }))['id']))['ready_by']);
  const closure = async (name: string, from: string, to: string, active = true) =>
    (await w.create('closures', { name, starts_on: from, ends_on: to, active }))['id'];
  const drop = async (key: unknown) => {
    await w.writes.delete({ target: w.targetOf('closures'), pk: { id: key }, context: w.desk, announce: async () => {} });
  };
  const declared = [
    { key: 'working_days', secret: false },
    { key: 'cutoff', secret: false },
    { key: 'bad_week', secret: false },
  ];

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest());
    expect((h.reply['rules'] as { skipped: unknown[] }).skipped).toEqual([]);
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });

  it.skipIf(!available)('promises a print job received Wednesday 5 August at 10:20 for Monday, and express for Thursday', async () => {
    // 10:20 in London is 09:20 UTC.
    expect(await job('2026-08-05T09:20:00Z')).toBe('2026-08-10');
    expect(await job('2026-08-05T09:20:00Z', 'express')).toBe('2026-08-06');
  });

  it.skipIf(!available)("counts a maker's days past a workshop closure: 3/4/5/10 days from Thursday 6 August 16:40", async () => {
    const whitby = await closure('Whitby', '2026-08-17', '2026-08-17');
    const at = '2026-08-06T15:40:00Z';
    expect([await make(at, 3), await make(at, 4), await make(at, 5), await make(at, 10)]).toEqual(['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-21']);
    // Without the closure the tenth day is the Thursday.
    await drop(whitby);
    expect(await make(at, 10)).toBe('2026-08-20');
  });

  it.skipIf(!available)('takes an order before the cut-off that day, and after it the next working day', async () => {
    // Friday 13:59 → Wednesday; 14:01 → Thursday; Saturday 10:00 → Thursday.
    expect(await job('2026-08-07T12:59:00Z')).toBe('2026-08-12');
    expect(await job('2026-08-07T13:01:00Z')).toBe('2026-08-13');
    expect(await job('2026-08-08T09:00:00Z')).toBe('2026-08-13');
    // Exactly at the cut-off is after it.
    expect(await job('2026-08-07T13:00:00Z')).toBe('2026-08-13');
  });

  it.skipIf(!available)('pushes the date a day for a bank holiday Monday, ignores one switched off, and moves the day an order is received', async () => {
    const holiday = await closure('Bank holiday', '2026-08-10', '2026-08-10');
    expect(await job('2026-08-07T12:59:00Z')).toBe('2026-08-13');
    await drop(holiday);
    const off = await closure('Not this year', '2026-08-10', '2026-08-10', false);
    expect(await job('2026-08-07T12:59:00Z')).toBe('2026-08-12');
    await drop(off);
    // A closure on the Wednesday itself: received Thursday, ready Tuesday.
    const shut = await closure('Boiler', '2026-08-05', '2026-08-05');
    expect(await job('2026-08-05T09:20:00Z')).toBe('2026-08-11');
    await drop(shut);
  });

  it.skipIf(!available)("reads the venue's day across the clock changes, never UTC's", async () => {
    // The clocks go back on Sunday 25 October: Friday 23rd is still summer time, 14:01 in London is 13:01 UTC.
    expect(await job('2026-10-23T12:59:00Z')).toBe('2026-10-28');
    expect(await job('2026-10-23T13:01:00Z')).toBe('2026-10-29');
    // They go forward on Sunday 29 March: Friday 27th is on GMT, Monday 30th on summer time.
    expect(await job('2026-03-27T13:59:00Z')).toBe('2026-04-01');
    expect(await job('2026-03-27T14:01:00Z')).toBe('2026-04-02');
    // Monday 30 March 14:30 in London (13:30 UTC, before the cut-off on UTC's clock): received Tuesday, express Wednesday.
    expect(await job('2026-03-30T13:30:00Z', 'express')).toBe('2026-04-01');
  });

  it.skipIf(!available)("follows the owner's working week, and falls back to the declared one for a week it cannot read", async () => {
    const settings = addOnSettingsRepo(h.meta);
    const works = await onlyInstall(h.meta, 'works');
    try {
      await settings.patch(works, { working_days: 'mon,tue,wed,thu,fri,sat' }, declared);
      // Friday 14:01: received Saturday, ready Wednesday.
      expect(await job('2026-08-07T13:01:00Z')).toBe('2026-08-12');
      await settings.patch(works, { cutoff: '15:00' }, declared);
      expect(await job('2026-08-07T13:01:00Z')).toBe('2026-08-11');
      // A week nobody can read is the app's default (Mon–Fri), a cut-off nobody can read the default 14:00.
      await settings.patch(works, { working_days: 'someday', cutoff: 'teatime' }, declared);
      expect(await job('2026-08-07T13:01:00Z')).toBe('2026-08-13');
    } finally {
      await settings.patch(works, { working_days: 'mon,tue,wed,thu,fri', cutoff: '14:00' }, declared);
    }
  });

  it.skipIf(!available)('refuses a write whose week neither the setting nor its default spells, and never counts calendar days', async () => {
    const refused = await w.create('odd_jobs', { received_at: '2026-08-07T09:00:00Z' }).then(
      () => null,
      (error: unknown) => error as { code?: string; details?: { fields?: Record<string, { code: string }> } },
    );
    expect(refused?.code).toBe('VALIDATION_FAILED');
    expect(refused?.details?.fields).toEqual({ ready_by: { code: 'unreadable-setting' } });
    expect(Number((await h.rows(`select count(*) as n from ${h.real('odd_jobs')}`))[0]!['n'])).toBe(0);
  });

  it.skipIf(!available)('refuses more working days than it counts as out-of-range, on the column the days are read from', async () => {
    const refused = await w.create('makes', { ordered_at: '2026-08-06T09:00:00Z', days: 401 }).then(
      () => null,
      (error: unknown) => error as { code?: string; details?: { fields?: Record<string, { code: string }> } },
    );
    expect(refused?.details?.fields).toEqual({ days: { code: 'out-of-range' } });
    expect(await make('2026-08-06T09:00:00Z', 400)).not.toBeNull();
  });

  it.skipIf(!available)('stamps the ready-by again when the proof is approved, counting from that moment', async () => {
    const proof = await w.create('proofs', {});
    expect((await stored('proofs', proof['id']))['ready_by']).toBeNull();
    await w.update('proofs', proof['id'], { proof_state: 'approved' });
    const today = venueClock(new Date(), 'Europe/London').day;
    expect(day((await stored('proofs', proof['id']))['ready_by'])).toBe(dayPlus(today, 3));
  });

  it.skipIf(!available)('counts the days a formula works out: on the create, on a change of what it reads, and when a change asked on the job adds one', async () => {
    // Wednesday 5 August 10:20 in London: three days is Monday, four Tuesday.
    const order = await w.create('press_orders', {});
    const made = await w.create('press_jobs', { order_id: order['id'], received_at: '2026-08-05T09:20:00Z', base_days: 3 });
    // The job's days and ready-by, and its order's ready-by, which follows the job's.
    const at = async () => {
      const row = await stored('press_jobs', made['id']);
      expect(day((await stored('press_orders', order['id']))['ready_by'])).toBe(day(row['ready_by']));
      return [Number(row['days']), day(row['ready_by'])];
    };
    expect(await at()).toEqual([3, '2026-08-10']);
    await w.update('press_jobs', made['id'], { base_days: 4 });
    expect(await at()).toEqual([4, '2026-08-11']);
    // A change asked: the job's total of them moves its days, and the ready-by with them, and the order's.
    const change = await w.create('press_changes', { job_id: made['id'], note: 'Bigger date line.' });
    expect(await at()).toEqual([5, '2026-08-12']);
    await w.writes.delete({ target: w.targetOf('press_changes'), pk: { id: change['id'] }, context: w.desk, announce: async () => {} });
    expect(await at()).toEqual([4, '2026-08-11']);
    // Its days left to the formula's own: three again.
    await w.update('press_jobs', made['id'], { base_days: null });
    expect(await at()).toEqual([3, '2026-08-10']);
  });

  it.skipIf(!available)("quotes a guest the date the save then stores, on the venue's calendar", async () => {
    const post = async (url: string) => {
      const address = '10.12.0.1';
      let headers = served.headers();
      if (!url.endsWith('dry-run')) {
        const res = await served.composed.app.inject({ method: 'GET', url: '/api/v1/public/challenge?purpose=write', remoteAddress: address, headers });
        const c = (res.json() as { data: { id: string; salt: string; difficulty: number } }).data;
        headers = served.headers(undefined, { 'x-adminium-proof': `${c.id}.${solveProof(c.salt, c.difficulty)}` });
      }
      return served.composed.app.inject({ method: 'POST', url: `/api/v1/public/records/${url}`, remoteAddress: address, headers, payload: { values: { note: 'Rush' } } });
    };
    const quote = await post('works_rushes/dry-run');
    expect(quote.statusCode, quote.body).toBe(200);
    const saved = await post('works_rushes');
    expect(saved.statusCode, saved.body).toBe(201);
    const today = venueClock(new Date(), 'Europe/London').day;
    const quoted = day((quote.json() as { data: Record<string, unknown> }).data['ready_by']);
    expect(quoted).toBe(dayPlus(today, 2));
    expect(day((saved.json() as { data: Record<string, unknown> }).data['ready_by'])).toBe(quoted);
    expect(day((await stored('rushes', (saved.json() as { data: { id: unknown } }).data.id))['ready_by'])).toBe(quoted);
  });
});
