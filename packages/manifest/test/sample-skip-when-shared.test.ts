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
  it('validates on a shaped table, naming the app’s own tables', () => {
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['menu_items', 'tickets'] }))).toEqual([]);
  });

  it('refuses a table that is not the app’s, is built on no shape, or is listed twice', () => {
    expect(issuesOf(withSkip({ table: 'dishes', skip: ['menu_items'] }))).toEqual(['"dishes" is not one of this app\'s tables']);
    expect(issuesOf(withSkip({ table: 'tickets', skip: ['menu_items'] }))).toEqual([
      '"tickets" is built on no shape, so no other app can share it',
    ]);
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['orders', 'menu_items', 'menu_items'] }))).toEqual([
      '"orders" is not one of this app\'s tables',
      '"menu_items" is listed twice',
    ]);
  });

  it('refuses an unknown key or an empty list', () => {
    expect(issuesOf(withSkip({ table: 'menu_items', skip: [] }))).not.toEqual([]);
    expect(issuesOf(withSkip({ table: 'menu_items', skip: ['tickets'], also: true }))).not.toEqual([]);
  });
});
