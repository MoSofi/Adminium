// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's one settings row in its sample data (`"@onlyIfEmpty": true`): added
 * when the operator has none, left out when they have theirs — the sample
 * never stops on it and never takes it over.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'settings', rows: [{ '@label': 'studio', '@onlyIfEmpty': true, invoice_prefix: 'SMP-', tax_rate: 8.5 }] },
    { ref: 'clients', rows: [{ email: 'ann@sample.example', name: 'Ann', tax_rate: 8.5 }] },
  ],
};

/** A table only for an empty table as a whole: every row in, or none (the kitchen's hours, set before the sample). */
const WHOLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'settings', rows: [{ '@label': 'studio', '@onlyIfEmpty': true, invoice_prefix: 'SMP-', tax_rate: 8.5 }] },
    { ref: 'clients', onlyIfEmpty: true, rows: [{ email: 'ann@sample.example', name: 'Ann' }, { email: 'bo@sample.example', name: 'Bo' }] },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`the app's one settings row in its sample data on ${dialect}`, () => {
    const harnesses: InvoicingHarness[] = [];

    const withSample = async (operatorFirst: boolean, bundle: unknown = BUNDLE) => {
      const manifest = { ...invoicingManifest(), sampleData: { file: 'seeds/studio.sample.json' } };
      const h = await installInvoicing(dialect, manifest, undefined, { 'seeds/studio.sample.json': JSON.stringify(bundle) });
      harnesses.push(h);
      if (operatorFirst) await h.rows(`INSERT INTO ${h.real('settings')} (singleton, invoice_prefix) VALUES ('studio', 'OWN-')`);
      if (operatorFirst && bundle === WHOLE) await h.rows(`INSERT INTO ${h.real('clients')} (email, name) VALUES ('own@studio.example', 'Own')`);
      const service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      const added = await service.add((await findSampleApp(h.meta, 'studio'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
      return { h, added };
    };

    let empty: Awaited<ReturnType<typeof withSample>>;
    let theirs: Awaited<ReturnType<typeof withSample>>;
    let wholeEmpty: Awaited<ReturnType<typeof withSample>>;
    let wholeTheirs: Awaited<ReturnType<typeof withSample>>;
    beforeAll(async () => {
      empty = await withSample(false);
      theirs = await withSample(true);
      wholeEmpty = await withSample(false, WHOLE);
      wholeTheirs = await withSample(true, WHOLE);
    }, 240_000);

    afterAll(async () => {
      for (const h of harnesses) await h.close();
    });

    it('adds the sample studio’s settings when the operator has none', async () => {
      expect(await empty.h.rows(`SELECT invoice_prefix FROM ${empty.h.real('settings')}`)).toEqual([{ invoice_prefix: 'SMP-' }]);
      expect(empty.added.counts).toEqual({ settings: 1, clients: 1 });
    });

    it('keeps the operator’s own settings, adds the rest, and does not count theirs as sample data', async () => {
      expect(await theirs.h.rows(`SELECT invoice_prefix FROM ${theirs.h.real('settings')}`)).toEqual([{ invoice_prefix: 'OWN-' }]);
      expect(theirs.added.counts).toEqual({ clients: 1 });
    });

    it('adds every row of a table only for an empty table when it has none', async () => {
      expect(wholeEmpty.added.counts).toEqual({ settings: 1, clients: 2 });
    });

    it('leaves the whole table out when the operator has a row in it, and adds the rest', async () => {
      expect(await wholeTheirs.h.rows(`SELECT email FROM ${wholeTheirs.h.real('clients')}`)).toEqual([{ email: 'own@studio.example' }]);
      expect(wholeTheirs.added.counts).toEqual({});
    });
  });
}
