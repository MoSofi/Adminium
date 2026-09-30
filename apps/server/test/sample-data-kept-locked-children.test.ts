// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAMPLE DATA REMOVED AND ADDED AGAIN AROUND A ROW THE OPERATOR'S RECORD LOCKS.
 *
 * The sample writes a terms version in force with its clauses; the clauses are
 * locked with the version (`children: {clauses: {lock: true}}`), and a proposal
 * sent on the version locks it (`lockedWhenReferencedBy`). The operator sends a
 * proposal of their own on the sample's terms, then removes the sample.
 *
 * The removal kept the version (the proposal uses it) but deleted its clauses:
 * a kept row kept only what it points at, never the rows tied to it. The sent
 * proposal's terms lost their text, and the next add wrote the sample's clauses
 * under the locked version again, which the lock refused ("clauses rows cannot
 * change while their terms is in_force"): Client Portal could never add its
 * sample again once a real proposal had used its terms.
 *
 * A kept row now keeps the rows its lock ties to it. The next add takes the
 * version and its clauses back as they are and writes nothing under the lock;
 * a staff change of a clause is refused as before.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAppStore } from '../src/apps/store.js';
import { createSampleDataService, findSampleApp, type SampleApp } from '../src/apps/sample-data.js';
import type { FileStore } from '../src/files/store.js';
import { installInvoicing, invoicingManifest, LEGS, writerFor, type InvoicingHarness } from './invoicing-install.helpers.js';

const memoryFiles = {
  write: async () => ({ storageKey: 'x', sizeBytes: 0, sha256: '', destinationId: null, storage: 'memory' }),
} as unknown as FileStore;

const id = { ref: 'id', type: 'int', role: 'pk' };

const TABLES = [
  {
    ref: 'terms',
    columns: [id, { ref: 'title', type: 'text', maxLength: 80 }, { ref: 'status', type: 'enum', enum: ['draft', 'in_force', 'retired'], default: 'draft' }],
    states: {
      column: 'status',
      initial: 'draft',
      moves: { draft: ['in_force'], in_force: ['retired'] },
      lock: { when: ['retired'] },
      children: { clauses: { via: 'terms_id', lock: true } },
      lockedWhenReferencedBy: [{ table: 'proposals', via: 'terms_id', in: ['sent'] }],
    },
  },
  {
    ref: 'clauses',
    columns: [id, { ref: 'terms_id', type: 'fk', references: 'terms' }, { ref: 'position', type: 'int', default: 0 }, { ref: 'title', type: 'text', maxLength: 80 }],
  },
  {
    ref: 'proposals',
    columns: [
      id,
      { ref: 'title', type: 'text', maxLength: 80 },
      { ref: 'terms_id', type: 'fk', references: 'terms', nullable: true },
      { ref: 'status', type: 'enum', enum: ['draft', 'sent'], default: 'draft' },
    ],
    states: { column: 'status', initial: 'draft', moves: { draft: ['sent'] } },
  },
];

const BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'terms', rows: [{ '@label': 'terms:standard', title: 'Standard terms', status: 'in_force' }] },
    {
      ref: 'clauses',
      rows: [
        { terms_id: { '@ref': 'terms:standard' }, position: 1, title: { '@t': { 'en-US': 'Payment', 'de-DE': 'Zahlung' } } },
        { terms_id: { '@ref': 'terms:standard' }, position: 2, title: { '@t': { 'en-US': 'Delivery', 'de-DE': 'Lieferung' } } },
        { terms_id: { '@ref': 'terms:standard' }, position: 3, title: { '@t': { 'en-US': 'Cancellation', 'de-DE': 'Storno' } } },
      ],
    },
    { ref: 'proposals', rows: [{ title: 'A sample proposal', terms_id: { '@ref': 'terms:standard' } }] },
  ],
};

