// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The nights of a stay where people read them: a guest's quote answers each
 * night with its rate and what was added to it (a new stay, and a change of
 * dates), and the desk reads a stored stay's nights through its own route —
 * one line for them all once the rates changed after it was priced. On every
 * engine.
 */
import { connectionTenantConfig, overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { createEndpointService } from '../src/public-api/endpoint-service.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { adminPasswordHash, ADMIN_PASSWORD, login } from './auth-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { installInvoicing, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';
import { servePublic, type Served } from './public-lane.helpers.js';
import { seedWren, wrenManifest } from './wren-house-fixture.js';

function publicWren(): Record<string, unknown> {
  const manifest = wrenManifest();
  manifest['frontends'] = [
    { side: 'staff', kind: 'spa', entry: 'index.html' },
    { side: 'customer', kind: 'spa', entry: 'index.html' },
  ];
  manifest['publicAccess'] = [
    { table: 'room_types', methods: ['GET'], select: ['id', 'name', 'base_rate'] },
    {
      table: 'stays',
      methods: ['POST'],
      select: ['nights', 'room_total', 'total'],
      writable: ['first_name', 'last_name', 'room_type_id', 'arrive', 'depart', 'guests'],
      requires: ['first_name'],
      dryRun: true,
    },
  ];
  return manifest;
}

describe.each(LEGS)('the nights of a stay, quoted and at the desk — %s', (dialect, available) => {
  let h: (InvoicingHarness & { reply: Record<string, unknown> }) | undefined;
  let w: Awaited<ReturnType<typeof writerFor>>;
  let seed: Awaited<ReturnType<typeof seedWren>>;
  let served: Served;
  let cookie = '';
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, publicWren());
    w = await writerFor(h, 'Europe/London');
    seed = await seedWren((ref, values) => w.create(ref, values));
    served = await servePublic(h, (h.reply['publicAccess'] as { keyId: string }).keyId);
    const desk = await usersRepo(h.meta).create({ email: 'desk@wren.example', name: 'Desk', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h.meta).assignToUser(desk.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    cookie = (await login(served.composed.app as never, 'desk@wren.example', ADMIN_PASSWORD)).cookie ?? '';
  }, 180_000);
  afterAll(async () => {
    await served?.close();
    await h?.close();
  });

  const nightly = async (id: unknown, query = '') =>
    served.composed.app.inject({
      method: 'GET',
      url: `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('stays').table.id)}/${String(id)}/nightly${query}`,
      headers: { cookie },
    });

  it.runIf(available)("answers a guest's quote with each night, its rate and what was added", async () => {
    const res = await served.post('/records/wren_stays/dry-run', {
      values: { first_name: 'Mia', room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-02', guests: 2 },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: Record<string, unknown>; nights: unknown };
    expect(Number(body.data['room_total'])).toBe(370);
    expect(body.nights).toEqual([
      { date: '2026-07-31', rate: '175.00', tags: ['Weekend'] },
      { date: '2026-08-01', rate: '195.00', tags: ['Weekend', 'August'] },
    ]);
  });

  it.runIf(available)("answers a guest's quote of new dates with the nights they would be, and keeps nothing", async () => {
    const stay = await w.create('stays', { first_name: 'Ava', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    // An operator's own change entry on stays, trying new dates.
    const views = createPublicViews(h!.meta);
    const service = createEndpointService({ meta: h!.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h!.meta, cid)) ?? undefined });
    await service.saveEndpoint({
      connectionId: h!.connectionId,
      ref: 'stay_dates',
      origin: 'custom',
      definition: {
        path: '/stay_dates',
        source: w.targetOf('stays').table.id,
        methods: ['PATCH'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        select: ['id', 'room_total'],
        writable: ['depart'],
        dry_run: true,
      } as never,
    });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h!.connectionId,
      name: 'operator stay dates',
      access: [{ ref: 'stay_dates', methods: ['PATCH'] as never }],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    await served.useKey(key.id);
    try {
      const res = await served.post(`/records/stay_dates/${String(stay['id'])}/dry-run`, { values: { depart: '2026-08-08' } });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Record<string, unknown>; nights: { date: string; rate: string }[] };
      // Mon 3 – Sat 8 August: four August nights and an August Friday.
      expect(body.nights.map((night) => [night.date, night.rate])).toEqual([
        ['2026-08-03', '170.00'],
        ['2026-08-04', '170.00'],
        ['2026-08-05', '170.00'],
        ['2026-08-06', '170.00'],
        ['2026-08-07', '195.00'],
      ]);
      expect(Number(body.data['room_total'])).toBe(875);
      expect(Number((await h!.rows(`SELECT room_total FROM ${h!.real('stays')} WHERE id = ${String(stay['id'])}`))[0]!['room_total'])).toBe(340);
    } finally {
      await served.useKey((h!.reply['publicAccess'] as { keyId: string }).keyId);
    }
  });

  it.runIf(available)('keeps the nights from a quote whose entry does not show the price they make up', async () => {
    const stay = await w.create('stays', { first_name: 'Noa', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const views = createPublicViews(h!.meta);
    const service = createEndpointService({ meta: h!.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h!.meta, cid)) ?? undefined });
    // An entry that shows a stay's nights and total, never its room price: the nights are that price, night by night.
    await service.saveEndpoint({
      connectionId: h!.connectionId,
      ref: 'stay_totals',
      origin: 'custom',
      definition: {
        path: '/stay_totals',
        source: w.targetOf('stays').table.id,
        methods: ['POST', 'PATCH'],
        filters: [],
        pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
        auth: { role: 'anon' },
        rate_limit: { requests: 60, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        select: ['id', 'nights', 'total'],
        writable: ['first_name', 'room_type_id', 'arrive', 'depart', 'guests'],
        dry_run: true,
      } as never,
    });
    const secret = generatePublishableKey('browser');
    const { key } = await service.createKey({
      connectionId: h!.connectionId,
      name: 'stay totals',
      // The room types it books are the app's own entry's.
      access: [{ ref: 'stay_totals', methods: ['POST', 'PATCH'] as never }, { ref: 'wren_room_types', methods: ['GET'] as never }],
      secret: { prefix: secret.prefix, tokenHash: secret.tokenHash, tokenEncrypted: sealPublishableKey(dsnCryptoFromSecret(TEST_SECRET), secret.token) },
      origins: [],
      kind: 'browser',
    });
    await served.useKey(key.id);
    try {
      const created = await served.post('/records/stay_totals/dry-run', {
        values: { first_name: 'Mia', room_type_id: seed.garden['id'], arrive: '2026-07-31', depart: '2026-08-02', guests: 2 },
      });
      expect(created.statusCode, created.body).toBe(200);
      const quote = created.json() as { data: Record<string, unknown>; nights?: unknown };
      expect(Number(quote.data['nights'])).toBe(2);
      expect(quote.data['room_total']).toBeUndefined();
      expect(quote.nights).toBeUndefined();
      const changed = await served.post(`/records/stay_totals/${String(stay['id'])}/dry-run`, { values: { depart: '2026-08-08' } });
      expect(changed.statusCode, changed.body).toBe(200);
      const moved = changed.json() as { data: Record<string, unknown>; nights?: unknown };
      expect(Number(moved.data['nights'])).toBe(5);
      expect(moved.nights).toBeUndefined();
    } finally {
      await served.useKey((h!.reply['publicAccess'] as { keyId: string }).keyId);
    }
  });

  it.runIf(available)("answers the desk's quote of a booking with its nights too", async () => {
    const res = await served.composed.app.inject({
      method: 'POST',
      url: `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('stays').table.id)}/dry-run`,
      headers: { cookie },
      payload: { values: { first_name: 'Desk', room_type_id: seed.loft['id'], arrive: '2026-07-23', depart: '2026-07-25', guests: 2 } },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { nights: unknown }).nights).toEqual([
      { date: '2026-07-23', rate: '215.00', tags: [] },
      { date: '2026-07-24', rate: '240.00', tags: ['Weekend'] },
    ]);
  });

  it.runIf(available)("shows the desk a stored stay's nights, and one line once the rates changed", async () => {
    const stay = await w.create('stays', { first_name: 'Kai', room_type_id: seed.garden['id'], arrive: '2026-08-03', depart: '2026-08-05', guests: 1 });
    const fresh = await nightly(stay['id']);
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect(fresh.json()).toEqual({
      data: {
        column: 'room_total',
        nights: [
          { date: '2026-08-03', rate: '170.00', base: '150.00', tags: ['August'], qty: '1', amount: '170.00' },
          { date: '2026-08-04', rate: '170.00', base: '150.00', tags: ['August'], qty: '1', amount: '170.00' },
        ],
        total: '340.00',
        stale: false,
      },
    });
    await w.update('rate_rules', seed.august['id'], { amount: '30.00' });
    try {
      const stale = await nightly(stay['id']);
      expect(stale.json()).toEqual({
        data: { column: 'room_total', nights: [{ date: '2026-08-03', rate: null, base: null, tags: [], qty: '2', amount: '340.00' }], total: '340.00', stale: true },
      });
    } finally {
      await w.update('rate_rules', seed.august['id'], { amount: '20.00' });
    }
    // Asked for a column that is not priced by the night, or on a table that prices nothing: none.
    expect((await nightly(stay['id'], '?column=total')).statusCode).toBe(404);
    const other = await served.composed.app.inject({
      method: 'GET',
      url: `/api/v1/data/${h!.connectionId}/${encodeURIComponent(w.targetOf('extras').table.id)}/1/nightly`,
      headers: { cookie },
    });
    expect(other.statusCode).toBe(404);
    expect((await nightly(999_999)).statusCode).toBe(404);
  });

  // Last: it marks the room price personal for the rest of the file.
  it.runIf(available)("keeps the nights from a desk's quote when the desk may not read the price they make up", async () => {
    const stays = w.targetOf('stays').table.id;
    await overridesRepo(h!.meta).create({ connectionId: h!.connectionId, op: 'column.pii', tableName: stays, columnName: 'room_total', value: { masked: true, kind: 'other' } as never });
    const role = await rolesRepo(h!.meta).create({ slug: 'front-desk', name: 'Front desk' });
    await permissionsRepo(h!.meta).grant(role.id, 'table', `${h!.connectionId}/${stays}`, { read: true, create: true, update: false, delete: false, export: false, import: false });
    const user = await usersRepo(h!.meta).create({ email: 'front@wren.example', name: 'Front', passwordHash: await adminPasswordHash(), status: 'active' });
    await rolesRepo(h!.meta).assignToUser(user.id, role.id);
    const front = (await login(served.composed.app as never, 'front@wren.example', ADMIN_PASSWORD)).cookie ?? '';
    const quote = (as: string) =>
      served.composed.app.inject({
        method: 'POST',
        url: `/api/v1/data/${h!.connectionId}/${encodeURIComponent(stays)}/dry-run`,
        headers: { cookie: as },
        payload: { values: { first_name: 'Desk', room_type_id: seed.loft['id'], arrive: '2026-07-23', depart: '2026-07-25', guests: 2 } },
      });
    const masked = await quote(front);
    expect(masked.statusCode, masked.body).toBe(200);
    const body = masked.json() as { data: Record<string, unknown>; nights?: unknown };
    expect(body.data['room_total']).toBeNull();
    expect(body.nights).toBeUndefined();
    // A desk that may read it is shown them.
    expect(((await quote(cookie)).json() as { nights?: unknown[] }).nights).toHaveLength(2);
  });
});
