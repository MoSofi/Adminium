// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S UPDATE THAT NEEDS A NEWER ADD-ON WHOSE VERSION BRINGS TABLES takes
 * the add-on's update FIRST: the app's new version may point at those tables.
 * So that a stop right after it leaves a pair that works, the add-on's new
 * version must accept the app as it is running, too — else the update is
 * refused before anything moves. An add-on update that changes no table runs
 * after the app's own tables, as it always did.
 */
import { auditRepo, manifestsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { splitAddOnSteps, type AddOnStep } from '../src/apps/add-ons.js';
import { addOnHarness, type Harness } from './app-add-ons.helpers.js';
import { stockKitManifest } from './fixtures/stock-kit/index.js';
import { LEGS } from './invoicing-install.helpers.js';

const CRYPTO = { encrypt: (v: string) => v, decrypt: (v: string) => v };
let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

const pk = { ref: 'id', type: 'int', role: 'pk' };
/** A shop that requires the stock kit in a range, with tables of its own under no prefix. */
const shop = (version: string, range: string, tables: string[]) => ({
  kind: 'app',
  manifestVersion: 1,
  key: 'shop',
  name: 'Shop',
  version,
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'MIT',
  description: { key: 'd', fallback: 'd' },
  categories: ['commerce'],
  compatibility: { minAdminiumVersion: '0.3.1' },
  pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'manage', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
  frontends: [{ side: 'staff', kind: 'none' }],
  addOns: { requires: [{ key: 'stock-kit', range, reason: { 'en-US': 'Keeps the stock.' } }] },
  requiredSchema: { tables: tables.map((ref) => ({ ref, columns: [pk, { ref: 'note', type: 'text', maxLength: 80, nullable: true }] })) },
});
/** The kit's next version: one more table. `accepts` narrows which versions of the shop it works with. */
function kitNext(accepts?: string): Record<string, unknown> {
  const kit = stockKitManifest() as Record<string, unknown> & { requiredSchema: { tables: unknown[] }; addOn: Record<string, unknown> };
  kit['version'] = '1.0.1';
  kit.requiredSchema.tables.push({ ref: 'counts', columns: [pk, { ref: 'item_id', type: 'fk', references: 'items' }] });
  if (accepts !== undefined) kit.addOn = { ...kit.addOn, attaches: [{ app: 'shop', range: accepts }] };
  return kit;
}
const versions = async (harness: Harness) => {
  const rows = manifestsRepo(harness.meta, CRYPTO);
  return { shop: (await rows.findByKey('shop'))?.row.version, kit: (await rows.findByKey('stock-kit'))?.row.version, kitStatus: (await rows.findByKey('stock-kit'))?.row.status };
};

describe('the order an app\'s add-on steps are taken in', () => {
  const step = (key: string, action: AddOnStep['action'], early?: true): AddOnStep => ({ key, name: key, action, version: '1.0.0', from: null, ...(early === undefined ? {} : { early }) });
  it('installs, attaches and the updates that bring tables first; the other updates last', () => {
    const steps = [step('a', 'update'), step('b', 'install'), step('c', 'update', true), step('d', 'attach')];
    const { early, late } = splitAddOnSteps(steps);
    expect(early.map((one) => one.key)).toEqual(['b', 'c', 'd']);
    expect(late.map((one) => one.key)).toEqual(['a']);
  });
});

describe.each(LEGS)('an app update with an add-on update that brings tables — %s', (dialect, available) => {
  /** Shop 0.3.0 installed with the kit 1.0.0; the kit's next version and the shop's are staged. */
  async function ready(accepts?: string): Promise<Harness> {
    const harness = await addOnHarness(dialect, { unbuiltWords: {} });
    await harness.stageAddOn(stockKitManifest(), { bundled: true });
    await harness.stageApp(shop('0.3.0', '>=1.0.0', ['orders']));
    const installed = await harness.install('shop', '0.3.0', { addOns: [{ key: 'stock-kit', version: '1.0.0' }] });
    expect(installed.statusCode, installed.body).toBe(200);
    await harness.stageAddOn(kitNext(accepts), { bundled: true });
    await harness.stageApp(shop('0.3.1', '>=1.0.1', ['orders', 'returns']));
    return harness;
  }
  const update = (harness: Harness) => harness.inject({ method: 'POST', url: '/apps/shop/update', payload: { addOns: [{ key: 'stock-kit', version: '1.0.1', update: true }] } });

  it.runIf(available)('updates in one go: the add-on\'s table first, then the app\'s, then the app\'s version', async () => {
    h = await ready();
    const reply = await update(h);
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().app.addOns.updated).toEqual([{ key: 'stock-kit', name: 'Stock kit', from: '1.0.0', to: '1.0.1' }]);
    expect(await versions(h)).toEqual({ shop: '0.3.1', kit: '1.0.1', kitStatus: 'installed' });
    expect(await h.tableNames()).toEqual(expect.arrayContaining(['stock_kit_counts', 'returns']));
    // The add-on moved before the app did.
    const order = (await auditRepo(h.meta).list({ limit: 60 })).map((entry) => entry.action).reverse();
    const at = (action: string) => order.lastIndexOf(action);
    expect(at('add-on.upgraded')).toBeGreaterThan(-1);
    expect(at('add-on.upgraded')).toBeLessThan(at('app.updated'));
  });

  it.runIf(available)('is refused before anything moves when the add-on\'s new version does not work with the app as it runs', async () => {
    // The kit's next version works with the shop from 0.3.1 on only: updated first, it would sit beside 0.3.0.
    h = await ready('>=0.3.1');
    const reply = await update(h);
    expect(reply.statusCode, reply.body).not.toBe(200);
    expect(reply.body).toContain('ADD_ON_RANGE');
    expect(reply.body).toContain('0.3.0');
    expect(await versions(h)).toEqual({ shop: '0.3.0', kit: '1.0.0', kitStatus: 'installed' });
    expect(await h.tableNames()).not.toContain('stock_kit_counts');
    expect(await h.tableNames()).not.toContain('returns');
  });
});
