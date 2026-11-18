// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A KEY ADMINIUM MAKES, SAVED INTO AN APP FILE AND INSTALLED AGAIN.
 *
 * An app's `id` key is made `varchar(36)` and filled with a new uuid on every
 * create (a `column.default` rule). Saved, it is an `id` key again, not a
 * bounded text key nobody fills: installed on a fresh database it is the
 * same table and filled again, and installed back onto the database it came
 * from it plans no change. On every engine.
 */
import { validateManifest } from '@adminium/manifest';
import { overridesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { asFile, latestModel, made, override, save, shapeOf, tableId } from './app-save-source.js';

type Doc = Record<string, unknown>;
const keyOf = (manifest: Doc, table: string): Doc =>
  (manifest['requiredSchema'] as { tables: { ref: string; columns: Doc[] }[] }).tables.find((one) => one.ref === table)!.columns.find((one) => one['ref'] === 'id')!;

let open: Harness[] = [];
afterEach(async () => {
  for (const h of open) await h.close();
  open = [];
});

async function harness(dialect: Dialect): Promise<Harness> {
  const h = await installHarness(dialect);
  open.push(h);
  return h;
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a made key, saved — ${dialect}`, () => {
    it('is an id key in the file, filled again on a fresh database, and plans no change on its own', async () => {
      const h = await harness(dialect);
      await made(h, ['CREATE TABLE tickets (id varchar(36) PRIMARY KEY, title varchar(80))']);
      await override(h, 'tickets', 'column.default', { kind: 'uuid' }, 'id');
      const saved = await save(h, dialect);
      const { manifest, files } = asFile(saved);
      expect(keyOf(manifest, 'tickets')).toEqual({ ref: 'id', type: 'id', role: 'pk' });
      const valid = validateManifest(manifest, { allowLocalPublisher: true });
      expect(valid.ok, JSON.stringify(valid.ok ? [] : valid.issues)).toBe(true);

      const target = await harness(dialect);
      const installed = await target.install(manifest, {}, files);
      expect(installed.statusCode, installed.body).toBe(200);
      expect(shapeOf(await latestModel(target), ['tickets'])).toEqual(shapeOf(await latestModel(h), ['tickets']));
      const tickets = (await latestModel(target)).tables.find((one) => one.name.endsWith('tickets'))!.id;
      const fills = (await overridesRepo(target.meta).listForConnection(target.connectionId, { status: 'active' })).filter((row) => row.op === 'column.default' && row.tableName === tickets);
      expect(fills.map((row) => [row.columnName, row.value])).toEqual([['id', { kind: 'uuid' }]]);

      await h.stage(manifest, files);
      const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId, existing: 'use' } });
      expect(plan.statusCode, plan.body).toBe(200);
      const planned = (JSON.parse(plan.body) as { plan: { installable: boolean; problems: unknown[]; tables: { ref: string; action: string; edits: unknown[] }[] } }).plan;
      expect(planned.problems).toEqual([]);
      expect(planned.tables.map((table) => [table.ref, table.action, table.edits])).toEqual([['tickets', 'reuse', []]]);
      expect(await tableId(h, 'tickets')).toBeDefined();
    });
  });
}
