// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A guest's change open only inside a window read from moments, and a guest's
 * move judged against the clock, through the whole public API on an installed
 * venue app: a refund until seven days before the show (or the show's own
 * refund deadline), and never for a show that takes none; a stay's
 * cancellation until 48 hours before its 15:00 arrival; a ticket's check-in
 * from half an hour before the doors and once only. The guest is told when a
 * window opens or when it closed, never anything about a row they cannot see.
 */
import { connectionTenantConfig } from '@adminium/meta';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { TEST_SECRET } from './helpers.js';
import { venueManifest } from './venue-moves.fixture.js';

type Writer = Awaited<ReturnType<typeof writerFor>>;

describe.each(LEGS)('public windows read from moments — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let served: Served;
  let w: Writer;

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, venueManifest({ timed: false }));
    await h.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', h.connectionId).execute();
    w = await writerFor(h, 'Europe/London');
    await w.create('settings', {});
    const views = createPublicViews(h.meta);
    const service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    const view = (await views.viewFor(h.connectionId))!;
    const idOf = (ref: string) => view.table(h.real(ref)).id;
    const settings = (column: string) => ({ table: idOf('settings'), column });
    const base = {
      methods: ['GET', 'PATCH'],
      pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
      auth: { role: 'anon' },
      rate_limit: { requests: 600, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
    };
    const endpoints = [
      {
        ref: 'refunds',
        definition: {
          ...base,
          path: '/refunds',
          source: idOf('orders'),
          select: ['id', 'status', 'event_id'],
          filters: [{ column: 'account', op: 'eq', value: 1 }],
          writable: ['status'],
          writable_values: { status: ['cancelled'] },
          writable_when: {
            status: ['paid'],
            event_id: {
              before: { column: 'refund_until', or: [{ via: 'event_id', column: 'starts_at', minus: { days: settings('refund_days') } }] },
              where: [{ column: 'refunds_on', eq: true }],
            },
          },
        },
      },
      {
        ref: 'stay_cancel',
        definition: {
          ...base,
          path: '/stay_cancel',
          source: idOf('stays'),
          select: ['id', 'status', 'arrive'],
          filters: [],
          writable: ['status'],
          writable_values: { status: ['cancelled'] },
          writable_when: { status: ['booked'], arrive: { before: { time: settings('arrive_from'), minus: { hours: settings('cancel_hours') } } } },
        },
      },
      {
        ref: 'door',
        definition: { ...base, path: '/door', source: idOf('tickets'), select: ['id', 'status'], filters: [], writable: ['status'], writable_values: { status: ['checked_in'] } },
      },
    ];
    for (const endpoint of endpoints) await service.saveEndpoint({ connectionId: h.connectionId, ref: endpoint.ref, origin: 'custom', definition: endpoint.definition });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h.connectionId,
      name: 'venue guests',
      access: endpoints.map((e) => ({ ref: e.ref, methods: ['GET', 'PATCH'] })),
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    served = await servePublic(h, key.id);
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
  };
  const patch = (ref: string, id: unknown, values: Record<string, unknown>) =>
    served.composed.app.inject({ method: 'PATCH', url: `/api/v1/public/records/${ref}/${String(id)}`, headers: served.headers(), payload: { values } });

  it.runIf(available)('asks for a refund until seven days before the show, or its own deadline, never for a show without refunds', async () => {
    const show = await w.create('events', { name: 'Show', starts_at: '2026-09-10T19:00:00Z', doors_at: '2026-09-10T18:30:00Z' });
    const order = await w.create('orders', { event_id: show['id'], email: 'mine@example.com', account: 1, pay: 'paid' });
    await w.update('orders', order['id'], { status: 'paid' });
    clock('2026-09-03T19:00:00Z');
    const late = await patch('refunds', order['id'], { status: 'cancelled' });
    expect(late.statusCode, late.body).toBe(409);
    expect(late.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE', params: { at: '2026-09-03T19:00:00.000Z' } } });
    // The show's own deadline, when set, is read first.
    await w.update('events', show['id'], { refund_until: '2026-09-09T12:00:00Z' });
    const inTime = await patch('refunds', order['id'], { status: 'cancelled' });
    expect(inTime.statusCode, inTime.body).toBe(200);

    const noRefunds = await w.create('events', { name: 'No refunds', starts_at: '2026-10-10T19:00:00Z', doors_at: '2026-10-10T18:30:00Z', refunds_on: false });
    const other = await w.create('orders', { event_id: noRefunds['id'], email: 'mine@example.com', account: 1, pay: 'paid' });
    await w.update('orders', other['id'], { status: 'paid' });
    const refused = await patch('refunds', other['id'], { status: 'cancelled' });
    expect(refused.statusCode, refused.body).toBe(400);
    expect(refused.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED' } });
    expect(JSON.stringify(refused.json())).not.toContain('refunds_on');

    // Another person's order: no such record, whatever its window says.
    const theirs = await w.create('orders', { event_id: show['id'], email: 'theirs@example.com', account: 2, pay: 'paid' });
    await w.update('orders', theirs['id'], { status: 'paid' });
    clock('2026-09-09T13:00:00Z');
    const hidden = await patch('refunds', theirs['id'], { status: 'cancelled' });
    expect(hidden.statusCode, hidden.body).toBe(404);
  });

  it.runIf(available)('changes a stay until 48 hours before its 15:00 arrival', async () => {
    const early = await w.create('stays', { arrive: '2026-08-10' });
    const late = await w.create('stays', { arrive: '2026-08-10' });
    clock('2026-08-08T13:59:00Z');
    expect((await patch('stay_cancel', early['id'], { status: 'cancelled' })).statusCode).toBe(200);
    clock('2026-08-08T14:00:00Z');
    const refused = await patch('stay_cancel', late['id'], { status: 'cancelled' });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_LATE', params: { at: '2026-08-08T14:00:00.000Z' } } });
  });

  it.runIf(available)('lets a guest scan in from half an hour before the doors, and once', async () => {
    const event = await w.create('events', { name: 'Door', starts_at: '2026-07-31T19:30:00Z', doors_at: '2026-07-31T19:00:00Z' });
    const order = await w.create('orders', { event_id: event['id'], email: 'door@example.com', pay: 'paid' });
    const ticket = await w.create('tickets', { order_id: order['id'], event_id: event['id'], valid_from: '2026-07-31T17:00:00Z', valid_to: '2026-08-01T03:00:00Z' });
    clock('2026-07-31T18:29:00Z');
    const early = await patch('door', ticket['id'], { status: 'checked_in' });
    expect(early.statusCode, early.body).toBe(409);
    expect(early.json()).toMatchObject({ error: { code: 'PUBLIC_TOO_EARLY', params: { at: '2026-07-31T18:30:00.000Z' } } });
    clock('2026-07-31T18:31:00Z');
    expect((await patch('door', ticket['id'], { status: 'checked_in' })).statusCode).toBe(200);
    const twice = await patch('door', ticket['id'], { status: 'checked_in' });
    expect(twice.statusCode, twice.body).toBe(400);
    expect(twice.json()).toMatchObject({ error: { code: 'PUBLIC_WRITE_REFUSED', params: { column: 'status', reason: 'unchanged' } } });
    expect(twice.body).not.toContain('Ivy');
  });
});
