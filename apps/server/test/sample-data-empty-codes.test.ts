// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A sample row, or an imported one, that brings an EMPTY code gets one made,
 * as a person's create does — a studio's sample handover opens with its link.
 * A code the sample or the import brings is kept — but never a shared link's
 * from the sample: the app's package is public, so every install's sample
 * handover would open with the same link. Only an undo puts an empty one
 * back, as it was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { WriteContext } from '../src/crud/write-service.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const KEPT = 'KILNSTREETDONE26';
const TABLES = [
  {
    ref: 'projects',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'name', type: 'text', maxLength: 120 },
      // The handover link's code, and a booking reference: neither a secret by its name.
      { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
      { ref: 'ref_code', type: 'text', maxLength: 9, nullable: true, rules: { code: { prefix: 'PR-', length: 6 } } },
    ],
  },
];
const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    {
      ref: 'projects',
      rows: [
        { name: 'Null codes', share_token: null, ref_code: null },
        { name: 'Blank codes', share_token: '', ref_code: '' },
        { name: 'No codes' },
        { name: 'Own codes', share_token: KEPT, ref_code: 'PR-ABC123' },
      ],
    },
  ],
};

describe.each(LEGS)('an empty code in a sample or an import — %s', (dialect, available) => {
  let h: InvoicingHarness;
  const codes = async () =>
    Object.fromEntries(
      (await h.rows(`SELECT name, share_token, ref_code FROM ${h.real('projects')} ORDER BY id`)).map((row) => [String(row['name']), [row['share_token'] ?? null, row['ref_code'] ?? null]]),
    ) as Record<string, [unknown, unknown]>;

  beforeAll(async () => {
    if (!available) return;
    const manifest = {
      ...invoicingManifest(TABLES),
      sampleData: { file: 'seeds/studio.sample.json' },
      // `share_token` is the code a shared link opens a project with.
      publicKeys: { handover: {} },
      publicAccess: [{ table: 'projects', methods: ['GET'], select: ['name'], claim: { by: 'token', column: 'share_token' }, key: 'handover' }],
    };
    h = await installInvoicing(dialect, manifest, undefined, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) });
    const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
    await service.add((await findSampleApp(h.meta, 'studio'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await h.close();
  });

  it.skipIf(!available)('makes one for a sample row that brings none, and keeps the one it brings — but a shared link’s', async () => {
    const got = await codes();
    for (const name of ['Null codes', 'Blank codes', 'No codes', 'Own codes']) {
      expect(got[name]![0], name).toMatch(/^[0-9A-Z]{16}$/);
    }
    for (const name of ['Null codes', 'Blank codes', 'No codes']) {
      expect(got[name]![1], name).toMatch(/^PR-[0-9A-Z]{6}$/);
    }
    // The booking reference is kept; the link's code, printed in the package, is made anew.
    expect(got['Own codes']![1]).toBe('PR-ABC123');
    expect(got['Own codes']![0]).not.toBe(KEPT);
    expect(new Set(Object.values(got).map(([code]) => code)).size).toBe(4);
  });

  it.skipIf(!available)('makes one for an imported row that brings none; an undo puts an empty one back', async () => {
    const w = await writerFor(h);
    const as = (origin: WriteContext['origin']): WriteContext => ({ ...w.desk, origin });
    const imported = await w.create('projects', { name: 'Imported', share_token: null, ref_code: '' }, as('import'));
    expect([imported['share_token'], imported['ref_code']]).toEqual([expect.stringMatching(/^[0-9A-Z]{16}$/), expect.stringMatching(/^PR-[0-9A-Z]{6}$/)]);
    const brought = await w.create('projects', { name: 'Imported with codes', share_token: 'IMPORTEDCODE0001', ref_code: 'PR-IMP001' }, as('import'));
    expect([brought['share_token'], brought['ref_code']]).toEqual(['IMPORTEDCODE0001', 'PR-IMP001']);
    const undone = await w.create('projects', { name: 'Put back', share_token: null, ref_code: null }, as('undo'));
    expect([undone['share_token'] ?? null, undone['ref_code'] ?? null]).toEqual([null, null]);
  });
});
