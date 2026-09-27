// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A moment's time of day kept on the row itself (`time: {column}`), on every
 * engine, the clock fixed, on a venue in London (run it again in a process on
 * another zone, `TZ=America/Los_Angeles`: nothing may change): the guest's own
 * arrival time on their stay is when the house expects them (a stamp, worked
 * out again when it changes, falling back to the house's time when empty);
 * a check-in is allowed from two hours before it; the clock makes the stay a
 * no-show six hours after it. A time the clocks pass twice (01:30 on 25
 * October 2026) is read as the first.
 *
 * And the settings a moment reads come from the ONE settings row: a table
 * found holding two rows has no setting at all — never whichever came first.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readInstant } from '../src/crud/moments.js';
import { runTimedMoves } from '../src/states/timed-moves.js';
import { houseManifest } from './house-moves.fixture.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const at = (when: string) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(when));
};

describe.each(LEGS)("a moment's time of day kept on the row — %s", (dialect, available) => {
  let h: InvoicingHarness;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let type: Record<string, unknown>;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, houseManifest());
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    type = await w.create('room_types', { name: 'Double' });
    for (let i = 0; i < 6; i += 1) await w.create('rooms', { number: `R${String(i)}`, room_type_id: type['id'] });
  }, 180_000);
  afterAll(async () => {
    if (available) await h.close();
  });
  afterEach(() => vi.useRealTimers());

  const stayRow = async (key: unknown) => (await h.rows(`select * from ${h.real('stays')} where id = ${String(key)}`))[0]!;
  const expected = async (key: unknown) => readInstant((await stayRow(key))['expected_at'])?.toISOString() ?? null;
  const stay = (values: Record<string, unknown>) => {
    n += 1;
    return w.create('stays', { guest: `Guest ${String(n)}`, room_type_id: type['id'], arrive: '2026-11-02', depart: '2026-11-04', ...values });
  };

  it.runIf(available)("expects the guest at their own time, again when it changes, and at the house's time when they give none", async () => {
    at('2026-11-01T09:00:00Z');
    const s = await stay({ arrival_time: '18:30' });
    expect(await expected(s['id'])).toBe('2026-11-02T18:30:00.000Z');
    await w.update('stays', s['id'], { arrival_time: '20:00' });
    expect(await expected(s['id'])).toBe('2026-11-02T20:00:00.000Z');
    // As a person types it, or as a database time keeps it.
    await w.update('stays', s['id'], { arrival_time: '9:05' });
    expect(await expected(s['id'])).toBe('2026-11-02T09:05:00.000Z');
    // Not a time of day: the house's time stands in.
    await w.update('stays', s['id'], { arrival_time: '25:00' });
    expect(await expected(s['id'])).toBe('2026-11-02T15:00:00.000Z');
    await w.update('stays', s['id'], { arrival_time: null });
    expect(await expected(s['id'])).toBe('2026-11-02T15:00:00.000Z');
  });

  it.runIf(available)('reads a time the clocks pass twice as the first', async () => {
    at('2026-10-20T09:00:00Z');
    const s = await stay({ arrive: '2026-10-25', depart: '2026-10-26', arrival_time: '01:30' });
    expect(await expected(s['id'])).toBe('2026-10-25T00:30:00.000Z');
  });

  it.runIf(available)('allows the check-in from two hours before the guest said', async () => {
    at('2026-11-01T09:00:00Z');
    const s = await stay({ arrival_time: '18:30' });
    at('2026-11-02T16:00:00Z');
    await expect(w.update('stays', s['id'], { status: 'in_house' })).rejects.toMatchObject({
      code: 'STATE_MOVE_REFUSED',
      details: { requires: 'time', bound: 'after', at: '2026-11-02T16:30:00.000Z', rowAt: '2026-11-02T18:30:00.000Z' },
    });
    at('2026-11-02T16:31:00Z');
    expect((await w.update('stays', s['id'], { status: 'in_house' })).count).toBe(1);
  });

  it.runIf(available)('makes the stay a no-show six hours after the time the guest said, by the clock', async () => {
    at('2026-11-01T09:00:00Z');
    const s = await stay({ arrival_time: '19:00' });
    // The job's minute and the write's own clock are the same moment.
    const tick = (when: string) => {
      at(when);
      return runTimedMoves({ meta: h.meta, manager: h.manager }, h.connectionId, {}, new Date(when));
    };
    await tick('2026-11-03T00:59:00Z');
    expect((await stayRow(s['id']))['status']).toBe('booked');
    const moved = await tick('2026-11-03T01:01:00Z');
    expect(moved).toMatchObject({ moved: 1 });
    expect((await stayRow(s['id']))['status']).toBe('no_show');
  });

  it.runIf(available)('reads no setting from a settings table holding two rows, and reads it again once it holds one', async () => {
    at('2026-11-01T09:00:00Z');
    const [second] = await h.rows(`select count(*) as n from ${h.real('settings')}`);
    expect(Number(second!['n'])).toBe(1);
    const extra = await w.create('settings', { arrive_from: '09:00' });
    const s = await stay({});
    // Neither 15:00 nor 09:00: which row is "the" settings row is anybody's guess, so the house's time is not known.
    expect(await expected(s['id'])).toBeNull();
    await h.rows(`delete from ${h.real('settings')} where id = ${String(extra['id'])}`);
    await w.update('stays', s['id'], { arrive: '2026-11-03' });
    expect(await expected(s['id'])).toBe('2026-11-03T15:00:00.000Z');
  });
});
