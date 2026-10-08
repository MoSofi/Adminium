// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO SEES WHAT A THING COSTS.
 *
 * Inventory ships three roles. A clerk receives, moves and counts, and reads
 * no cost anywhere: not on a list, not on one record, not by asking for the
 * column by name. A viewer reads and changes nothing. Asked through the data
 * routes, signed in — the way the dashboard and the add-on's own screens ask.
 */
import { rolesRepo, usersRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, adminPasswordHash, sessionCookie } from '../../auth-helpers.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { servePublic, type Served } from '../../public-lane.helpers.js';
import { builtAddOn, installBuilt, writing, type Writing } from '../harness.js';
import { item, opening, place } from './world.js';

const inventory = builtAddOn('inventory');
type Doc = Record<string, unknown>;
interface Kit {
  connectionId: string;
  tables: Record<string, { id: string; can: Record<string, boolean>; unreadable: string[] }>;
}
/** What the manifest lets the clerk read of each table it limits. */
const limits = ((inventory?.manifest['roles'] as { key: string; limits?: Record<string, { readable?: string[] }> }[] | undefined) ?? []).find((role) => role.key === 'clerk')?.limits ?? {};
const MONEY = /cost|amount|value|total|price/;

/** Somebody new, signed in: their key, and their session kept by name. */
async function signIn(served: Served, meta: Writing['h']['meta'], name: string, cookies: Map<string, string>): Promise<string> {
  const user = await usersRepo(meta).create({ email: `${name}@stock.dev`, name, passwordHash: await adminPasswordHash() });
  const login = await served.composed.app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `10.3.0.${String(cookies.size + 1)}`, payload: { email: `${name}@stock.dev`, password: ADMIN_PASSWORD } });
  cookies.set(name, sessionCookie(login.headers['set-cookie']));
  return user.id;
}

describe.each(LEGS)('the three roles — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let w: Writing;
  let served: Served;
  const cookies = new Map<string, string>();
  const as = (who: string, method: string, url: string, payload?: unknown) => served.composed.app.inject({ method: method as 'GET', url, headers: { cookie: cookies.get(who)! }, ...(payload === undefined ? {} : { payload: payload as Doc }) });
  const kit = async (who: string) => (await as(who, 'GET', '/api/v1/add-ons/inventory/kit')).json() as Kit;
  const data = (at: Kit, ref: string) => `/api/v1/data/${at.connectionId}/${encodeURIComponent(at.tables[ref]!.id)}`;

  beforeAll(async () => {
    if (!run) return;
    w = await writing(await installBuilt(dialect, inventory));
    const floor = await place(w, 'Shop floor');
    const tote = await item(w, 'Canvas tote, natural');
    await opening(w, floor, [{ item_id: tote, qty_typed: 4, unit_cost: 3.1 }]);
    served = await servePublic(w.h as never, null, { ADMINIUM_DATA_DIR: w.h.dataDir });
    const roles = rolesRepo(w.h.meta);
    for (const [name, slug] of [['max', 'inventory-manager'], ['cal', 'inventory-clerk'], ['vera', 'inventory-viewer']] as const) {
      const id = await signIn(served, w.h.meta, name, cookies);
      await roles.assignToUser(id, (await roles.findBySlug(slug))!.id);
    }
  }, 240_000);
  afterAll(async () => {
    if (!run) return;
    await served?.close();
    await w.h.close();
  });

  it.skipIf(!run)('a clerk\'s rows carry no cost, on any table the role limits', async () => {
    const at = await kit('cal');
    expect(Object.keys(limits).length).toBeGreaterThan(3);
    for (const [ref, limit] of Object.entries(limits)) {
      if (limit.readable === undefined || at.tables[ref] === undefined) continue;
      const res = await as('cal', 'GET', data(at, ref));
      expect(res.statusCode, `${ref}: ${res.body.slice(0, 200)}`).toBe(200);
      for (const row of (res.json() as { data: Doc[] }).data) {
        for (const column of Object.keys(row)) expect(column === 'id' || limit.readable.includes(column), `${ref}.${column}`).toBe(true);
      }
      // Nothing the clerk may read is money.
      // (Two yes/no flags say a cost was guessed; they are no figure.)
      expect(limit.readable.filter((column) => MONEY.test(column) && column !== 'cost_guessed'), ref).toEqual([]);
    }
    // And the manager, asked the same way, does read it.
    const boss = await kit('max');
    const [stocked] = ((await as('max', 'GET', data(boss, 'items'))).json() as { data: Doc[] }).data;
    expect(Number(stocked?.['cost_avg'])).toBe(3.1);
  });

  it.skipIf(!run)('a clerk who asks for a cost by name is refused it, and the kit says which columns are closed', async () => {
    const at = await kit('cal');
    expect(at.tables['items']!.unreadable).toEqual(expect.arrayContaining(['cost_avg', 'value']));
    const res = await as('cal', 'GET', `${data(at, 'items')}?select=id,cost_avg`);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string; details: Doc } }).error).toMatchObject({ code: 'COLUMN_FORBIDDEN', details: { column: 'cost_avg' } });
  });

  it.skipIf(!run)('a card that adds up a cost answers the manager and is refused the clerk: no total leaks through a widget', async () => {
    const at = await kit('max');
    const card = (aggregations: unknown[]) => ({ descriptor: { kind: 'table-query', connectionId: at.connectionId, source: { name: 'inventory_stock_points', type: 'table' }, shape: 'metric+delta', aggregations } });
    const value = card([{ fn: 'sum', column: 'value', alias: 'value' }]);
    const boss = await as('max', 'POST', '/api/v1/widget-data/query', value);
    expect(boss.statusCode, boss.body.slice(0, 300)).toBe(200);
    expect(Number((boss.json() as { result: { value: unknown } }).result.value)).toBeCloseTo(12.4, 2);
    const clerk = await as('cal', 'POST', '/api/v1/widget-data/query', value);
    expect(clerk.statusCode, clerk.body.slice(0, 300)).toBeGreaterThanOrEqual(400);
    expect(clerk.body).not.toContain('12.4');
    // A count of the same rows is the clerk's to read: it is no cost.
    const counted = await as('cal', 'POST', '/api/v1/widget-data/query', card([{ fn: 'count', alias: 'points' }]));
    expect(counted.statusCode, counted.body.slice(0, 300)).toBe(200);
    expect(Number((counted.json() as { result: { value: unknown } }).result.value)).toBe(1);
  });

  it.skipIf(!run)('a clerk may receive and count, and may not set things up; a viewer changes nothing', async () => {
    const clerk = await kit('cal');
    expect(clerk.tables['receipts']!.can).toMatchObject({ read: true, create: true });
    expect(clerk.tables['count_marks']!.can).toMatchObject({ create: true });
    expect(clerk.tables['places']!.can).toMatchObject({ create: false, update: false });
    const viewer = await kit('vera');
    for (const [ref, table] of Object.entries(viewer.tables)) expect([table.can['create'], table.can['update'], table.can['delete']], ref).toEqual([false, false, false]);
    const refused = await as('vera', 'POST', data(viewer, 'places'), { values: { name: 'Nowhere' } });
    expect(refused.statusCode).toBe(403);
  });
});
