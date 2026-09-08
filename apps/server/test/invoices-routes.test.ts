// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoice-documents routes (34-invoices-add-on.md §3.9, Appendix G;
 * 34-T46) — driven through a bare Fastify app with the real rbac plugin and
 * an `x-test-user-id` header, the way `email-templates-routes.test.ts`
 * mounts the email surface.
 *
 * The assertions that carry the wave: a document minted from a starter
 * carries a summary whose total is the money law's; the tab badges never
 * respond to the kind filter; a save re-derives the summary and the number
 * from the on-screen body; a duplicate lands directly after its source; a
 * second language variation is a 409 that names the existing row; an
 * invoice built from a template remembers it and mints its own number; and
 * every write is a `settings.manage` power while every read is a session's.
 */
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteMetaDb, firstRun, invoiceDocumentsRepo, rolesRepo, usersRepo, type MetaDb, type Role, type User } from '@adminium/meta';

import { IMAGE_DATA_URL_MAX } from '../src/invoices/document.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { invoicesRoutes } from '../src/routes/invoices/index.js';
import type { InvoiceDetailView, InvoiceSummaryView } from '../src/routes/invoices/schema.js';
import { buildBareApp, type BareApp } from './jobs-helpers.js';

type ListReply = { items: InvoiceSummaryView[]; counts: { template: number; invoice: number } };
type ErrorReply = { error: { code: string; details: Record<string, unknown> } };

