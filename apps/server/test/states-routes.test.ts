// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Moves that wait for things, through the dashboard's data routes on every
 * engine: a door scan made offline and sent later carries the time it was
 * made (up to six hours back, never ahead, kept in the audit row); a bulk
 * move over a row already in the state is refused naming it; a stay checked
 * in turns its room occupied, and the room's change is audited as the same
 * person's.
 */
import { auditRepo } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

describe.each(LEGS)('moves through the data routes — %s', (dialect, available) => {
  let h: InvoicingHarness;
  let routes: DataRoutes;
  let n = 0;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ timed: false }));
    routes = await dataRoutesOver(h, dialect);
    await routes.t.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' } as never).where('id', '=', routes.connectionId).execute();
    const w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await routes.close();
    await h.close();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const clock = (when: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(when));
  };
  const made = async (ref: string, values: Record<string, unknown>) => {
    const res = await routes.post(ref, { values });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: Record<string, unknown> }).data;
  };
  async function ticket() {
    n += 1;
    const event = await made('events', { name: `Gig ${String(n)}`, starts_at: '2026-07-31T19:30:00Z', doors_at: '2026-07-31T19:00:00Z' });
    const order = await made('orders', { event_id: event['id'], email: `g${String(n)}@example.com`, pay: 'paid' });
    return made('tickets', { order_id: order['id'], event_id: event['id'], valid_from: '2026-07-31T17:00:00Z', valid_to: '2026-07-31T22:30:00Z' });
  }

  it.runIf(available)('takes an offline scan at the time it was made, and keeps that time in the audit row', async () => {
    const t = await ticket();
    // Scanned at 23:20 on the door's phone, sent at 23:40 once back online: its day had ended at 23:30.
    clock('2026-07-31T22:40:00Z');
    const late = await routes.patch('tickets', t['id'], { values: { status: 'checked_in', door: 'Door 2' } });
    expect(late.statusCode, late.body).toBe(409);
    const offline = await routes.patch('tickets', t['id'], { values: { status: 'checked_in', door: 'Door 2' }, occurredAt: '2026-07-31T22:20:00Z' });
    expect(offline.statusCode, offline.body).toBe(200);
    const [row] = await h.rows(`select checked_in_at from ${h.real('tickets')} where id = ${String(t['id'])}`);
    expect(new Date(row!['checked_in_at'] as string).toISOString()).toBe('2026-07-31T22:20:00.000Z');
    const audit = await auditRepo(routes.t.meta).list({ category: 'data', limit: 20 });
    expect(audit.some((entry) => (entry.changes as { occurredAt?: string } | null)?.occurredAt === '2026-07-31T22:20:00.000Z')).toBe(true);
    // Never more than six hours back, never ahead.
    const t2 = await ticket();
    for (const occurredAt of ['2026-07-31T16:39:00Z', '2026-07-31T22:42:00Z']) {
      const refused = await routes.patch('tickets', t2['id'], { values: { status: 'checked_in' }, occurredAt });
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', details: { fields: { occurredAt: { code: 'out-of-range' } } } } });
    }
    // A check-in record made offline is judged at the scan's time too.
    const record = await routes.post('check_ins', { values: { ticket_id: t2['id'], day: '2026-07-31' }, occurredAt: '2026-07-31T22:10:00Z' });
    expect(record.statusCode, record.body).toBe(201);
  });

  it.runIf(available)('refuses a bulk move over a row already in the state, naming it', async () => {
    const a = await ticket();
    const b = await ticket();
    clock('2026-07-31T18:45:00Z');
    expect((await routes.patch('tickets', b['id'], { values: { status: 'checked_in' } })).statusCode).toBe(200);
    const bulk = await routes.t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${routes.connectionId}/${routes.table('tickets')}/bulk`,
      headers: { ...(await import('./connections-helpers.js')).asUser(routes.t.users.admin) },
      payload: { action: 'update', ids: [a['id'], b['id']], values: { status: 'checked_in' } },
    });
    expect(bulk.statusCode, bulk.body).toBe(409);
    expect(bulk.json()).toMatchObject({ error: { code: 'STATE_UNCHANGED', details: { id: b['id'] } } });
    const [row] = await h.rows(`select status from ${h.real('tickets')} where id = ${String(a['id'])}`);
    expect(row!['status']).toBe('valid');
  });

  it.runIf(available)("turns the room occupied with the stay, audited as the same person's change", async () => {
    const room = await made('rooms', { number: `R${String((n += 1))}` });
    const stay = await made('stays', { room_id: room['id'], arrive: '2026-08-10' });
    const res = await routes.patch('stays', stay['id'], { values: { status: 'in_house' } });
    expect(res.statusCode, res.body).toBe(200);
    const [after] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
    expect(after!['status']).toBe('occupied');
    const audit = await auditRepo(routes.t.meta).list({ category: 'data', limit: 50 });
    const roomEntry = audit.find((entry) => entry.entity?.table === routes.table('rooms') && entry.action === 'record.update');
    expect(roomEntry).toBeDefined();
    expect(roomEntry!.actorLabel).toBe(audit.find((entry) => entry.entity?.table === routes.table('stays') && entry.action === 'record.update')!.actorLabel);
  });

  it.runIf(available)('saves an order with its checked-in ticket sent back whole, as the form sends it', async () => {
    const t = await ticket();
    clock('2026-07-31T18:45:00Z');
    expect((await routes.patch('tickets', t['id'], { values: { status: 'checked_in', door: 'Door 1' } })).statusCode).toBe(200);
    const [was] = await h.rows(`select checked_in_at from ${h.real('tickets')} where id = ${String(t['id'])}`);
    const saved = await routes.patch('orders', t['order_id'], {
      values: { email: `again${String(n)}@example.com` },
      children: { [routes.relation('tickets', 'orders')]: [{ key: { id: t['id'] }, values: { status: 'checked_in', door: 'Door 1', holder_email: 'holder@example.com' } }] },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const [row] = await h.rows(`select status, holder_email, checked_in_at from ${h.real('tickets')} where id = ${String(t['id'])}`);
    expect(row).toMatchObject({ status: 'checked_in', holder_email: 'holder@example.com', checked_in_at: was!['checked_in_at'] });
  });

  it.runIf(available)("announces the rows a parent form's child rows moved too", async () => {
    const event = await made('events', { name: `Festival ${String((n += 1))}`, starts_at: '2026-08-10T19:30:00Z', doors_at: '2026-08-10T19:00:00Z' });
    const room = await made('rooms', { number: `F${String(n)}` });
    const stay = await made('stays', { room_id: room['id'], event_id: event['id'], arrive: '2026-08-10' });
    const saved = await routes.patch('events', event['id'], { values: {}, children: { [routes.relation('stays', 'events')]: [{ key: { id: stay['id'] }, values: { status: 'in_house' } }] } });
    expect(saved.statusCode, saved.body).toBe(200);
    const [after] = await h.rows(`select status from ${h.real('rooms')} where id = ${String(room['id'])}`);
    expect(after!['status']).toBe('occupied');
    const audit = await auditRepo(routes.t.meta).list({ category: 'data', limit: 100 });
    expect(audit.filter((entry) => entry.entity?.table === routes.table('rooms') && entry.action === 'record.update' && JSON.stringify(entry.entity?.pk) === JSON.stringify({ id: room['id'] }))).toHaveLength(1);
  });
});
