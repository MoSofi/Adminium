// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sample data whose rows copy a total an earlier table keeps.
 *
 * A stage of a proposal is invoiced by one line whose rate is copied from the
 * proposal's total — a total the loader works out from the proposal's own
 * lines. The copy reads the proposal as it stands when the line is written,
 * so the totals so far must be settled before a later table's rows go in;
 * settled only at the end, every such line would load at nothing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MetaDb } from '@adminium/meta';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { LEGS, installInvoicing, invoicingManifest, invoicingTables, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 'currency', nullable: true, ...(rules === undefined ? {} : { rules }) });

/** The studio's tables, with a proposal total and a stage line that copies it. */
function tables(): Record<string, unknown>[] {
  const all = invoicingTables();
  const byRef = (ref: string) => all.find((t) => t['ref'] === ref) as { columns: Record<string, unknown>[] };
  byRef('proposals').columns.push(money('total', { rollup: { from: 'proposal_lines', via: 'proposal_id', sum: 'amount' } }));
  const lines = byRef('invoice_lines').columns;
  lines.splice(
    lines.findIndex((c) => c['ref'] === 'rate'),
    1,
    { ref: 'quote_id', type: 'fk', references: 'proposals', nullable: true },
    money('rate', { copy: { via: 'quote_id', from: 'total', mode: 'always' } }),
  );
  // Proposals ahead of the invoices, as a bundle lists them: parents first.
  const order = ['settings', 'clients', 'proposals', 'proposal_lines'];
  return [...order.map((ref) => all.find((t) => t['ref'] === ref)!), ...all.filter((t) => !order.includes(t['ref'] as string))];
}

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'clients', rows: [{ '@label': 'ann', email: 'ann@sample.example', name: 'Ann' }] },
    { ref: 'proposals', rows: [{ '@label': 'p1', client_id: { '@ref': 'ann' }, status: 'accepted' }] },
    {
      ref: 'proposal_lines',
      rows: [
        { proposal_id: { '@ref': 'p1' }, position: 1, amount: 1200 },
        { proposal_id: { '@ref': 'p1' }, position: 2, amount: 800 },
      ],
    },
    { ref: 'invoices', rows: [{ '@label': 'i1', client_id: { '@ref': 'ann' }, number_seq: null, number: 'INV-S1', status: 'draft', tax_rate: 0 }] },
    { ref: 'invoice_lines', rows: [{ invoice_id: { '@ref': 'i1' }, quote_id: { '@ref': 'p1' }, qty: 0.5 }] },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sample rows that copy an earlier total on ${dialect}`, () => {
    let h: InvoicingHarness;
    let meta: MetaDb;

    beforeAll(async () => {
      const manifest = { ...invoicingManifest(tables()), sampleData: { file: 'seeds/studio.sample.json' } };
      h = await installInvoicing(dialect, manifest, undefined, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) });
      meta = h.meta;
      const service = createSampleDataService({ meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      await service.add((await findSampleApp(meta, 'studio'))!, { locale: 'en-US', userId: null, userLabel: 'test', now: Date.now() });
    }, 120_000);

    afterAll(async () => {
      await h?.close();
    });

    it('writes a stage line with the proposal’s total as it is once its lines are in, and the invoice from that', async () => {
      const [line] = await h.rows(`SELECT rate, amount FROM ${h.real('invoice_lines')}`);
      expect(Number(line!['rate'])).toBe(2000);
      expect(Number(line!['amount'])).toBe(1000);
      const [invoice] = await h.rows(`SELECT subtotal, total FROM ${h.real('invoices')}`);
      expect(Number(invoice!['subtotal'])).toBe(1000);
      expect(Number(invoice!['total'])).toBe(1000);
      const [proposal] = await h.rows(`SELECT total FROM ${h.real('proposals')}`);
      expect(Number(proposal!['total'])).toBe(2000);
    });
  });
}
