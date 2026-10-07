// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT STOCK SAYS OF AN ITEM, WITH NOTHING WRITTEN.
 *
 * Staff ask the add-on about rows — here its own items — and it answers in
 * words: in, low or out, and for somebody who may read the stock tables the
 * exact figure, the batch that goes first and whether that batch expires
 * soon. Asked through the route a record's tab and an app's tiles ask.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { inDays, item, opening, place, pointOf } from './world.js';

const inventory = builtAddOn('inventory');
type Doc = Record<string, unknown>;

describe.each(LEGS)('the item words — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let served: Served;
  let cookie = '';
  // Not released yet: its deciding code runs only where the server is told to trust it by name.
  const trusted = process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
  let lidocaine: number;
  let shirt: number;
  let tote: number;
  const ask = async (ids: readonly number[]) => {
    const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/words/inventory/item?table=${encodeURIComponent('inventory:items')}&ids=${ids.join(',')}`, headers: { cookie } });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return (res.json() as { data: Doc[] }).data;
  };

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    const room = await place(w, 'Treatment room');
    lidocaine = await item(w, 'Lidocaine 1% ampoule', { tracks_batches: true });
    shirt = await item(w, 'T-shirt, blue, M');
    tote = await item(w, 'Canvas tote, natural');
    await opening(w, room, [
      { item_id: lidocaine, qty_typed: 14, unit_cost: 1.1, batch_code: 'LD118', expires_on: inDays(19) },
      { item_id: tote, qty_typed: 4, unit_cost: 3.1 },
      { item_id: shirt, qty_typed: 1, unit_cost: 7.4 },
    ]);
    await w.update('stock_points', (await pointOf(w, tote, room))['id'], { reorder_level: 10 });
    await w.create('uses', { item_id: shirt, qty: 1, place_id: room, kind: 'sold' });
    process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = 'inventory';
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const cookies = new Map<string, string>();
    const user = await usersRepo(w.h.meta).create({ email: 'max@stock.dev', name: 'max', passwordHash: await adminPasswordHash() });
    await rolesRepo(w.h.meta).assignToUser(user.id, (await rolesRepo(w.h.meta).findBySlug('inventory-manager'))!.id);
    const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: '10.4.0.1', payload: { email: 'max@stock.dev', password: ADMIN_PASSWORD } });
    cookies.set('max', sessionCookie(login.headers['set-cookie']));
    cookie = cookies.get('max')!;
    // A server loads its add-ons' code behind its start: until it has, it rightly says the add-on cannot answer.
    for (let tries = 0; tries < 100; tries += 1) {
      const res = await served.composed.app.inject({ method: 'GET', url: `/api/v1/words/inventory/item?table=${encodeURIComponent('inventory:items')}&ids=${String(tote)}`, headers: { cookie } });
      if (res.statusCode === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, 240_000);
  afterAll(async () => {
    if (trusted === undefined) delete process.env['ADMINIUM_ADD_ON_DEV_TRUST'];
    else process.env['ADMINIUM_ADD_ON_DEV_TRUST'] = trusted;
    if (!run) return;
    await served?.close();
    await w.h.close();
  });

  it.skipIf(!run)('answer for a stock item: exact, batch, expires, soon', async () => {
    const [said] = await ask([lidocaine]);
    expect(said).toMatchObject({ id: String(lidocaine), state: 'in', exact: '14', batch: 'LD118', soon: true });
    expect(String(said?.['expires'])).toBe(inDays(19));
  });

  it.skipIf(!run)('say low at or under the level, and out with nothing on the shelf', async () => {
    const said = await ask([tote, shirt]);
    expect(said.map((one) => [one['id'], one['state'], one['exact']])).toEqual([
      [String(tote), 'low', '4'],
      [String(shirt), 'out', '0'],
    ]);
  });
});
