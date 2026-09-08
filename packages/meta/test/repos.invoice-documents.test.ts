// SPDX-License-Identifier: AGPL-3.0-only
/**
 * invoiceDocumentsRepo — the 34-T46 verbs (34-invoices-add-on.md §3.9,
 * Appendix G; wave 0027).
 *
 * The assertions that carry the wave are the three placements, because the
 * manager's order IS the comp's array order and the comp never sorts: a new
 * document is prepended, a duplicate lands DIRECTLY after its source, a
 * language variation lands after the LAST of its topic. Beside them: a
 * family comes back in the six-language order whatever order it was written
 * in, and the tab badges ignore every filter.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  firstRun,
  invoiceDocumentsRepo,
  invoiceLangRank,
  usersRepo,
  type CreateInvoiceDocumentInput,
  type InvoiceDocumentsRepo,
  type InvoiceSummary,
} from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const T0 = 1_750_000_000_000;

const SUMMARY: InvoiceSummary = {
  number: 'INV-1000',
  customerName: 'Northwind Traders',
  title: 'INVOICE',
  logoText: 'Orchard Lane',
  logoIcon: 'hexagon',
  accent: '#4f46e5',
  currency: '$',
  cents: true,
  totalMinor: 410_400,
  itemCount: 3,
};

/** A body with every JSON shape the envelope carries: nested lists, unicode, booleans, a float. */
const BODY = {
  accent: '#4f46e5',
  title: 'INVOICE',
  from: ['Orchard Lane Studio', '48 Orchard Lane, Portland, OR 97209'],
  items: [{ id: 'i_1', desc: 'Brand identity — design retainer', qty: '1', rate: '2400' }],
  taxLines: [{ label: 'State tax', rate: '6' }],
  cents: true,
  bgTint: 0.82,
  fx: [{ code: 'EUR', sym: '€', rate: '0.92' }],
  notes: '30日以内にお支払いください。',
  custom: [],
  blockOrder: ['parties', 'items', 'totals'],
};

function input(over: Partial<CreateInvoiceDocumentInput> & { name: string }): CreateInvoiceDocumentInput {
  return { kind: 'template', body: BODY, summary: SUMMARY, ...over };
}

