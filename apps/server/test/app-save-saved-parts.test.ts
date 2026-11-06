// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING REPORTS, INVOICE LAYOUTS AND SCHEDULED REPORTS, AND INSTALLING THEM.
 *
 * Made by hand on one database, saved, and installed on a fresh one: the
 * target holds the same reports, layouts and schedules. Who a schedule goes
 * to, a layout's contact and payment lines, and a picture linked from
 * elsewhere never travel; a picture kept in the Files library travels as a
 * file of the package and is put back in the body. On every engine.
 */
import { filesRepo, invoiceDocumentsRepo, pagesRepo, reportDocumentsRepo, scheduledReportsRepo, workspacesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { bodyColumn as invoiceBodyColumn } from '../src/invoices/document.js';
import { blankBody as blankInvoice } from '../src/invoices/starters.js';
import { summaryOf as invoiceSummaryOf } from '../src/invoices/summary.js';
import { acceptReportBody, bodyColumn as reportBodyColumn } from '../src/report-documents/document.js';
import { blankBody as blankReport, BLANK_ICON } from '../src/report-documents/starters.js';
import { summaryOf as reportSummaryOf } from '../src/report-documents/summary.js';
import { ENGINES } from './app-add-ons.helpers.js';
import { choices, expectNoneOf, expectValid, handMadeShop, installSaved, sourceOf, withOtherParts, addOnHarness, type Doc, type Harness } from './app-save-parts.helpers.js';

/** A one-pixel GIF: what a logo kept in the Files library holds. */
const reportSummary = (body: unknown) => reportSummaryOf(acceptReportBody(body), { starterIcon: BLANK_ICON });
const invoiceSummary = (body: unknown) => invoiceSummaryOf(body as never);

const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`saving a database's reports and layouts [${dialect}]`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.close();
    });

    it('travel as made, without recipients, contacts or bank lines, and install as the same rows', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      const page = await pagesRepo(h.meta).create({ connectionId: h.connectionId, slug: 'orders', type: 'crud', title: 'Orders', config: {} });
      const logo = await filesRepo(h.meta).create({ id: 'file_logo_0001', filename: 'logo.gif', mime: 'image/gif', sizeBytes: PIXEL.length, sha256: 'x', storageKey: 'k', storage: 'memory', destinationId: null, kind: 'upload', uploadedBy: null });
      const report = await reportDocumentsRepo(h.meta).create({
        kind: 'report',
        name: 'Weekly sales',
        status: 'live',
        starter: null,
        originId: null,
        body: reportBodyColumn({
          ...blankReport(),
          reportTitle: 'Weekly sales',
          bgImage: 'https://cdn.example.test/bg.png?token=abc123',
          blocks: [
            { id: 'c1', kind: 'contact', title: 'Ask us', w: 'full', show: true, conName: 'Desk', conEmail: 'desk@shop.example.test', conPhone: '+44 20 7946 0000' },
            { id: 'i1', kind: 'image', title: 'Logo', w: 'half', show: true, text: '', url: `/api/v1/files/${logo.id}/content` },
          ],
        } as never),
        summary: reportSummary(blankReport()),
      });
      const invoice = await invoiceDocumentsRepo(h.meta).create({
        kind: 'template',
        name: 'Plain invoice',
        status: 'draft',
        topic: 'sales',
        lang: 'de',
        number: 'INV-1000',
        starter: null,
        originId: null,
        body: invoiceBodyColumn({ ...blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'de', number: 'INV-1000' }), conEmail: 'billing@shop.example.test', conPhone: '+44 20 7946 0001', payment: ['IBAN GB33BUKB20201555555555'], from: ['Corner shop', '1 High St'], customerName: 'Jo Example', customer: ['2 Low Rd'], ship: ['3 Side Ln'] }),
        summary: invoiceSummary(blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'de', number: 'INV-1000' })),
      });
      // An issued invoice never travels.
      await invoiceDocumentsRepo(h.meta).create({ kind: 'invoice', name: 'Issued to Ada', status: 'sent', number: 'INV-1001', starter: null, originId: null, body: invoiceBodyColumn(blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'en', number: 'INV-1001' })), summary: invoiceSummary(blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'en', number: 'INV-1001' })) });
      const schedule = await scheduledReportsRepo(h.meta).create({ pageId: page.id, name: 'Orders on Monday', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00', timezone: 'Europe/London' }, recipients: ['boss@shop.example.test'], format: 'png', enabled: true, nextRunAt: Date.now() + 1000 });

      const source = { ...(await sourceOf(h)), readFile: async (id: string) => (id === logo.id ? new Uint8Array(PIXEL) : null) };
      const result = await convertToApp(source, choices());
      const doc = withOtherParts(result);

      expect(doc['reports']).toEqual([{ key: 'weekly-sales', kind: 'report', name: 'Weekly sales', status: 'live', body: expect.any(Object) }]);
      const body = doc['reports'][0].body as Doc;
      expect(body['bgImage']).toBe('');
      expect(body['blocks'][0]).toMatchObject({ kind: 'contact', conName: 'Desk', conEmail: '', conPhone: '' });
      expect(body['blocks'][1].url).toMatch(/^package:parts\/[0-9a-f]{64}\.gif$/);
      expect([...result.files.keys()]).toEqual([body['blocks'][1].url.slice('package:'.length)]);
      expect(doc['invoiceLayouts']).toEqual([{ key: 'plain-invoice', name: 'Plain invoice', topic: 'sales', lang: 'de', body: expect.any(Object) }]);
      expect(doc['invoiceLayouts'][0].body).toMatchObject({ conEmail: '', conPhone: '', payment: [], number: 'INV-1000', customerName: '', customer: [], ship: [], from: ['Corner shop', '1 High St'] });
      expect(JSON.stringify(doc)).not.toContain('Jo Example');
      expect(doc['scheduledReports']).toEqual([{ key: 'orders-on-monday', name: 'Orders on Monday', page: 'orders', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00' }, format: 'png' }]);
      expectNoneOf(doc, [report.id, invoice.id, schedule.id, page.id, logo.id, h.connectionId, 'desk@shop', 'billing@shop', 'boss@shop', 'GB33BUKB', '7946', 'cdn.example.test', 'abc123', 'Europe/London']);

      const codes = result.check.map((item) => `${item.group}:${item.code}:${item.afterKind ?? ''}`);
      expect(codes).toEqual(expect.arrayContaining(['info:PICTURE_LEFT_OUT:', 'after:CONTACT_LEFT_OUT:', 'after:PAYMENT_LINES_LEFT_OUT:bank-account', 'after:SCHEDULE_RECIPIENTS:recipients']));
      // A Check item names, never holds, a value.
      expectNoneOf(result.check, ['desk@shop', 'boss@shop', 'GB33BUKB', 'cdn.example.test']);
      expectValid(doc);

      const target = await addOnHarness(dialect, { unbuiltWords: {} });
      open.push(target);
      await installSaved(target, doc, result.files);
      const [made] = await reportDocumentsRepo(target.meta).list();
      expect(made).toMatchObject({ kind: 'report', name: 'Weekly sales', status: 'live' });
      const madeBody = made!.body as Doc;
      expect(madeBody['blocks'][1].url).toBe(`data:image/gif;base64,${PIXEL.toString('base64')}`);
      expect(madeBody['blocks'][0]).toMatchObject({ conEmail: '', conPhone: '' });
      const [layout] = await invoiceDocumentsRepo(target.meta).list();
      expect(layout).toMatchObject({ kind: 'template', name: 'Plain invoice', topic: 'sales', lang: 'de', number: 'INV-1000' });
      expect(layout!.body).toMatchObject({ payment: [], conEmail: '' });
      const [planned] = await scheduledReportsRepo(target.meta).list();
      expect(planned).toMatchObject({ name: 'Orders on Monday', recipients: [], enabled: false, format: 'png' });
      expect(planned!.schedule).toMatchObject({ frequency: 'weekly', dayOfWeek: 1, time: '08:00' });
      const targetPage = (await pagesRepo(target.meta).listForConnection(target.connectionId)).find((one) => one.id === planned!.pageId);
      expect(targetPage?.slug).toBe('orders');
    });

    it('only what is shown where this database is, and what the person chose', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      const mine = await workspacesRepo(h.meta).create({ name: 'Shop', connectionIds: [h.connectionId] });
      const other = await workspacesRepo(h.meta).create({ name: 'Pottery', connectionIds: [] });
      const body = reportBodyColumn(blankReport());
      const make = async (name: string) => await reportDocumentsRepo(h.meta).create({ kind: 'report', name, status: 'draft', starter: null, originId: null, body, summary: reportSummary(body) });
      const everywhere = await make('Everywhere');
      const here = await make('Here');
      const there = await make('There');
      await workspacesRepo(h.meta).setShownIn('report', here.id, [mine.id]);
      await workspacesRepo(h.meta).setShownIn('report', there.id, [other.id]);

      const quick = await convertToApp(await sourceOf(h), choices());
      expect((quick.manifest.reports ?? []).map((one) => one.name).sort()).toEqual(['Everywhere', 'Here']);
      const chosen = await convertToApp(await sourceOf(h), choices({ reports: [there.id] }));
      expect((chosen.manifest.reports ?? []).map((one) => one.name)).toEqual(['There']);
      expect(everywhere.id).not.toBe(here.id);
    });

    it('a schedule whose page is not saved stays behind, and says so', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      const page = await pagesRepo(h.meta).create({ connectionId: h.connectionId, slug: 'orders', type: 'crud', title: 'Orders', config: {} });
      await scheduledReportsRepo(h.meta).create({ pageId: page.id, name: 'Daily', schedule: { frequency: 'daily', time: '07:00', timezone: 'UTC' }, recipients: [], format: 'pdf', nextRunAt: null });
      const result = await convertToApp(await sourceOf(h), choices({ pages: [] }));
      expect(result.manifest.scheduledReports).toBeUndefined();
      expect(result.check).toEqual(expect.arrayContaining([expect.objectContaining({ group: 'info', code: 'SCHEDULE_LEFT_OUT', item: 'Daily' })]));
    });
  });
}
