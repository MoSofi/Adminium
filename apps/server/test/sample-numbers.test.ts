// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SAMPLE ROW TAKES A NUMBER IN THE APP'S OWN SERIES.
 *
 * A number without gaps was never a sample row's: every one wrote it empty,
 * so that a sample taken out again leaves no hole in an invoice series. For
 * a series that is no tax document's (a job's J-01) that only hurt: the
 * sample's jobs had to be typed "S-01", or a typed "J-01" beside an empty
 * number met the first real job, which was handed J-01 too and refused.
 *
 * A running number marked `sample` is given by the sample's rows, with the
 * text written from it. The next real row follows the largest number there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import { createAppStore } from '../src/apps/store.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = { write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }) } as unknown as FileStore;
const id = { ref: 'id', type: 'int', role: 'pk' };

const manifest = (): Record<string, unknown> => ({
  ...invoicingManifest([
    {
      ref: 'jobs',
      columns: [
        id,
        { ref: 'name', type: 'text', maxLength: 80 },
        { ref: 'code_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true, start: 1, sample: true } } },
        { ref: 'code', type: 'text', maxLength: 12, unique: true, nullable: true, rules: { format: { from: 'code_seq', prefix: 'J-', pad: 2 } } },
      ],
    },
  ]),
  compatibility: { minAdminiumVersion: '0.3.27' },
  pages: [{ ref: 'studio-jobs', template: 'page-crud', title: { key: 't', fallback: 'Jobs' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'jobs' } }],
  sampleData: { file: 'seeds/studio.json' },
});
const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    {
      ref: 'jobs',
      rows: [
        { name: 'Harbour fit-out', code_seq: 1, code: 'J-01' },
        { name: 'Northfield desks', code_seq: 2, code: 'J-02' },
        { name: 'Quay benches', code_seq: 3, code: 'J-03' },
        // One with no number at all: a sample row may still carry none.
        { name: 'Not numbered', code_seq: null },
      ],
    },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a sample numbers its rows into the app's own series [${dialect}]`, () => {
    let h: InvoicingHarness;
    let service: ReturnType<typeof createSampleDataService>;
    const app = async () => (await findSampleApp(h.meta, 'studio'))!;
    const codes = async () => (await h.rows('SELECT code FROM studio_jobs WHERE code IS NOT NULL ORDER BY code_seq')).map((row) => row['code']);
    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, { 'seeds/studio.json': JSON.stringify(BUNDLE) });
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    }, 240_000);
    afterAll(async () => {
      await h?.close();
    });

    it('the sample\'s rows hold the numbers they were written with, and the next real row follows them', async () => {
      await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test' });
      expect(await codes()).toEqual(['J-01', 'J-02', 'J-03']);
      expect(Number((await h.rows('SELECT COUNT(*) AS n FROM studio_jobs'))[0]!['n'])).toBe(4);
      const w = await writerFor(h);
      await w.create('jobs', { name: 'The owner\'s first job' });
      expect(await codes()).toEqual(['J-01', 'J-02', 'J-03', 'J-04']);
    });

    it('with the sample taken out, the owner\'s row keeps its number and the series goes on from it', async () => {
      await service.remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' });
      expect(await codes()).toEqual(['J-04']);
      const w = await writerFor(h);
      await w.create('jobs', { name: 'The owner\'s second job' });
      expect(await codes()).toEqual(['J-04', 'J-05']);
    });

    it('put in again beside the owner\'s rows, the sample\'s numbers are its own and the series still goes on', async () => {
      await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test' });
      expect(await codes()).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05']);
      const w = await writerFor(h);
      await w.create('jobs', { name: 'The owner\'s third job' });
      expect(await codes()).toEqual(['J-01', 'J-02', 'J-03', 'J-04', 'J-05', 'J-06']);
    });
  });
}
