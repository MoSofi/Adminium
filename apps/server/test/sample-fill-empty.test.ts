// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAMPLE ROW FILLS THE ONE ROW A TABLE ALREADY HOLDS (plan 67, candidate E11).
 *
 * An app's settings row is written by its install, with the columns' own
 * defaults. Its sample's settings row is "only if the table is empty", so it
 * was left out whole: a demo opened with no depot on the map. With
 * `"@fillEmpty": true` beside `"@onlyIfEmpty"`, the row that is there takes
 * the sample's values in the columns it holds nothing in — never over a
 * value — and they are emptied again with the sample, where nobody changed
 * them since.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { createAppStore } from '../src/apps/store.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = { write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;
const id = { ref: 'id', type: 'int', role: 'pk' };

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest([
    {
      ref: 'settings',
      columns: [id, { ref: 'snag_days', type: 'int', default: 5 }, { ref: 'depot_name', type: 'text', maxLength: 80, nullable: true }, { ref: 'depot_town', type: 'text', maxLength: 80, nullable: true }, { ref: 'depot_lat', type: 'decimal', scale: 4, nullable: true }],
    },
    { ref: 'things', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
  ]),
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-things', template: 'page-crud', title: { key: 't', fallback: 'Things' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'things' } }],
  seeds: [{ table: 'settings', rows: [{}] }],
  sampleData: { file: 'seeds/studio.json' },
});
const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'settings', rows: [{ '@label': 'settings', '@onlyIfEmpty': true, '@fillEmpty': true, snag_days: 9, depot_name: 'Meridian depot', depot_town: 'Leeds', depot_lat: 53.8008 }] },
    { ref: 'things', rows: [{ name: 'A desk' }] },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a sample row that fills the row already there [${dialect}]`, () => {
    let h: InvoicingHarness;
    let service: ReturnType<typeof createSampleDataService>;
    const app = async () => (await findSampleApp(h.meta, 'studio'))!;
    const settings = async () => {
      const rows = await h.rows('SELECT snag_days, depot_name, depot_town, depot_lat FROM studio_settings');
      expect(rows).toHaveLength(1);
      return [Number(rows[0]!['snag_days']), rows[0]!['depot_name'], rows[0]!['depot_town'], rows[0]!['depot_lat'] === null ? null : Number(rows[0]!['depot_lat'])];
    };
    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, { 'seeds/studio.json': JSON.stringify(BUNDLE) });
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    it('the install\'s row takes the sample\'s values where it holds none, and keeps the ones it has', async () => {
      expect(await settings()).toEqual([5, null, null, null]);
      await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test' });
      // Five days stays five: the sample's nine is not written over a value.
      expect(await settings()).toEqual([5, 'Meridian depot', 'Leeds', 53.8008]);
      expect(Number((await h.rows('SELECT COUNT(*) AS n FROM studio_things'))[0]!['n'])).toBe(1);
      // The settings row is not listed as sample data: it was the owner's before the sample came.
      expect((await service.status(await app())).tables.map((table) => table.ref)).toEqual(['things']);
    });

    it('removing the sample empties what it filled, but not what somebody changed since, and the row stays', async () => {
      await h.rows("UPDATE studio_settings SET depot_town = 'York'");
      await service.remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' });
      expect(await settings()).toEqual([5, null, 'York', null]);
      expect(Number((await h.rows('SELECT COUNT(*) AS n FROM studio_things'))[0]!['n'])).toBe(0);
    });

    it('added again, it fills what is empty and leaves the owner\'s value alone', async () => {
      await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test' });
      expect(await settings()).toEqual([5, 'Meridian depot', 'York', 53.8008]);
      await service.remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' });
      expect(await settings()).toEqual([5, null, 'York', null]);
    });
  });
}
