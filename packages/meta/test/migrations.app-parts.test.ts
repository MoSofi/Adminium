// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0077: what an install made of the parts its file carries, on every
 * available dialect. An install from before the wave upgrades with its rows
 * as they were; each entry of an install is recorded once, written again in
 * place; and the records go with the install's row.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, appPartsRepo, manifestsRepo, newId, reportDocumentsRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;
const PRE_0077 = ALL_MIGRATIONS.filter((m) => m.name < '0077_app_parts');
const crypto = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const SHOP = { manifestKey: 'corner-shop', version: '1.0.0', kind: 'app' as const, source: 'file', document: { kind: 'app', key: 'corner-shop', version: '1.0.0' } };

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0077_app_parts [${dialect.name}]`, () => {
    let t: TestDb;

    beforeEach(async () => {
      t = await dialect.make();
    });
    afterEach(async () => {
      await t.destroy();
    });

    it('upgrades an install with its rows, and records each entry once, in place', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0077 });
      // An install and a report written before the wave.
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      const report = await reportDocumentsRepo(t.meta).create({ kind: 'report', name: 'Weekly', body: { reportTitle: 'Weekly', blocks: [] }, summary: { reportTitle: 'Weekly', kicker: '', accent: '#4f46e5', blockCount: 0, kpiCount: 0, series: [], starterIcon: 'file-text' } }, T0);

      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const repo = appPartsRepo(t.meta);
      expect(await repo.list(installed.row.id)).toEqual([]);
      expect((await reportDocumentsRepo(t.meta).findById(report.id))?.name).toBe('Weekly');

      await repo.put({ manifestId: installed.row.id, kind: 'report', partKey: 'weekly', targetId: report.id, contentHash: 'a'.repeat(64) }, T0);
      await repo.put({ manifestId: installed.row.id, kind: 'report', partKey: 'weekly', targetId: report.id, contentHash: 'b'.repeat(64) }, T0 + 1);
      const layout = newId('inv');
      await repo.put({ manifestId: installed.row.id, kind: 'invoice-layout', partKey: 'weekly', targetId: layout, contentHash: 'c'.repeat(64) }, T0 + 2);
      const parts = await repo.list(installed.row.id);
      expect(parts.map((part) => [part.kind, part.partKey, part.contentHash[0], part.updatedAt])).toEqual([
        ['invoice-layout', 'weekly', 'c', T0 + 2],
        ['report', 'weekly', 'b', T0 + 1],
      ]);
      expect(await repo.list(installed.row.id, 'report')).toHaveLength(1);

      // The records go with the install's row; the made rows are the uninstall's to let go.
      await manifestsRepo(t.meta, crypto).uninstall(installed.row.id);
      expect(await repo.list(installed.row.id)).toEqual([]);
      expect(await reportDocumentsRepo(t.meta).findById(report.id)).not.toBeNull();
    });

    it('a key longer than its column is refused before the database sees it', async () => {
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: ALL_MIGRATIONS });
      const installed = await manifestsRepo(t.meta, crypto).install(SHOP, T0);
      await expect(appPartsRepo(t.meta).put({ manifestId: installed.row.id, kind: 'report', partKey: 'k'.repeat(81), targetId: newId('rpt'), contentHash: 'a'.repeat(64) })).rejects.toThrow('longer than its column');
    });
  });
}