describe('invoice document routes (34-T46)', () => {
  let meta: MetaDb;
  let app: BareApp;
  let manager: User;
  let viewer: User;

  async function role(slug: string): Promise<Role> {
    const found = await rolesRepo(meta).findBySlug(slug);
    if (found === null) throw new Error(`missing built-in role ${slug}`);
    return found;
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    manager = await users.create({ email: 'ava@adminium.test', name: 'Ava', status: 'active' });
    viewer = await users.create({ email: 'liam@adminium.test', name: 'Liam', status: 'active' });
    await rolesRepo(meta).assignToUser(manager.id, (await role('super-admin')).id);
    await rolesRepo(meta).assignToUser(viewer.id, (await role('viewer')).id);

    app = buildBareApp();
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string' && id.length > 0) {
        (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
      }
    });
    await app.register(rbacPlugin, { meta });
    await app.register(invoicesRoutes({ meta }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  function as(user: User) {
    return { 'x-test-user-id': user.id };
  }

  async function create(body: Record<string, unknown>, user: User = manager): Promise<InvoiceDetailView> {
    const res = await app.inject({ method: 'POST', url: '/invoices', headers: as(user), payload: body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as InvoiceDetailView;
  }

  async function detail(id: string): Promise<InvoiceDetailView> {
    const res = await app.inject({ method: 'GET', url: `/invoices/${id}`, headers: as(viewer) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as InvoiceDetailView;
  }

  async function list(kind?: 'template' | 'invoice'): Promise<ListReply> {
    const res = await app.inject({ method: 'GET', url: kind === undefined ? '/invoices' : `/invoices?kind=${kind}`, headers: as(viewer) });
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as ListReply;
  }

  it('creates from a starter: the summary total is the law’s, the row facts are the starter’s, the body is complete', async () => {
    const doc = await create({ kind: 'template', starter: 'standard' });
    expect(doc).toMatchObject({
      kind: 'template',
      name: 'Standard invoice',
      status: 'draft',
      topic: 'recurring',
      lang: 'en',
      starter: 'standard',
      originId: null,
    });
    expect(doc.summary).toEqual({
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
    });
    expect(doc.body.number).toBe('INV-1000');
    expect(doc.body.shipShow).toBe(true);
    expect(doc.body.blockOrder).toHaveLength(23);
    expect(doc.languages).toEqual([{ id: doc.id, lang: 'en', name: 'Standard invoice', status: 'draft' }]);

    const receipt = await create({ kind: 'invoice', starter: 'receipt', name: 'Acme — receipt' });
    expect(receipt).toMatchObject({ kind: 'invoice', name: 'Acme — receipt', status: 'paid', topic: 'receipts' });
    expect(receipt.summary).toMatchObject({ number: 'INV-1001', title: 'RECEIPT', accent: '#12805c', totalMinor: 29_000, itemCount: 1 });
    expect(receipt.body.number).toBe('INV-1001');
    expect(receipt.body.payment[2]).toBe('Reference: INV-1001');

    const second = await create({ kind: 'invoice', starter: 'hourly' });
    expect(second.summary.number).toBe('INV-1002');

    const blank = await create({ kind: 'template' });
    expect(blank).toMatchObject({ name: 'Untitled template', starter: null, topic: 'other', status: 'draft' });
    expect(blank.body.customerName).toBe('Client name');
    expect(blank.summary.totalMinor).toBe(0);
    expect((await create({ kind: 'invoice' })).name).toBe('Untitled invoice');

    const bogus = await app.inject({ method: 'POST', url: '/invoices', headers: as(manager), payload: { kind: 'template', starter: 'late-reminder' } });
    expect(bogus.statusCode).toBe(422);
    expect((bogus.json() as ErrorReply).error.details).toEqual({ starter: 'late-reminder' });
  });

  it('lists each kind newest first with counts that ignore the filter, and serves the twelve starters', async () => {
    const t1 = await create({ kind: 'template', starter: 'standard' });
    const t2 = await create({ kind: 'template', starter: 'quote' });
    const i1 = await create({ kind: 'invoice', starter: 'receipt' });

    const templates = await list('template');
    expect(templates.items.map((i) => i.id)).toEqual([t2.id, t1.id]);
    expect(templates.counts).toEqual({ template: 2, invoice: 1 });
    const invoices = await list('invoice');
    expect(invoices.items.map((i) => i.id)).toEqual([i1.id]);
    expect(invoices.counts).toEqual({ template: 2, invoice: 1 });
    expect((await list()).items).toHaveLength(3);
    // A summary row never carries the body.
    expect('body' in (templates.items[0] as object)).toBe(false);

    const starters = await app.inject({ method: 'GET', url: '/invoices/starters', headers: as(viewer) });
    expect(starters.statusCode).toBe(200);
    const cards = (starters.json() as { starters: { key: string; category: string }[] }).starters;
    expect(cards).toHaveLength(12);
    expect(cards[0]).toEqual({ key: 'standard', name: 'Standard invoice', category: 'business', icon: 'file-text', title: 'INVOICE', accent: '#4f46e5' });
  });

  it('PUT saves the on-screen document and re-derives the summary and the number from it', async () => {
    const doc = await create({ kind: 'invoice', starter: 'standard' });
    const put = await app.inject({
      method: 'PUT',
      url: `/invoices/${doc.id}`,
      headers: as(manager),
      payload: {
        name: 'Northwind — July',
        status: 'sent',
        topic: 'services',
        lang: 'en',
        body: {
          ...doc.body,
          number: 'INV-2050',
          customerName: 'Northwind Traders Ltd',
          items: [{ id: 'a', desc: 'Design consulting', qty: '12', rate: '63' }, { id: 'b', desc: 'Copy', qty: '2', rate: '149' }, { id: 'c', desc: 'Setup', qty: '1', rate: '99' }],
          discountRate: '10',
          taxRate: '8',
          cents: false,
          currency: '€',
          title: 'PROFORMA',
        },
      },
    });
    expect(put.statusCode, put.body).toBe(200);
    const saved = put.json() as InvoiceDetailView;
    expect(saved).toMatchObject({ name: 'Northwind — July', status: 'sent', topic: 'services', lang: 'en' });
    // The fixture's second case: 115300 − 11530 = 103770, + 8% = 112072.
    expect(saved.summary).toEqual({
      number: 'INV-2050',
      customerName: 'Northwind Traders Ltd',
      title: 'PROFORMA',
      logoText: 'Orchard Lane',
      logoIcon: 'hexagon',
      accent: '#4f46e5',
      currency: '€',
      cents: false,
      totalMinor: 112_072,
      itemCount: 3,
    });
    expect(saved.body.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(saved.updatedAt).toBeGreaterThanOrEqual(saved.createdAt);
    expect((await detail(doc.id)).summary.number).toBe('INV-2050');
    expect(await invoiceDocumentsRepo(meta).numberExists('invoice', 'INV-2050')).toBe(true);
    // The next minted invoice steps past a number a save took.
    const rows = invoiceDocumentsRepo(meta);
    await rows.patch(doc.id, { number: 'INV-1002' });
    const next = await create({ kind: 'invoice', starter: 'quote' });
    expect(next.summary.number).toBe('INV-1003');

    // A lenient body: absent fields fill in, a wrong shape is a 422.
    const sparse = await app.inject({ method: 'PUT', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: 'Sparse', status: 'draft', topic: 'other', lang: 'en', body: { title: 'RECEIPT' } } });
    expect(sparse.statusCode, sparse.body).toBe(200);
    expect((sparse.json() as InvoiceDetailView).body).toMatchObject({ title: 'RECEIPT', items: [], blockOrder: expect.any(Array), number: '' });
    const bad = await app.inject({ method: 'PUT', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: 'Bad', status: 'draft', topic: 'other', lang: 'en', body: { items: 'nope' } } });
    expect(bad.statusCode).toBe(422);
    const badStatus = await app.inject({ method: 'PUT', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: 'Bad', status: 'archived', topic: 'other', lang: 'en', body: {} } });
    expect(badStatus.statusCode).toBe(422);
  });

  it('PUT refuses an oversized inline image and names the field (34 O18)', async () => {
    const doc = await create({ kind: 'template', starter: 'standard' });
    const over = await app.inject({
      method: 'PUT',
      url: `/invoices/${doc.id}`,
      headers: as(manager),
      payload: { name: doc.name, status: 'draft', topic: doc.topic, lang: 'en', body: { ...doc.body, logoImage: `data:image/png;base64,${'A'.repeat(IMAGE_DATA_URL_MAX)}` } },
    });
    expect(over.statusCode).toBe(422);
    expect((over.json() as ErrorReply).error.details).toMatchObject({ code: 'IMAGE_TOO_LARGE', field: 'logoImage', cap: IMAGE_DATA_URL_MAX });
    // The row was never touched.
    expect((await detail(doc.id)).body.logoImage).toBe('');
    const under = await app.inject({
      method: 'PUT',
      url: `/invoices/${doc.id}`,
      headers: as(manager),
      payload: { name: doc.name, status: 'draft', topic: doc.topic, lang: 'en', body: { ...doc.body, logoImage: `data:image/png;base64,${'A'.repeat(1000)}` } },
    });
    expect(under.statusCode, under.body).toBe(200);
    expect((await detail(doc.id)).body.logoImage).toHaveLength('data:image/png;base64,'.length + 1000);
  });

  it('PATCH renames and answers a summary; DELETE removes for good (204 then 404)', async () => {
    const doc = await create({ kind: 'template', starter: 'quote' });
    const renamed = await app.inject({ method: 'PATCH', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: '  Estimate — Vertex  ' } });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json()).toMatchObject({ id: doc.id, name: 'Estimate — Vertex', summary: { title: 'ESTIMATE' } });
    expect('body' in (renamed.json() as object)).toBe(false);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${doc.id}`, headers: as(manager), payload: {} })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: '   ' } })).statusCode).toBe(422);

    const gone = await app.inject({ method: 'DELETE', url: `/invoices/${doc.id}`, headers: as(manager) });
    expect(gone.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/invoices/${doc.id}`, headers: as(viewer) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/invoices/${doc.id}`, headers: as(manager) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/invoices/${doc.id}`, headers: as(manager), payload: { name: 'x' } })).statusCode).toBe(404);
    expect((await list()).counts).toEqual({ template: 0, invoice: 0 });
  });

  it('duplicate is a verbatim draft copy named "(copy)" that lands directly after its source', async () => {
    const a = await create({ kind: 'invoice', starter: 'standard' });
    const b = await create({ kind: 'invoice', starter: 'receipt' });
    const c = await create({ kind: 'invoice', starter: 'deposit' });
    // Newest first: C, B, A. The copy of B goes between B and A.
    const dup = await app.inject({ method: 'POST', url: `/invoices/${b.id}/duplicate`, headers: as(manager) });
    expect(dup.statusCode, dup.body).toBe(201);
    const copy = dup.json() as InvoiceDetailView;
    expect(copy).toMatchObject({ name: 'Payment receipt (copy)', status: 'draft', kind: 'invoice', topic: 'receipts', starter: 'receipt' });
    expect(copy.id).not.toBe(b.id);
    // Verbatim, the number included (comp 1384).
    expect(copy.body).toEqual(b.body);
    expect(copy.summary).toEqual(b.summary);
    expect((await list('invoice')).items.map((i) => i.id)).toEqual([c.id, b.id, copy.id, a.id]);
    expect((await app.inject({ method: 'POST', url: '/invoices/inv_missing/duplicate', headers: as(manager) })).statusCode).toBe(404);
  });

  it('languages: a localized draft after the last of its topic; a second one is a 409 naming the existing row', async () => {
    const en = await create({ kind: 'template', starter: 'standard' });
    const other = await create({ kind: 'template', starter: 'quote' }); // topic sales
    const sub = await create({ kind: 'template', starter: 'subscription' }); // topic recurring, newest
    // List: sub, other, en. The German variation of `en` lands after the last recurring row — `en` itself.
    const add = await app.inject({ method: 'POST', url: `/invoices/${en.id}/languages`, headers: as(manager), payload: { lang: 'de' } });
    expect(add.statusCode, add.body).toBe(201);
    const de = add.json() as InvoiceDetailView;
    expect(de).toMatchObject({ kind: 'template', name: 'Standard invoice · Deutsch', lang: 'de', status: 'draft', topic: 'recurring', starter: 'standard' });
    expect(de.body).toMatchObject({ title: 'RECHNUNG', terms: 'Netto 30', number: 'INV-1000' });
    expect(de.body.items).toEqual(en.body.items);
    expect(de.summary.totalMinor).toBe(en.summary.totalMinor);
    expect((await list('template')).items.map((i) => i.id)).toEqual([sub.id, other.id, en.id, de.id]);
    // The family, in the comp's language order, from any member — the subscription template is in it too.
    expect(de.languages.map((l) => [l.lang, l.id])).toEqual([
      ['en', sub.id],
      ['en', en.id],
      ['de', de.id],
    ]);
    expect((await detail(en.id)).languages.map((l) => l.id)).toEqual([sub.id, en.id, de.id]);
    expect((await detail(other.id)).languages).toHaveLength(1);

    // A variation of a variation keeps the family name and joins after the family's last row.
    const fr = await app.inject({ method: 'POST', url: `/invoices/${de.id}/languages`, headers: as(manager), payload: { lang: 'fr' } });
    expect(fr.statusCode, fr.body).toBe(201);
    expect((fr.json() as InvoiceDetailView).name).toBe('Standard invoice · Français');
    expect((await list('template')).items.map((i) => i.name).slice(2)).toEqual(['Standard invoice', 'Standard invoice · Deutsch', 'Standard invoice · Français']);

    const again = await app.inject({ method: 'POST', url: `/invoices/${en.id}/languages`, headers: as(manager), payload: { lang: 'de' } });
    expect(again.statusCode).toBe(409);
    expect((again.json() as ErrorReply).error).toMatchObject({ code: 'CONFLICT', details: { existingId: de.id } });
    // From another member of the family the answer is the same row.
    const fromSub = await app.inject({ method: 'POST', url: `/invoices/${sub.id}/languages`, headers: as(manager), payload: { lang: 'de' } });
    expect((fromSub.json() as ErrorReply).error.details).toEqual({ existingId: de.id });

    const bogus = await app.inject({ method: 'POST', url: `/invoices/${en.id}/languages`, headers: as(manager), payload: { lang: 'xx' } });
    expect(bogus.statusCode).toBe(422);
    expect((bogus.json() as ErrorReply).error.details).toEqual({ lang: 'xx' });
    expect((await app.inject({ method: 'POST', url: `/invoices/${en.id}/languages`, headers: as(manager), payload: { lang: 'en_US-x' } })).statusCode).toBe(422);
  });

  it('from-template builds an invoice that remembers its origin and mints a fresh number; an invoice cannot start one', async () => {
    const tpl = await create({ kind: 'template', starter: 'commercial' });
    await create({ kind: 'invoice', starter: 'standard' }); // INV-1001
    const built = await app.inject({ method: 'POST', url: `/invoices/${tpl.id}/from-template`, headers: as(manager), payload: {} });
    expect(built.statusCode, built.body).toBe(201);
    const invoice = built.json() as InvoiceDetailView;
    expect(invoice).toMatchObject({ kind: 'invoice', name: 'Commercial invoice', status: 'draft', topic: 'logistics', lang: 'en', starter: 'commercial', originId: tpl.id });
    expect(invoice.summary.number).toBe('INV-1002');
    expect(invoice.body.number).toBe('INV-1002');
    expect(invoice.body.items).toEqual(tpl.body.items);
    expect(invoice.summary.totalMinor).toBe(tpl.summary.totalMinor);
    expect((await list('invoice')).items[0]?.id).toBe(invoice.id);

    const named = await app.inject({ method: 'POST', url: `/invoices/${tpl.id}/from-template`, headers: as(manager), payload: { name: 'Hanseatic Logistik' } });
    expect((named.json() as InvoiceDetailView).name).toBe('Hanseatic Logistik');
    expect((named.json() as InvoiceDetailView).summary.number).toBe('INV-1003');

    const fromInvoice = await app.inject({ method: 'POST', url: `/invoices/${invoice.id}/from-template`, headers: as(manager), payload: {} });
    expect(fromInvoice.statusCode).toBe(422);
    expect((fromInvoice.json() as ErrorReply).error.details).toEqual({ kind: 'invoice' });

    // Deleting the template never unmakes the invoice (34 O20).
    expect((await app.inject({ method: 'DELETE', url: `/invoices/${tpl.id}`, headers: as(manager) })).statusCode).toBe(204);
    expect((await detail(invoice.id)).originId).toBe(tpl.id);
    expect((await list()).counts).toEqual({ template: 0, invoice: 3 });
  });

  it('reads need a session; every write is a settings.manage power that names the permission', async () => {
    const doc = await create({ kind: 'template', starter: 'standard' });
    expect((await app.inject({ method: 'GET', url: '/invoices' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/invoices/starters' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: `/invoices/${doc.id}`, headers: as(viewer) })).statusCode).toBe(200);
    const body = { name: 'x', status: 'draft', topic: 'other', lang: 'en', body: {} };
    const writes = [
      app.inject({ method: 'POST', url: '/invoices', headers: as(viewer), payload: { kind: 'template' } }),
      app.inject({ method: 'PUT', url: `/invoices/${doc.id}`, headers: as(viewer), payload: body }),
      app.inject({ method: 'PATCH', url: `/invoices/${doc.id}`, headers: as(viewer), payload: { name: 'x' } }),
      app.inject({ method: 'DELETE', url: `/invoices/${doc.id}`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/invoices/${doc.id}/duplicate`, headers: as(viewer) }),
      app.inject({ method: 'POST', url: `/invoices/${doc.id}/languages`, headers: as(viewer), payload: { lang: 'de' } }),
      app.inject({ method: 'POST', url: `/invoices/${doc.id}/from-template`, headers: as(viewer), payload: {} }),
    ];
    for (const res of await Promise.all(writes)) {
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as ErrorReply).error.details['permission']).toBe('system:settings:manage');
    }
    expect((await list()).counts).toEqual({ template: 1, invoice: 0 });
  });
});