describe('pure helpers', () => {
  it('invoiceLangRank is the comp’s fixed order, unknown codes last', () => {
    expect(['ja', 'en', 'pt', 'fr', 'xx', 'de', 'es'].sort((a, b) => invoiceLangRank(a) - invoiceLangRank(b))).toEqual([
      'en',
      'de',
      'fr',
      'es',
      'pt',
      'ja',
      'xx',
    ]);
  });
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`invoice documents repo [${dialect.name}]`, () => {
    let t: TestDb;
    let repo: InvoiceDocumentsRepo;
    let userId: string;

    beforeEach(async () => {
      t = await dialect.make();
      await firstRun(t.meta);
      repo = invoiceDocumentsRepo(t.meta);
      userId = (await usersRepo(t.meta).create({ email: 'ava@adminium.test', name: 'Ava' })).id;
    });
    afterEach(async () => {
      await t.destroy();
    });

    async function names(kind: 'template' | 'invoice'): Promise<string[]> {
      return (await repo.list({ kind })).map((row) => row.name);
    }

    it('create decodes the whole row, defaults the enums, and a first placement prepends', async () => {
      const a = await repo.create(input({ name: 'A', starter: 'standard', number: 'INV-1000', createdBy: userId }), T0);
      expect(a).toMatchObject({
        kind: 'template',
        name: 'A',
        status: 'draft',
        topic: 'other',
        lang: 'en',
        number: 'INV-1000',
        starter: 'standard',
        originId: null,
        position: 0,
        createdBy: userId,
        createdAt: T0,
        updatedAt: T0,
      });
      expect(a.id.startsWith('inv_')).toBe(true);
      // The body round-trips structurally (jsonb reorders keys — compare shapes, not text).
      expect(a.body).toEqual(BODY);
      expect(a.summary).toEqual(SUMMARY);

      const b = await repo.create(input({ name: 'B', status: 'live', topic: 'sales', lang: 'de' }), T0 + 1);
      const c = await repo.create(input({ name: 'C' }), T0 + 2, { at: 'first' });
      expect(b.position).toBe(-1);
      expect(c.position).toBe(-2);
      expect(await names('template')).toEqual(['C', 'B', 'A']);
      expect(await repo.findById('inv_missing')).toBeNull();
    });

    it('a duplicate lands directly after its source, and the rows past it move down', async () => {
      await repo.create(input({ name: 'A' }), T0);
      const b = await repo.create(input({ name: 'B' }), T0 + 1);
      await repo.create(input({ name: 'C' }), T0 + 2);
      // List is C, B, A. A copy of B goes between B and A.
      const copy = await repo.create(input({ name: 'B (copy)' }), T0 + 3, { after: b.id });
      expect(await names('template')).toEqual(['C', 'B', 'B (copy)', 'A']);
      expect(copy.position).toBe(b.position + 1);
      // Positions stay distinct within the kind after the shift.
      const positions = (await repo.list({ kind: 'template' })).map((row) => row.position);
      expect(new Set(positions).size).toBe(positions.length);
      expect(positions).toEqual([...positions].sort((x, y) => x - y));
      // The other kind is untouched by the shift.
      const inv = await repo.create(input({ name: 'I', kind: 'invoice' }), T0 + 4);
      await repo.create(input({ name: 'B2 (copy)' }), T0 + 5, { after: b.id });
      expect((await repo.findById(inv.id))?.position).toBe(inv.position);
      expect(await names('template')).toEqual(['C', 'B', 'B2 (copy)', 'B (copy)', 'A']);
    });

    it('a source that is gone or of another kind places the copy at the end', async () => {
      const a = await repo.create(input({ name: 'A' }), T0);
      await repo.create(input({ name: 'B' }), T0 + 1);
      const inv = await repo.create(input({ name: 'I', kind: 'invoice' }), T0 + 2);
      await repo.create(input({ name: 'Orphan' }), T0 + 3, { after: 'inv_gone' });
      await repo.create(input({ name: 'Cross' }), T0 + 4, { after: inv.id });
      expect(await names('template')).toEqual(['B', 'A', 'Orphan', 'Cross']);
      expect((await repo.findById(a.id))?.position).toBe(0);
    });

    it('a language variation lands after the last of its topic; a topic with no rows goes to the end', async () => {
      await repo.create(input({ name: 'Sales en', topic: 'sales' }), T0);
      await repo.create(input({ name: 'Services en', topic: 'services' }), T0 + 1);
      await repo.create(input({ name: 'Sales fr', topic: 'sales', lang: 'fr' }), T0 + 2);
      await repo.create(input({ name: 'Receipts en', topic: 'receipts' }), T0 + 3);
      // List: Receipts en, Sales fr, Services en, Sales en. The last sales row is "Sales en".
      await repo.create(input({ name: 'Sales de', topic: 'sales', lang: 'de' }), T0 + 4, {
        afterTopic: { kind: 'template', topic: 'sales' },
      });
      expect(await names('template')).toEqual(['Receipts en', 'Sales fr', 'Services en', 'Sales en', 'Sales de']);
      await repo.create(input({ name: 'Logistics de', topic: 'logistics', lang: 'de' }), T0 + 5, {
        afterTopic: { kind: 'template', topic: 'logistics' },
      });
      expect(await names('template')).toEqual(['Receipts en', 'Sales fr', 'Services en', 'Sales en', 'Sales de', 'Logistics de']);
      // A variation of an invoice family never counts template rows of the same topic.
      await repo.create(input({ name: 'Inv sales ja', kind: 'invoice', topic: 'sales', lang: 'ja' }), T0 + 6, {
        afterTopic: { kind: 'invoice', topic: 'sales' },
      });
      expect(await names('invoice')).toEqual(['Inv sales ja']);
      expect((await repo.findById((await repo.list({ kind: 'invoice' }))[0]!.id))?.position).toBe(0);
    });

    it('siblings come back in the six-language order however they were written, one kind at a time', async () => {
      await repo.create(input({ name: 'ja', topic: 'sales', lang: 'ja' }), T0);
      await repo.create(input({ name: 'en', topic: 'sales', lang: 'en' }), T0 + 1);
      await repo.create(input({ name: 'pt', topic: 'sales', lang: 'pt' }), T0 + 2);
      await repo.create(input({ name: 'de', topic: 'sales', lang: 'de' }), T0 + 3);
      await repo.create(input({ name: 'other topic', topic: 'services', lang: 'fr' }), T0 + 4);
      await repo.create(input({ name: 'invoice es', kind: 'invoice', topic: 'sales', lang: 'es' }), T0 + 5);
      expect((await repo.siblings('template', 'sales')).map((row) => row.lang)).toEqual(['en', 'de', 'pt', 'ja']);
      expect((await repo.siblings('invoice', 'sales')).map((row) => row.name)).toEqual(['invoice es']);
      expect(await repo.siblings('template', 'logistics')).toEqual([]);
      // Two rows in the same language keep their list order (a comp quirk the route allows).
      await repo.create(input({ name: 'en again', topic: 'sales', lang: 'en' }), T0 + 6);
      expect((await repo.siblings('template', 'sales')).map((row) => row.name)).toEqual(['en again', 'en', 'de', 'pt', 'ja']);
    });

    it('counts ignore every filter; list honours the kind', async () => {
      await repo.create(input({ name: 'T1' }), T0);
      await repo.create(input({ name: 'T2' }), T0 + 1);
      await repo.create(input({ name: 'I1', kind: 'invoice', number: 'INV-1001' }), T0 + 2);
      expect(await repo.counts()).toEqual({ template: 2, invoice: 1 });
      expect((await repo.list({ kind: 'invoice' })).map((row) => row.name)).toEqual(['I1']);
      // Unfiltered: position first, then id — T1 and I1 tie at 0 and T1's id is older.
      expect((await repo.list()).map((row) => row.name)).toEqual(['T2', 'T1', 'I1']);
      expect(await repo.numberExists('invoice', 'INV-1001')).toBe(true);
      expect(await repo.numberExists('template', 'INV-1001')).toBe(false);
      expect(await repo.numberExists('invoice', 'INV-1002')).toBe(false);
    });

    it('patch changes what it is given, re-reads the row, and returns null for a stranger', async () => {
      const row = await repo.create(input({ name: 'Before' }), T0);
      const renamed = await repo.patch(row.id, { name: 'After' }, T0 + 10);
      expect(renamed).toMatchObject({ name: 'After', status: 'draft', updatedAt: T0 + 10 });
      expect(renamed?.body).toEqual(BODY);

      const body = { ...BODY, title: 'RECHNUNG', items: [] };
      const summary = { ...SUMMARY, title: 'RECHNUNG', number: 'INV-1002', totalMinor: 0, itemCount: 0 };
      const saved = await repo.patch(
        row.id,
        { status: 'sent', topic: 'sales', lang: 'de', body, summary, number: 'INV-1002' },
        T0 + 20,
      );
      expect(saved).toMatchObject({ name: 'After', status: 'sent', topic: 'sales', lang: 'de', number: 'INV-1002', updatedAt: T0 + 20 });
      expect(saved?.body).toEqual(body);
      expect(saved?.summary).toEqual(summary);
      expect(await repo.patch('inv_missing', { name: 'x' }, T0)).toBeNull();
      // The enums are validated on the way in.
      await expect(repo.patch(row.id, { status: 'archived' as never }, T0)).rejects.toThrow();
      await expect(repo.create(input({ name: 'bad', lang: 'xx' as never }), T0)).rejects.toThrow();
    });

    it('removeById is a hard delete and answers whether a row went', async () => {
      const a = await repo.create(input({ name: 'A', number: 'INV-1001', kind: 'invoice', originId: 'inv_TEMPLATE' }), T0);
      expect(a.originId).toBe('inv_TEMPLATE');
      expect(await repo.removeById(a.id)).toBe(true);
      expect(await repo.removeById(a.id)).toBe(false);
      expect(await repo.findById(a.id)).toBeNull();
      expect(await repo.counts()).toEqual({ template: 0, invoice: 0 });
    });

    it('a deleted creator leaves the row with created_by null (the one FK)', async () => {
      const a = await repo.create(input({ name: 'A', createdBy: userId }), T0);
      await t.meta.db.deleteFrom('adminium_users').where('id', '=', userId).execute();
      expect((await repo.findById(a.id))?.createdBy).toBeNull();
    });
  });
}