const manifest = (tables: Record<string, unknown>[] = TABLES) => ({
  ...invoicingManifest(tables),
  pages: [
    {
      ref: 'studio-proposals',
      template: 'page-crud',
      title: { key: 't', fallback: 'Proposals' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'proposals' },
    },
  ],
  sampleData: { file: 'seeds/studio.sample.json' },
});

/** The same terms, with a note on the first clause: a row pointing at a clause by its label. */
const NOTED_TABLES = [
  ...TABLES.slice(0, 2),
  {
    ref: 'clause_notes',
    columns: [id, { ref: 'clause_id', type: 'fk', references: 'clauses' }, { ref: 'note', type: 'text', maxLength: 80 }, { ref: 'noted_at', type: 'timestamptz', nullable: true }],
  },
  TABLES[2]!,
];
const NOTED_BUNDLE = {
  ...BUNDLE,
  tables: [
    BUNDLE.tables[0]!,
    { ref: 'clauses', rows: BUNDLE.tables[1]!.rows.map((row, i) => (i === 0 ? { '@label': 'clause:payment', ...row } : i === 1 ? { '@label': 'clause:delivery', ...row } : row)) },
    {
      ref: 'clause_notes',
      rows: [
        { clause_id: { '@ref': 'clause:payment' }, note: 'See the schedule' },
        // Written a day ago, on the delivery clause; only a branch never chosen for it names the payment clause.
        {
          clause_id: { '@ref': 'clause:delivery' },
          note: 'Agreed on the call',
          noted_at: { '@ago': 'P1D' },
          '@byClock': { at: 'noted_at', after: { clause_id: { '@ref': 'clause:payment' } } },
        },
      ],
    },
    BUNDLE.tables[2]!,
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sample data around a row the operator's record locks, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let w: Awaited<ReturnType<typeof writerFor>>;
    let service: ReturnType<typeof createSampleDataService>;
    let app: SampleApp;
    const user = { locale: 'en-US', userId: null, userLabel: 'test' };
    const german = { ...user, locale: 'de-DE' };
    const who = { keepChanged: true, userId: null, userLabel: 'test' };
    const rows = (ref: string, columns = 'id') => h.rows(`SELECT ${columns} FROM ${h.real(ref)} ORDER BY id`);
    const titles = async () => (await rows('clauses', 'title')).map((r) => r['title']);

    /** The sample added, then your own proposal on its terms (sent when asked), then the sample removed. */
    async function removedAroundYourProposal(sent: boolean) {
      await service.add(app, user);
      const [terms] = await rows('terms');
      const own = await w.create('proposals', { title: 'Fern Studio website', terms_id: terms!['id'] });
      if (sent) await h.rows(`UPDATE ${h.real('proposals')} SET status = 'sent' WHERE id = ${String(own['id'])}`);
      const clauses = await rows('clauses', 'id, title');
      expect(await service.remove(app, who)).toMatchObject({ removed: 1, kept: 4 });
      return { terms: terms!, own, clauses };
    }

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(), undefined, { 'seeds/studio.sample.json': JSON.stringify(BUNDLE) });
      w = await writerFor(h);
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      app = (await findSampleApp(h.meta, 'studio'))!;
    }, 120_000);

    // Each case starts from an empty install: no rows, no ledger entries.
    beforeEach(async () => {
      for (const ref of ['proposals', 'clauses', 'terms']) await h.rows(`DELETE FROM ${h.real(ref)}`);
      await h.rows(`DELETE FROM ${h.real('sample_data')}`).catch(() => undefined);
    });

    afterAll(async () => {
      await h?.close();
    });

    it('keeps the clauses of the terms your sent proposal uses, and takes both back on the next add', async () => {
      const { terms, own, clauses } = await removedAroundYourProposal(true);
      await expect(w.update('clauses', clauses[0]!['id'], { title: 'Payment in advance' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });
      // The sample proposal went; the terms stayed, with every clause your proposal prints.
      expect(await rows('terms', 'id, status')).toEqual([{ id: terms['id'], status: 'in_force' }]);
      expect(await rows('clauses', 'id, title')).toEqual(clauses);
      expect((await service.status(app)).loaded).toBe(false);

      // Added again: the terms and their clauses are the sample's again, as they are; nothing is written under the lock.
      expect((await service.add(app, user)).counts).toEqual({ terms: 1, clauses: 3, proposals: 1 });
      expect(await rows('terms', 'id')).toEqual([{ id: terms['id'] }]);
      expect(await rows('clauses', 'id, title')).toEqual(clauses);
      expect(await rows('proposals', 'title')).toEqual([{ title: 'Fern Studio website' }, { title: 'A sample proposal' }]);
      expect(await service.status(app)).toMatchObject({ loaded: true, total: 5 });

      // Still locked for everyone else: the add took the clauses back, it did not open them.
      await expect(w.update('clauses', clauses[1]!['id'], { title: 'Delivery by courier' })).rejects.toMatchObject({ code: 'RECORD_LOCKED' });

      // Once your proposal is gone, nothing of yours uses the terms: the next removal takes all of it.
      await h.rows(`DELETE FROM ${h.real('proposals')} WHERE id = ${String(own['id'])}`);
      expect(await service.remove(app, who)).toMatchObject({ removed: 5, kept: 0 });
      expect(await rows('terms')).toEqual([]);
      expect(await rows('clauses')).toEqual([]);
    }, 120_000);

    it('takes the clauses back as they are when someone else adds the sample again in another language', async () => {
      const { terms, clauses } = await removedAroundYourProposal(true);
      // The sample's clauses read in German now; the terms your client was sent keep their own.
      expect((await service.add(app, german)).counts).toEqual({ terms: 1, clauses: 3, proposals: 1 });
      expect(await rows('terms', 'id')).toEqual([{ id: terms['id'] }]);
      expect(await rows('clauses', 'id, title')).toEqual(clauses);
      expect(await service.status(app)).toMatchObject({ loaded: true, total: 5 });
    }, 120_000);

    it('never adds a second set of clauses to terms your draft uses, whatever they read as today', async () => {
      // A draft does not lock the terms; the clauses are still theirs, and the terms keep the ones they have.
      const { terms, clauses } = await removedAroundYourProposal(false);
      expect((await service.add(app, german)).counts).toEqual({ terms: 1, clauses: 3, proposals: 1 });
      expect(await rows('terms', 'id')).toEqual([{ id: terms['id'] }]);
      expect(await titles()).toEqual(['Payment', 'Delivery', 'Cancellation']);
      expect(await rows('clauses', 'id, title')).toEqual(clauses);
    }, 120_000);

    it('leaves a clause you changed as yours, and writes no clause beside it', async () => {
      await service.add(app, user);
      const [terms] = await rows('terms');
      const own = await w.create('proposals', { title: 'Juniper rebrand', terms_id: terms!['id'] });
      const [payment] = await rows('clauses');
      // Changed while your proposal was a draft, then sent: from then on it is locked.
      await w.update('clauses', payment!['id'], { title: 'Payment within 14 days' });
      await h.rows(`UPDATE ${h.real('proposals')} SET status = 'sent' WHERE id = ${String(own['id'])}`);
      expect(await service.remove(app, who)).toMatchObject({ removed: 1, kept: 4 });

      expect((await service.add(app, user)).counts).toEqual({ terms: 1, clauses: 2, proposals: 1 });
      expect(await titles()).toEqual(['Payment within 14 days', 'Delivery', 'Cancellation']);
      // Yours now: the next removal leaves it (and the terms it is locked in, which your proposal uses) alone.
      expect(await service.status(app)).toMatchObject({ loaded: true, total: 4 });
    }, 120_000);

    it('adds the sample again over terms an earlier removal already stripped, writing nothing under them', async () => {
      // As a removal before this fix left it: the terms kept for your sent proposal, their clauses gone.
      const { terms } = await removedAroundYourProposal(true);
      await h.rows(`DELETE FROM ${h.real('clauses')}`);
      await h.rows(`DELETE FROM ${h.real('sample_data')} WHERE table_ref = '@kept:clauses'`);

      // Their clauses cannot come back; the sample writes none under terms a client was sent, and lands.
      expect((await service.add(app, user)).counts).toEqual({ terms: 1, proposals: 1 });
      expect(await rows('terms', 'id')).toEqual([{ id: terms['id'] }]);
      expect(await rows('clauses')).toEqual([]);
      expect(await rows('proposals', 'title')).toEqual([{ title: 'Fern Studio website' }, { title: 'A sample proposal' }]);
    }, 120_000);
  });
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sample rows pointing at a line of a record the operator uses, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let w: Awaited<ReturnType<typeof writerFor>>;
    let service: ReturnType<typeof createSampleDataService>;
    let app: SampleApp;
    const user = { locale: 'en-US', userId: null, userLabel: 'test' };
    const who = { keepChanged: true, userId: null, userLabel: 'test' };
    const rows = (ref: string, columns = 'id') => h.rows(`SELECT ${columns} FROM ${h.real(ref)} ORDER BY id`);

    /** The sample added, your own draft on its terms, the first clause changed when asked, then the sample removed. */
    async function removedAroundYourDraft(change: boolean) {
      await service.add(app, user);
      const [terms] = await rows('terms');
      await w.create('proposals', { title: 'Fern Studio website', terms_id: terms!['id'] });
      const clauses = await rows('clauses');
      if (change) await w.update('clauses', clauses[0]!['id'], { title: 'Payment within 14 days' });
      await service.remove(app, who);
      return { clauses };
    }

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(NOTED_TABLES), undefined, { 'seeds/studio.sample.json': JSON.stringify(NOTED_BUNDLE) });
      w = await writerFor(h);
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      app = (await findSampleApp(h.meta, 'studio'))!;
    }, 120_000);

    beforeEach(async () => {
      for (const ref of ['clause_notes', 'proposals', 'clauses', 'terms']) await h.rows(`DELETE FROM ${h.real(ref)}`);
      await h.rows(`DELETE FROM ${h.real('sample_data')}`).catch(() => undefined);
    });

    afterAll(async () => {
      await h?.close();
    });

    it('points the sample note at the clause it takes back', async () => {
      const { clauses } = await removedAroundYourDraft(false);
      expect(await rows('clause_notes')).toEqual([]);
      expect((await service.add(app, user)).counts).toEqual({ terms: 1, clauses: 3, clause_notes: 2, proposals: 1 });
      expect(await rows('clauses')).toEqual(clauses);
      expect(await rows('clause_notes', 'clause_id')).toEqual([{ clause_id: clauses[0]!['id'] }, { clause_id: clauses[1]!['id'] }]);
    }, 120_000);

    it('leaves out the note of a clause you changed, and adds the rest', async () => {
      const { clauses } = await removedAroundYourDraft(true);
      // The clause is yours now: the sample writes no second one beside it, and no note on it. The note on the
      // delivery clause is written: only a branch never chosen for it names the payment clause.
      expect((await service.add(app, user)).counts).toEqual({ terms: 1, clauses: 2, clause_notes: 1, proposals: 1 });
      expect((await rows('clauses', 'title')).map((r) => r['title'])).toEqual(['Payment within 14 days', 'Delivery', 'Cancellation']);
      expect(await rows('clause_notes', 'clause_id, note')).toEqual([{ clause_id: clauses[1]!['id'], note: 'Agreed on the call' }]);
      expect(await service.status(app)).toMatchObject({ loaded: true });
    }, 120_000);

    it('leaves out the notes of clauses an earlier removal stripped, and adds the rest', async () => {
      await removedAroundYourDraft(false);
      await h.rows(`DELETE FROM ${h.real('clauses')}`);
      await h.rows(`DELETE FROM ${h.real('sample_data')} WHERE table_ref = '@kept:clauses'`);
      expect((await service.add(app, user)).counts).toEqual({ terms: 1, proposals: 1 });
      expect(await rows('clauses')).toEqual([]);
      expect(await rows('clause_notes')).toEqual([]);
    }, 120_000);
  });
}

