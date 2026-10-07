// SPDX-License-Identifier: AGPL-3.0-only
/**
 * INVENTORY, INSTALLED.
 *
 * The add-on as it is built in the add-ons repository, installed with no app
 * on each database: its thirty tables under its own name, the rows it starts
 * with, and the role its installer is given.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGS } from '../../invoicing-install.helpers.js';
import { builtAddOn, installBuilt, type Installed } from '../harness.js';

const inventory = builtAddOn('inventory');

describe.skipIf(inventory === null)('Inventory, as it is built', () => {
  it('names the file that decides, and it is built', () => {
    expect(Object.keys(inventory?.files ?? {})).toContain('dist/server.js');
  });
});

describe.each(LEGS)('Inventory installed with no app — %s', (dialect, available) => {
  const run = available && inventory !== null;
  let world: Installed;
  beforeAll(async () => {
    if (run) world = await installBuilt(dialect, inventory);
  }, 240_000);
  afterAll(async () => {
    if (run) await world.h.close();
  });

  it.skipIf(!run)('makes thirty tables under its own name, and says nothing was left out', async () => {
    const tables = (inventory?.manifest['requiredSchema'] as { tables: { ref: string }[] }).tables.map((table) => table.ref);
    expect(tables).toHaveLength(30);
    const made = await world.h.tableNames();
    for (const ref of tables) expect(made, ref).toContain(world.real(ref));
    // Nothing of the manifest was skipped or refused on the way in.
    expect(JSON.stringify(world.reply)).not.toContain('PAGE_FORM_INVALID');
    expect((world.reply['rules'] as { skipped?: unknown[] } | undefined)?.skipped ?? []).toEqual([]);
  });

  it.skipIf(!run)('starts with twelve units, seven reasons and the one settings row, whose unit is "each"', async () => {
    const units = await world.rowsOf('units');
    expect(units).toHaveLength(12);
    const each = units.find((unit) => unit['code'] === 'each');
    expect(each).toBeDefined();
    expect(await world.rowsOf('reasons')).toHaveLength(7);
    const settings = await world.rowsOf('settings');
    expect(settings).toHaveLength(1);
    expect(String(settings[0]?.['default_unit_id'])).toBe(String(each?.['id']));
    // The rest of the row is its columns' own defaults.
    expect(settings[0]).toMatchObject({ when_out_staff: 'allow', when_out_public: 'stop', po_prefix: 'PO-' });
    expect(Number(settings[0]?.['count_stale_days'])).toBe(90);
  });

  it.skipIf(!run)('gives the person who installed it the manager\'s role, and nobody the other two', async () => {
    const held = await world.h.meta.db
      .selectFrom('adminium_user_roles')
      .innerJoin('adminium_roles', 'adminium_roles.id', 'adminium_user_roles.roleId')
      .select(['adminium_roles.slug', 'adminium_user_roles.userId'])
      .where('adminium_roles.slug', 'like', 'inventory-%')
      .execute();
    expect(held.map((row) => [row.slug, row.userId])).toEqual([['inventory-manager', world.h.owner.id]]);
    const roles = await world.h.meta.db.selectFrom('adminium_roles').select('slug').where('slug', 'like', 'inventory-%').orderBy('slug').execute();
    expect(roles.map((role) => role.slug)).toEqual(['inventory-clerk', 'inventory-manager', 'inventory-viewer']);
  });
});
