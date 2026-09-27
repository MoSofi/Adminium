// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The desk links a booking to a person only when it picks one: the staff
 * route finds the person with an address, or makes one — the same
 * find-or-make a guest's create uses (trimmed, lower case, one person per
 * address) — and says which happened. On every engine.
 */
import { publicEndpointsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asUser } from './connections-helpers.js';
import { installInvoicing, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { dataRoutesOver, type DataRoutes } from './invoicing-routes.helpers.js';
import { shopManifest } from './person-fixture.js';

describe.each(LEGS)('the desk links a person by address — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let r: DataRoutes;
  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, shopManifest());
    await h.rows(`insert into ${h.real('customers')} (email, name) values ('lena@example.com', 'Lena')`);
    r = await dataRoutesOver(h, dialect);
    for (const row of await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)) {
      await publicEndpointsRepo(r.t.meta).create({ connectionId: r.connectionId, ref: row.ref, origin: row.origin, definition: row.definition, managedBy: row.managedBy });
    }
  }, 180_000);
  afterAll(async () => {
    if (!available) return;
    await r.close();
    await h.close();
  });

  const pick = (table: string, body: Record<string, unknown>) =>
    r.t.app.inject({ method: 'POST', url: `/api/v1/data/${r.connectionId}/${r.table(table)}/person`, headers: asUser(r.t.users.admin), payload: body });
  const people = async () => h.rows(`select id, email, name from ${h.real('customers')} order by id`);

  it.skipIf(!available)('finds the person with the address, however it is typed', async () => {
    const res = await pick('customers', { email: '  Lena@Example.COM ' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ data: { key: 1, found: true } });
  });

  it.skipIf(!available)('makes a new person when none has it, filled as the desk asks', async () => {
    const before = await people();
    const res = await pick('customers', { email: 'Walk.In@Example.com', fill: { name: 'Walk-in' } });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { key: unknown; found: boolean } };
    expect(body.data.found).toBe(false);
    const after = await people();
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ email: 'walk.in@example.com', name: 'Walk-in' });
    // Asked again, it is found.
    expect((await pick('customers', { email: 'walk.in@example.com' })).json()).toEqual({ data: { key: body.data.key, found: true } });
  });

  it.skipIf(!available)('refuses what is not an address, and a table nobody is found in by address', async () => {
    expect((await pick('customers', { email: 'nope' })).statusCode).toBe(422);
    const orders = await pick('orders', { email: 'lena@example.com' });
    expect(orders.statusCode).toBe(404);
  });

  it.skipIf(!available)('fills a new person only with what a guest\'s create fills one with: never its key, a stamp or another column', async () => {
    const before = await people();
    for (const fill of [{ forgotten_at: '2026-01-01T00:00:00Z' }, { id: '9999' }, { phone: '+44 7700 900999' }, { name: 'Ok', email: 'other@example.com' }]) {
      const res = await pick('customers', { email: 'filled@example.com', fill });
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.stringify(res.json())).toContain('not-fillable');
    }
    expect(await people()).toEqual(before);
  });

  it.skipIf(!available)('links nobody, and makes nobody, for an address kept on file in another case: sign-in would find two', async () => {
    // Kept as typed at the desk long ago, before the address was kept in lower case.
    await h.rows(`insert into ${h.real('customers')} (email, name) values ('Rae@Example.com', 'Rae')`);
    const res = await pick('customers', { email: 'rae@example.com' });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.stringify(res.json())).toContain('look-alike');
    expect(await h.rows(`select id from ${h.real('customers')} where lower(email) = 'rae@example.com'`)).toHaveLength(1);
  });

  it.skipIf(!available)('tells a desk that may only add people nothing: neither whether the address is on file nor whose key it is', async () => {
    await r.t.grantTable(r.t.roles.editor, r.connectionId, '*', { read: false, create: true, update: false, delete: false });
    const before = await people();
    for (const email of ['lena@example.com', 'someone-new@example.com']) {
      const res = await r.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${r.connectionId}/${r.table('customers')}/person`,
        headers: asUser(r.t.users.editor),
        payload: { email },
      });
      expect(res.statusCode, res.body).toBe(403);
    }
    expect(await people()).toEqual(before);
  });

  it.skipIf(!available)('needs the right to add people to the table: a desk that may only read makes nobody', async () => {
    await r.t.grantTable(r.t.roles.viewer, r.connectionId, '*', { read: true, create: false, update: false, delete: false });
    const read = await r.t.app.inject({ method: 'GET', url: `/api/v1/data/${r.connectionId}/${r.table('customers')}`, headers: asUser(r.t.users.viewer) });
    expect(read.statusCode, read.body).toBe(200);
    const before = await people();
    const res = await r.t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${r.connectionId}/${r.table('customers')}/person`,
      headers: asUser(r.t.users.viewer),
      payload: { email: 'viewer-typed@example.com', fill: { name: 'V' } },
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(await people()).toEqual(before);
  });
});
