// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A hotel's sample data: its stays are priced by the night from the rate
 * rules listed before them, their extras copy the stay's nights and guests,
 * and the stays' totals are settled once every row is in — so every figure
 * is right, and removing the sample takes every row it added (none of them
 * looks changed by the totals settled after it was written). On every engine.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, type InvoicingHarness } from './invoicing-install.helpers.js';
import { wrenManifest } from './wren-house-fixture.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'wren',
  tables: [
    { ref: 'settings', rows: [{ tax_rate: 9, '@onlyIfEmpty': true }] },
    { ref: 'room_types', rows: [{ '@label': 'garden', code: 'garden', name: 'Garden', base_rate: 150, sleeps: 2 }] },
    {
      ref: 'rate_rules',
      rows: [
        { name: 'Weekend', weekdays: 'fri,sat', amount: 25 },
        { name: 'August', from_date: '2026-08-01', to_date: '2026-08-31', amount: 20 },
      ],
    },
    { ref: 'extras', rows: [{ '@label': 'breakfast', label: 'Breakfast', each: 16, per: 'person-night' }] },
    {
      ref: 'stays',
      rows: [{ '@label': 'mia', first_name: 'Mia', last_name: 'Okada', room_type_id: { '@ref': 'garden' }, arrive: '2026-07-31', depart: '2026-08-03', guests: 2 }],
    },
    { ref: 'stay_extras', rows: [{ stay_id: { '@ref': 'mia' }, extra_id: { '@ref': 'breakfast' } }] },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a hotel's sample stays on ${dialect}`, () => {
    let h: InvoicingHarness;
    let service: ReturnType<typeof createSampleDataService>;

    beforeAll(async () => {
      const manifest = { ...wrenManifest(), sampleData: { file: 'seeds/wren.sample.json' } };
      h = await installInvoicing(dialect, manifest, undefined, { 'seeds/wren.sample.json': JSON.stringify(BUNDLE) });
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      await service.add((await findSampleApp(h.meta, 'wren'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('prices the stay by the night and settles its extras into its total', async () => {
      const [stay] = await h.rows(`SELECT nights, room_total, extras_total, subtotal, tax, total, guest_name FROM ${h.real('stays')}`);
      expect([Number(stay!['nights']), Number(stay!['room_total']), Number(stay!['extras_total']), Number(stay!['subtotal'])]).toEqual([3, 540, 96, 636]);
      expect([Number(stay!['tax']).toFixed(2), Number(stay!['total']).toFixed(2), stay!['guest_name']]).toEqual(['57.24', '693.24', 'Mia Okada']);
      const [extra] = await h.rows(`SELECT nights, guests, amount FROM ${h.real('stay_extras')}`);
      expect([Number(extra!['nights']), Number(extra!['guests']), Number(extra!['amount'])]).toEqual([3, 2, 96]);
    });

    it('takes every row it added back out', async () => {
      const app = (await findSampleApp(h.meta, 'wren'))!;
      const preview = await service.removePreview(app);
      expect(preview.changed).toEqual([]);
      const removed = await service.remove(app, { keepChanged: false, userId: null, userLabel: 'test' });
      expect(removed.kept).toBe(0);
      for (const table of ['stays', 'stay_extras', 'rate_rules', 'room_types', 'extras']) {
        expect(await h.rows(`SELECT id FROM ${h.real(table)}`)).toEqual([]);
      }
    });
  });
}
