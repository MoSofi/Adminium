// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The moves Adminium makes by itself once a moment has passed, on a venue app
 * installed for real on every engine, the clock fixed: a held order expires
 * at its `held_until` and is audited as a timed move; a transfer not paid by
 * its deadline turns overdue and, a day's grace later, released with its
 * reason written, which queues the buyer's email; a waitlist offer lapses
 * after its twelve hours; a stay not arrived by the next morning at the
 * no-show time is a no-show (across the night the clocks go back); a pickup
 * not collected by the day's closing — or by midnight on a closed day — is not
 * collected. The oldest due move first, a limit a minute, a refused row left
 * alone without keeping the others waiting, and never a row moved twice.
 */
import { auditRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { runTimedMoves, type TimedMovesDeps } from '../src/states/timed-moves.js';
import type { WriteContext } from '../src/crud/write-service.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

const iso = (value: unknown) => new Date(value instanceof Date ? value : String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}`).toISOString();

describe.each(LEGS)('timed moves — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let served: Served;
  let w: Writer;
  let deps: TimedMovesDeps;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ outbox: true }));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', h.connectionId).execute();
    served = await servePublic(h, null);
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    deps = { meta: h.meta, manager: h.manager, app: served.composed.app };
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await served.close();
    await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
    return new Date(when);
  };
  const tick = (when: string, extra: Partial<TimedMovesDeps> = {}, left = {}) => runTimedMoves({ ...deps, ...extra }, h.connectionId, left, clock(when));
  const statusOf = async (ref: string, id: unknown) => (await h.rows(`select status from ${h.real(ref)} where id = ${String(id)}`))[0]!['status'];
  const event = (name: string, starts = '2026-08-20T19:00:00Z') => w.create('events', { name, starts_at: starts, doors_at: starts });

  it.runIf(available)('expires a held order at its held_until, audited as a timed move', async () => {
    const show = await event('Hold');
    clock('2026-07-28T08:50:00Z');
    const order = await w.create('orders', { event_id: show['id'], email: 'hold@example.com' });
    expect(iso(order['held_until'])).toBe('2026-07-28T09:00:00.000Z');
    await tick('2026-07-28T08:59:59Z');
    expect(await statusOf('orders', order['id'])).toBe('held');
    const moved = await tick('2026-07-28T09:00:30Z');
    expect(moved.moved).toBeGreaterThanOrEqual(1);
    expect(await statusOf('orders', order['id'])).toBe('expired');
    const audit = await auditRepo(h.meta).list({ limit: 200 });
    const entry = audit.filter((e) => e.action === 'record.update' && e.entity?.table === w.targetOf('orders').table.id && JSON.stringify(e.entity?.pk) === JSON.stringify({ id: order['id'] }));
    expect(entry).toHaveLength(1);
    expect(entry[0]).toMatchObject({ actorKind: 'system', actorLabel: 'Timed move' });
  });

  it.runIf(available)('turns an unpaid transfer overdue at its deadline, and releases it a day later with its reason, mailing the buyer', async () => {
    const show = await event('Transfer', '2026-09-20T19:00:00Z');
    clock('2026-07-27T10:00:00Z');
    const order = await w.create('orders', { event_id: show['id'], email: 'transfer@example.com' });
    await w.update('orders', order['id'], { status: 'awaiting_transfer' });
    // Five days on at 18:00 London: Sat 1 Aug, 17:00Z.
    await tick('2026-08-01T16:59:00Z');
    expect(await statusOf('orders', order['id'])).toBe('awaiting_transfer');
    await tick('2026-08-01T17:00:10Z');
    expect(await statusOf('orders', order['id'])).toBe('overdue');
    await tick('2026-08-02T16:59:00Z');
    expect(await statusOf('orders', order['id'])).toBe('overdue');
    await tick('2026-08-02T17:00:10Z');
    const [row] = await h.rows(`select status, cancel_code from ${h.real('orders')} where id = ${String(order['id'])}`);
    expect(row).toMatchObject({ status: 'released', cancel_code: 'unpaid' });
    const mail = await h.rows(`select kind, to_address from ${h.real('messages')} where order_id = ${String(order['id'])}`);
    expect(mail).toEqual([{ kind: 'released', to_address: 'transfer@example.com' }]);
  });

  it.runIf(available)('lets a waitlist offer lapse after its twelve hours', async () => {
    const show = await event('Waitlist');
    clock('2026-07-27T10:00:00Z');
    const entry = await w.create('waitlist', { event_id: show['id'], email: 'wait@example.com' });
    await w.update('waitlist', entry['id'], { status: 'offered' });
    await tick('2026-07-27T21:59:00Z');
    expect(await statusOf('waitlist', entry['id'])).toBe('offered');
    await tick('2026-07-27T22:00:05Z');
    expect(await statusOf('waitlist', entry['id'])).toBe('missed');
  });

  it.runIf(available)('makes a stay a no-show at 10:00 the next day, across the night the clocks go back', async () => {
    clock('2026-10-20T10:00:00Z');
    const stay = await w.create('stays', { arrive: '2026-10-24' });
    // 10:00 on Sun 25 Oct 2026 in London is GMT again: 10:00Z, not 09:00Z.
    await tick('2026-10-25T09:30:00Z');
    expect(await statusOf('stays', stay['id'])).toBe('booked');
    await tick('2026-10-25T10:00:30Z');
    expect(await statusOf('stays', stay['id'])).toBe('no_show');
  });

  it.runIf(available)("marks a pickup not collected at the day's closing, or at midnight on a closed day", async () => {
    await w.create('hours', { weekday: 'fri', open: true, opens: '11:00', closes: '21:00' });
    await w.create('hours', { weekday: 'mon', open: false });
    const friday = await w.create('pickups', { pickup_at: '2026-07-31T11:00:00Z' });
    const monday = await w.create('pickups', { pickup_at: '2026-08-03T11:00:00Z' });
    // Fri 21:00 London is 20:00Z.
    await tick('2026-07-31T19:59:00Z');
    expect(await statusOf('pickups', friday['id'])).toBe('ready');
    await tick('2026-07-31T20:00:10Z');
    expect(await statusOf('pickups', friday['id'])).toBe('not_collected');
    await tick('2026-08-03T22:59:00Z');
    expect(await statusOf('pickups', monday['id'])).toBe('ready');
    await tick('2026-08-03T23:00:10Z');
    expect(await statusOf('pickups', monday['id'])).toBe('not_collected');
  });

  it.runIf(available)('lets the timed move alone past the role it is kept for', async () => {
    const pickup = await w.create('pickups', { pickup_at: '2027-07-30T11:00:00Z' });
    const system: WriteContext = { origin: 'automation', hops: 0, actor: { kind: 'system', id: null, label: 'Rule' }, request: null };
    await expect(w.update('pickups', pickup['id'], { status: 'not_collected' }, system)).rejects.toMatchObject({ code: 'STATE_MOVE_REFUSED', details: { from: 'ready', to: 'not_collected', roles: [expect.stringContaining('manager')] } });
  });

  it.runIf(available)('moves the longest due first, a limit a minute, and leaves a refused row alone without keeping the others waiting', async () => {
    const show = await event('Many');
    clock('2026-11-02T08:00:00Z');
    const ids: unknown[] = [];
    for (let i = 0; i < 5; i += 1) {
      const entry = await w.create('waitlist', { event_id: show['id'], email: `m${String(i)}@example.com`, blocked: i < 2 });
      vi.setSystemTime(new Date(`2026-11-02T08:0${String(i)}:00Z`));
      await w.update('waitlist', entry['id'], { status: 'offered' });
      ids.push(entry['id']);
    }
    // Two a minute: the two oldest are refused (blocked), and are left alone.
    const first = await tick('2026-11-02T20:30:00Z', { perTick: 2 });
    expect(first).toMatchObject({ moved: 0, refused: 2 });
    expect(Object.keys(first.left)).toHaveLength(2);
    const second = await tick('2026-11-02T20:31:00Z', { perTick: 2 }, first.left);
    expect(second.moved).toBe(2);
    expect([await statusOf('waitlist', ids[2]), await statusOf('waitlist', ids[3]), await statusOf('waitlist', ids[4])]).toEqual(['missed', 'missed', 'offered']);
    const third = await tick('2026-11-02T20:32:00Z', { perTick: 2 }, second.left);
    expect(third.moved).toBe(1);
    expect(await statusOf('waitlist', ids[0])).toBe('offered');
  });

  it.runIf(available)('never moves a row twice when two runners meet', async () => {
    const show = await event('Twice');
    clock('2026-12-01T10:00:00Z');
    const orders = [];
    for (let i = 0; i < 4; i += 1) orders.push(await w.create('orders', { event_id: show['id'], email: `t${String(i)}@example.com` }));
    const now = clock('2026-12-01T10:11:00Z');
    const [a, b] = await Promise.all([runTimedMoves(deps, h.connectionId, {}, now), runTimedMoves(deps, h.connectionId, {}, now)]);
    expect(a.moved + b.moved).toBe(4);
    const audit = await auditRepo(h.meta).list({ limit: 500 });
    for (const order of orders) {
      expect(audit.filter((e) => e.action === 'record.update' && JSON.stringify(e.entity?.pk) === JSON.stringify({ id: order['id'] }) && e.entity?.table === w.targetOf('orders').table.id)).toHaveLength(1);
    }
  });
});
