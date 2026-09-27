// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sample data kept off a table shared with another app when that table
 * already holds real rows: the rule names the app's own tables, and the
 * table it watches is one built on a shape another app can share.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { validateManifest } from '../src/index.js';

const POS = JSON.parse(
  readFileSync(new URL('./fixtures/released/point-of-sale-0.2.2.manifest.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const withSkip = (skipWhenShared: unknown) => ({ ...structuredClone(POS), sampleData: { file: 'seeds/pos.sample.json', skipWhenShared } });
const issuesOf = (doc: unknown) => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => issue.message);
};

describe('sample data kept off a shared table that holds real rows', () => {
  /** The dishes and every table whose rows point at them, however far. */
  const MENU_AND_ITS_LINKS = ['menu_items', 'modifier_groups', 'modifiers', 'ticket_items', 'ticket_item_modifiers', 'refund_items', 'rewards', 'loyalty_ledger'];

  it('validates on a shaped table, naming the app’s own tables', () => {
    expect(issuesOf(withSkip({ table: 'menu_items', skip: MENU_AND_ITS_LINKS }))).toEqual([]);
  });

  it('refuses a table that is not the app’s, is built on no shape, or is listed twice', () => {
    expect(issuesOf(withSkip({ table: 'dishes', skip: ['settings'] }))).toEqual(['"dishes" is not one of this app\'s tables']);
    expect(issuesOf(withSkip({ table: 'tickets', skip: ['settings'] }))).toEqual([
      '"tickets" is built on no shape, so no other app can share it',
    ]);
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['orders', 'settings', 'settings'] }))).toEqual([
      '"orders" is not one of this app\'s tables',
      '"settings" is listed twice',
    ]);
  });

  it('refuses a list that leaves in a table whose rows point at a skipped one', () => {
    // The lines and the rewards point at the dishes; the options' links reach them through their groups.
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['menu_items', 'modifier_groups', 'modifiers'] }))).toEqual([
      '"ticket_items" links to "menu_items" (menu_item_id), which is skipped: skip "ticket_items" too, or its sample rows point at rows never added',
      '"ticket_item_modifiers" links to "modifiers" (modifier_id), which is skipped: skip "ticket_item_modifiers" too, or its sample rows point at rows never added',
      '"rewards" links to "menu_items" (menu_item_id), which is skipped: skip "rewards" too, or its sample rows point at rows never added',
    ]);
    // A table the skipped ones point at stays: the categories are added, the dishes are not.
    expect(issuesOf(withSkip({ table: 'menu_items', skip: MENU_AND_ITS_LINKS.filter((ref) => ref !== 'loyalty_ledger') }))).toEqual([
      '"loyalty_ledger" links to "rewards" (reward_id), which is skipped: skip "loyalty_ledger" too, or its sample rows point at rows never added',
    ]);
  });

  it('refuses an unknown key or an empty list', () => {
    expect(issuesOf(withSkip({ table: 'menu_items', skip: [] }))).not.toEqual([]);
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['tickets'], also: true }))).not.toEqual([]);
  });
});
