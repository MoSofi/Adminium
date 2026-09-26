// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sample data added before a date read as its day still removes cleanly.
 *
 * The ledger hashes each sample row as it was read back. Postgres and MySQL
 * used to hand a date back as a JavaScript date at this server's local
 * midnight, which the ledger spelled as its UTC day: east of UTC, the day
 * before (`1948-03-11` was recorded as `1948-03-10` in Berlin). Now that a
 * date reads as its day, such a row must still be measured the way it was
 * recorded, or every sample row with a date reads as changed and stays when
 * the sample is removed. A date the operator really changed still keeps its
 * row, whichever way it was recorded. Run this file under `TZ=Europe/Berlin`,
 * `Asia/Kolkata`, `America/Los_Angeles` and `UTC`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp, hashRow } from '../src/apps/sample-data.js';
import type { Row } from '../src/crud/mask.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const TABLES = [
  {
    ref: 'patients',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 80 },
      { ref: 'born_on', type: 'date', nullable: true },
      { ref: 'seen_on', type: 'date', nullable: true },
    ],
  },
];
const PATIENTS = [
  { name: 'Ada', born_on: '1948-03-11', seen_on: '2026-08-14' },
  { name: 'Bea', born_on: '1990-01-01', seen_on: '2026-03-29' },
  { name: 'Cal', born_on: '2001-10-28', seen_on: null },
  { name: 'Dee', born_on: null, seen_on: null },
  { name: 'Eve', born_on: '1975-06-30', seen_on: '2026-12-31' },
  { name: 'Fay', born_on: '1983-07-04', seen_on: '2026-08-15' },
  { name: 'Gil', born_on: null, seen_on: '2026-08-20' },
];
const BUNDLE = { format: 'adminium.sample/1', app: 'studio', tables: [{ ref: 'patients', rows: PATIENTS }] };

/** `YYYY-MM-DD` plus some days. */
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

let open: InvoicingHarness | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

for (const [dialect, available] of LEGS) {
  describe.skipIf(!available)(`sample data recorded before dates read as days, on ${dialect} (TZ=${process.env['TZ'] ?? 'unset'})`, () => {
    it('removes every row the operator left alone, and keeps each one whose date they changed', async () => {
      const manifest = { ...invoicingManifest(TABLES), sampleData: { file: 'seeds/studio.sample.json' } };
      const h = (open = await installInvoicing(dialect, manifest, undefined, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) }));
      const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      const app = async () => (await findSampleApp(h.meta, 'studio'))!;
      await service.add(await app(), { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });

      const { db } = await h.manager.data(h.connectionId);
      const table = (await loadSnapshotView(h.meta, h.connectionId)).table(h.real('patients'));
      const ledger = h.real('sample_data');
      const patients = (await db.selectFrom(table.id as never).selectAll().orderBy('id' as never).execute()) as Row[];
      expect(patients.map((row) => row['born_on'] ?? null)).toEqual(PATIENTS.map((row) => row.born_on));

      /*
       * Ada, Bea, Cal and Dee as the version before recorded them: on Postgres
       * and MySQL the driver's date at local midnight, hashed by the same
       * `hashRow`; on SQLite the text, as ever. Eve, Fay and Gil stay as recorded now.
       */
      const before = (value: unknown): unknown => {
        if (dialect === 'sqlite' || typeof value !== 'string') return value;
        const [y, m, d] = value.split('-').map(Number) as [number, number, number];
        const at = new Date(0);
        at.setFullYear(y, m - 1, d);
        at.setHours(0, 0, 0, 0);
        return at;
      };
      const entries = (await db.selectFrom(ledger as never).selectAll().orderBy('seq' as never).execute()) as { seq: number; pk: string }[];
      expect(entries).toHaveLength(PATIENTS.length);
      for (const entry of entries.slice(0, 4)) {
        const row = patients.find((patient) => String(patient['id']) === String((JSON.parse(entry.pk) as Row)['id']))!;
        const { rowHash, colHashes } = hashRow({ ...row, born_on: before(row['born_on']), seen_on: before(row['seen_on']) }, table);
        await db
          .updateTable(ledger as never)
          .set({ row_hash: rowHash, col_hashes: JSON.stringify(colHashes) } as never)
          .where('seq' as never, '=', entry.seq as never)
          .execute();
      }

      /*
       * The operator moves Bea's visit a day on (recorded before), and Fay's and
       * Gil's (recorded now). Moved on a day east of UTC, a date recorded now
       * reads as the day before — exactly how it would have been recorded
       * before — so taking either spelling for any row would lose Gil's edit.
       */
      const idOf = (name: string) => patients.find((row) => row['name'] === name)!['id'];
      for (const name of ['Bea', 'Fay', 'Gil']) {
        const seen = PATIENTS.find((row) => row.name === name)!.seen_on!;
        await h.rows(`update ${h.real('patients')} set seen_on = '${plusDays(seen, 1)}' where id = ${String(idOf(name))}`);
      }

      const preview = await service.removePreview(await app());
      expect(preview.changed.map((row) => [row.title ?? row.label, row.columns])).toEqual(
        expect.arrayContaining([
          [expect.anything(), ['seen_on']],
          [expect.anything(), ['seen_on']],
          [expect.anything(), ['seen_on']],
        ]),
      );
      expect(preview.changed).toHaveLength(3);

      const removed = await service.remove(await app(), { keepChanged: true, userId: null, userLabel: 'test' });
      expect(removed).toMatchObject({ removed: 4, kept: 3 });
      const left = (await db.selectFrom(table.id as never).select('name' as never).orderBy('id' as never).execute()) as Row[];
      expect(left.map((row) => row['name'])).toEqual(['Bea', 'Fay', 'Gil']);
    }, 120_000);
  });
}
