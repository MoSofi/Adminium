// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The nights of a stay where people read them: a guest's quote answers each
 * night with its rate and what was added to it (a new stay, and a change of
 * dates), and the desk reads a stored stay's nights through its own route —
 * one line for them all once the rates changed after it was priced. On every
 * engine.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminPasswordHash, ADMIN_PASSWORD, login } from './auth-helpers.js';
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
});