/** An order locks its lines; a line's price counts its chosen options; a customer counts its orders. */
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 'currency', nullable: true, ...(rules === undefined ? {} : { rules }) });
const ORDER_TABLES = [
  { ref: 'customers', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'order_count', type: 'int', nullable: true, rules: { rollup: { from: 'orders', via: 'customer_id', count: true } } }] },
  {
    ref: 'orders',
    columns: [
      id,
      { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
      { ref: 'code', type: 'text', maxLength: 20 },
      { ref: 'status', type: 'enum', enum: ['placed', 'picked_up'], default: 'placed' },
    ],
    states: { column: 'status', initial: 'placed', moves: { placed: ['picked_up'] }, lock: { when: ['picked_up'] }, children: { order_items: { via: 'order_id', lock: true } } },
  },
  {
    ref: 'order_items',
    columns: [
      id,
      { ref: 'order_id', type: 'fk', references: 'orders' },
      { ref: 'name', type: 'text', maxLength: 80 },
      money('options_total', { rollup: { from: 'order_item_modifiers', via: 'order_item_id', sum: 'price_delta' } }),
    ],
  },
  {
    ref: 'order_item_modifiers',
    unique: [['order_item_id', 'name']],
    columns: [id, { ref: 'order_item_id', type: 'fk', references: 'order_items' }, { ref: 'name', type: 'text', maxLength: 80 }, money('price_delta')],
  },
  // The operator's own record: a pickup of an order.
  { ref: 'pickups', columns: [id, { ref: 'order_id', type: 'fk', references: 'orders' }] },
];
const ORDER_BUNDLE = {
  format: 'adminium.sample/1',
  app: 'studio',
  tables: [
    { ref: 'customers', rows: [{ '@label': 'customer:ann', name: 'Ann' }] },
    {
      ref: 'orders',
      rows: [
        { '@label': 'order:2107', customer_id: { '@ref': 'customer:ann' }, code: '#2107' },
        { '@label': 'order:2108', customer_id: { '@ref': 'customer:ann' }, code: '#2108' },
      ],
    },
    {
      ref: 'order_items',
      rows: [
        { '@label': 'line:flat-white', order_id: { '@ref': 'order:2107' }, name: 'Flat white' },
        { '@label': 'line:croissant', order_id: { '@ref': 'order:2107' }, name: 'Croissant' },
        { '@label': 'line:tea', order_id: { '@ref': 'order:2108' }, name: 'Tea' },
      ],
    },
    {
      ref: 'order_item_modifiers',
      rows: [
        { order_item_id: { '@ref': 'line:flat-white' }, name: { '@t': { 'en-US': 'Oat milk', 'de-DE': 'Hafermilch' } }, price_delta: '0.50' },
        { order_item_id: { '@ref': 'line:flat-white' }, name: { '@t': { 'en-US': 'Extra shot', 'de-DE': 'Extra Espresso' } }, price_delta: '0.80' },
        { order_item_id: { '@ref': 'line:tea' }, name: { '@t': { 'en-US': 'Honey', 'de-DE': 'Honig' } }, price_delta: '0.30' },
      ],
    },
  ],
};

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`sample orders whose lines count their options, on ${dialect}`, () => {
    let h: InvoicingHarness;
    let w: Awaited<ReturnType<typeof writerFor>>;
    let service: ReturnType<typeof createSampleDataService>;
    let app: SampleApp;
    const user = { locale: 'en-US', userId: null, userLabel: 'test' };
    const german = { ...user, locale: 'de-DE' };
    const who = { keepChanged: true, userId: null, userLabel: 'test' };
    const rows = (ref: string, columns = 'id') => h.rows(`SELECT ${columns} FROM ${h.real(ref)} ORDER BY id`);
    const options = async (): Promise<Record<string, unknown>[]> =>
      (await rows('order_item_modifiers', 'id, order_item_id, name, price_delta')).map((r) => ({ ...r, price_delta: Number(r['price_delta']) }));

    /** The sample added, your own pickup of order #2107, then the sample removed. */
    async function removedAroundYourPickup(beforeRemoval?: () => Promise<void>) {
      await service.add(app, user);
      const [order] = await rows('orders');
      await w.create('pickups', { order_id: order!['id'] });
      await beforeRemoval?.();
      const lines = await rows('order_items', 'id, name, options_total');
      const chosen = await options();
      return { order: order!, lines, chosen, removal: await service.remove(app, who) };
    }

    beforeAll(async () => {
      h = await installInvoicing(dialect, manifest(ORDER_TABLES), undefined, { 'seeds/studio.sample.json': JSON.stringify(ORDER_BUNDLE) });
      w = await writerFor(h);
      service = createSampleDataService({ meta: h.meta, manager: h.manager, store: createAppStore({ dataDir: h.dataDir }), files: memoryFiles });
      app = (await findSampleApp(h.meta, 'studio'))!;
    }, 120_000);

    beforeEach(async () => {
      for (const ref of ['pickups', 'order_item_modifiers', 'order_items', 'orders', 'customers']) await h.rows(`DELETE FROM ${h.real(ref)}`);
      await h.rows(`DELETE FROM ${h.real('sample_data')}`).catch(() => undefined);
    });

    afterAll(async () => {
      await h?.close();
    });

    it('keeps the options of a kept order’s lines, and takes all of it back as it is', async () => {
      const { order, lines, chosen, removal } = await removedAroundYourPickup();
      // #2108, its line and its option go; #2107 stays whole (its lines and their options), and so does Ann, whom it names.
      expect(removal).toMatchObject({ removed: 3, kept: 6 });
      expect(await rows('orders', 'id')).toEqual([{ id: order['id'] }]);
      expect(await rows('order_items', 'id, name, options_total')).toEqual(lines.slice(0, 2));
      expect(await options()).toEqual(chosen.slice(0, 2));

      // Added again in another language: #2107 comes back with the lines and options it has; #2108 is written again.
      expect((await service.add(app, german)).counts).toEqual({ customers: 1, orders: 2, order_items: 3, order_item_modifiers: 3 });
      expect((await rows('order_items', 'name')).map((r) => r['name'])).toEqual(['Flat white', 'Croissant', 'Tea']);
      expect((await options()).map((r) => r['name'])).toEqual(['Oat milk', 'Extra shot', 'Honig']);
      expect((await rows('order_items', 'id, name, options_total')).slice(0, 2)).toEqual(lines.slice(0, 2));
      expect(await service.status(app)).toMatchObject({ loaded: true, total: 9 });
    }, 120_000);

    it('keeps Ann but not the other orders she has: a customer is no order’s part', async () => {
      const { removal } = await removedAroundYourPickup();
      expect(removal).toMatchObject({ removed: 3, kept: 6 });
      expect((await rows('customers', 'name')).map((r) => r['name'])).toEqual(['Ann']);
      expect((await rows('orders', 'code')).map((r) => r['code'])).toEqual(['#2107']);
    }, 120_000);

    it('leaves an option you changed as yours, and writes none beside it', async () => {
      const { chosen } = await removedAroundYourPickup(async () => {
        const [, shot] = await rows('order_item_modifiers');
        await h.rows(`UPDATE ${h.real('order_item_modifiers')} SET price_delta = 1.00 WHERE id = ${String(shot!['id'])}`);
      });
      // The line keeps its two options, one of them yours now; the sample writes no second "Extra shot" (a line holds each option once).
      expect((await service.add(app, user)).counts).toEqual({ customers: 1, orders: 2, order_items: 3, order_item_modifiers: 2 });
      expect((await options()).slice(0, 2)).toEqual(chosen.slice(0, 2));
      expect((await options()).map((r) => r['name'])).toEqual(['Oat milk', 'Extra shot', 'Honey']);
    }, 120_000);
  });
}
