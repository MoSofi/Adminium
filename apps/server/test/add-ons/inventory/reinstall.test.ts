// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY REMOVED WITH ITS TABLES KEPT, THEN INSTALLED AGAIN.
 *
 * The tables are found and taken as they are, every row in place. The list of
 * the sample's rows is one of the things kept, and is taken back too: the
 * sample is still the sample afterwards — it is not offered a second time
 * over itself, and it can still be removed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleOwner } from '../../../src/apps/sample-data.js';
import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, type Installed } from '../harness.js';
import { n } from './world.js';

const inventory = builtAddOn('inventory');

describe.each(LEGS)('Inventory installed again over the tables it kept — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let i: Installed;
  let total: number;
  const service = () => createSampleDataService(i.h.sampleData);
  const owner = async () => (await findSampleOwner(i.h.meta, 'inventory', 'add-on'))!;
  const rowsIn = async (ref: string) => n((await i.h.rows(`select count(*) as c from ${i.real(ref)}`))[0]!['c']);
  const TABLES = ['items', 'places', 'units', 'reasons', 'settings', 'stock_points', 'movements', 'purchase_orders', 'postings'];
  let before: number[];

  beforeAll(async () => {
    if (!run) return;
    i = await installBuilt(dialect, inventory);
    const added = await service().add(await owner(), { locale: 'en-US', userId: i.h.owner.id, userLabel: 'owner@test' });
    total = Object.values(added.counts).reduce((sum, count) => sum + count, 0);
    before = await Promise.all(TABLES.map(rowsIn));
    // Removed, keeping the tables; the package goes with it, so it is brought again before the second install.
    const removed = await i.h.inject({ method: 'DELETE', url: '/add-ons/inventory', payload: {} });
    if (removed.statusCode !== 200) throw new Error(`removing answered ${String(removed.statusCode)}: ${removed.body.slice(0, 600)}`);
    expect(removed.json()).toMatchObject({ tablesKept: true });
    await i.h.stageAddOn(inventory.manifest, { bundled: true, files: inventory.files });
    const again = await i.h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'inventory', version: inventory.version, attachTo: [] } });
    if (again.statusCode !== 200) throw new Error(`installing again answered ${String(again.statusCode)}: ${again.body.slice(0, 900)}`);
  }, 600_000);
  afterAll(async () => {
    if (run) await i.h.close();
  });

  it.skipIf(!run)('every row is where it was, and what the install seeds is not seeded twice', async () => {
    expect(await Promise.all(TABLES.map(rowsIn))).toEqual(before);
    expect(await rowsIn('settings')).toBe(1);
  });

  it.skipIf(!run)('the sample is still the sample: loaded, counted, dated', async () => {
    const status = await service().status(await owner());
    expect(status).toMatchObject({ offered: true, loaded: true, total });
    expect(status.addedAt).not.toBeNull();
    expect(await service().everAdded(await owner())).toBe(true);
  });

  it.skipIf(!run)('and it can still be removed, which leaves the tables as an install leaves them', async () => {
    await service().remove(await owner(), { keepChanged: false, userId: i.h.owner.id, userLabel: 'owner@test' });
    expect(await rowsIn('items')).toBe(0);
    expect(await rowsIn('movements')).toBe(0);
    expect(await rowsIn('settings')).toBe(1);
    expect((await service().status(await owner())).loaded).toBe(false);
  });
});
