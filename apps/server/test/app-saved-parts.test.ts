// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A FILE MADE ON AN ADMINIUM CARRIES, INSTALLED, UPDATED AND UNINSTALLED.
 *
 * Its report documents, invoice layouts, scheduled reports and payments are
 * written with the writers their own screens use. An update rewrites what
 * nobody changed and leaves what somebody did; an uninstall takes back the
 * unchanged rows and the payable tables, and leaves the ways to pay and the
 * pay page, which are the deployment's. Who a schedule goes to, a bank
 * account and a service's keys never travel: they are "after you install"
 * items, handed to the install's seam. Its public entries keep their own
 * address, pages, rate and reply, and may replace, remove and write many
 * rows behind a claim. On every engine the machine runs.
 */
import { appPartsRepo, invoiceDocumentsRepo, payableProfilesRepo, paymentMethodsRepo, paymentSettingsRepo, publicEndpointsRepo, publicKeysRepo, reportDocumentsRepo, scheduledReportsRepo } from '@adminium/meta';
import type { Manifest } from '@adminium/manifest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({ calls: [] as { install: { manifestId: string; appKey: string }; items: unknown[] }[] }));
vi.mock('../src/apps/after-install.js', () => ({
  recordAfterInstall: async (_meta: unknown, install: { manifestId: string; appKey: string }, items: unknown[]) => {
    seam.calls.push({ install, items: [...items] });
  },
}));

import { savedPartsRefusal } from '../src/apps/saved-parts.js';
import { bodyColumn as invoiceBodyColumn } from '../src/invoices/document.js';
import { blankBody as blankInvoice } from '../src/invoices/starters.js';
import { bodyColumn as reportBodyColumn } from '../src/report-documents/document.js';
import { blankBody as blankReport } from '../src/report-documents/starters.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { addOnHarness, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
type Doc = Record<string, any>;

const report = reportBodyColumn({ ...blankReport(), reportTitle: 'Weekly sales' });
const invoice = invoiceBodyColumn(blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'en', number: 'INV-1000' }));

function shop(version = '1.0.0', over: Doc = {}): Doc {
  return appManifest('corner-shop', {
    name: 'Corner shop',
    version,
    publisher: { id: 'local', name: 'This Adminium' },
    compatibility: { minAdminiumVersion: '0.3.49', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            { ref: 'total', type: 'decimal', scale: 2, default: 0 },
            { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:corner-shop', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    reports: [{ key: 'weekly-sales', name: 'Weekly sales', body: report }],
    invoiceLayouts: [{ key: 'plain', name: 'Plain invoice', topic: 'sales', body: invoice }],
    scheduledReports: [{ key: 'monday-orders', name: 'Orders on Monday', page: 'orders', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00' } }],
    payments: {
      payables: [{ table: 'orders', label: 'number', amount: { column: 'total' }, currency: { fixed: 'EUR' }, payments: { kind: 'kept' }, customerEmail: 'email', pageFields: ['number', 'total'] }],
      ways: [
        { source: 'manual', method: 'bank-transfer', enabled: true, label: { en: 'Bank transfer' }, rules: { currencies: ['EUR'] } },
        { source: 'manual', method: 'cash-on-delivery', enabled: true },
      ],
      payPage: { shopName: 'Corner shop', shopCountry: 'DE', showLines: true },
    },
    publicAccess: [
      {
        table: 'orders',
        methods: ['GET', 'PUT', 'DELETE', 'BATCH'],
        claim: { match: ['number', 'email'] },
        writable: ['note'],
        path: '/my_orders',
        pagination: { defaultLimit: 10, maxLimit: 40, order: 'number.desc' },
        rateLimit: { requests: 20, window: '1m' },
        response: 'wrapped',
      },
    ],
    ...over,
  });
}

const installRow = async (h: Harness) => (await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'corner-shop').executeTakeFirstOrThrow()).id;

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a saved app's own parts [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
      seam.calls.length = 0;
    });

    it('install: each part made by its own writer; who it goes to, bank accounts and keys left for the owner', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      const reply = await h.install('corner-shop', '1.0.0');
      expect(reply.statusCode, reply.body).toBe(200);
      const manifestId = await installRow(h);

      const [made] = await reportDocumentsRepo(h.meta).list({ kind: 'report' });
      expect(made).toMatchObject({ name: 'Weekly sales', status: 'draft', starter: null });
      expect(made!.summary.reportTitle).toBe('Weekly sales');
      const [layout] = await invoiceDocumentsRepo(h.meta).list({ kind: 'template' });
      expect(layout).toMatchObject({ kind: 'template', name: 'Plain invoice', topic: 'sales', lang: 'en', number: 'INV-1000' });
      const [schedule] = await scheduledReportsRepo(h.meta).list();
      // Nobody on it, switched off, in the database's zone.
      expect(schedule).toMatchObject({ name: 'Orders on Monday', recipients: [], enabled: false, nextRunAt: null, format: 'pdf' });
      expect(schedule!.schedule).toMatchObject({ frequency: 'weekly', dayOfWeek: 1, time: '08:00', timezone: expect.any(String) });
      expect((await appPartsRepo(h.meta).list(manifestId)).map((part) => [part.kind, part.partKey])).toEqual([
        ['invoice-layout', 'plain'],
        ['report', 'weekly-sales'],
        ['scheduled-report', 'monday-orders'],
      ]);

      // The payable table is the app's; the ways and the pay page the deployment's.
      const [payable] = await payableProfilesRepo(h.meta).list(h.connectionId);
      expect(payable).toMatchObject({ ownerApp: 'corner-shop', enabled: true });
      expect(payable!.mapping).toMatchObject({ label: 'number', amount: { column: 'total' }, currency: { fixed: 'EUR' }, payments: { kind: 'kept' }, customerEmail: 'email' });
      const ways = await paymentMethodsRepo(h.meta).list();
      // A transfer with no account to pay into waits, switched off; no detail travelled.
      expect(ways.map((way) => [way.method, way.enabled, way.details])).toEqual([
        ['bank-transfer', false, null],
        ['cash-on-delivery', true, null],
      ]);
      expect(await paymentSettingsRepo(h.meta).get(PAY_PAGE_DOC, payPageSchema)).toEqual({ shopName: 'Corner shop', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: 'DE', showLines: true });

      const calls = seam.calls.filter((call) => call.install.appKey === 'corner-shop');
      expect(calls).toHaveLength(1);
      expect(calls[0]!.install).toEqual({ manifestId, appKey: 'corner-shop' });
      expect(calls[0]!.items).toEqual([
        { kind: 'recipients', item: 'monday-orders', field: 'recipients' },
        { kind: 'bank-account', item: 'manual/bank-transfer', field: 'details.accounts' },
      ]);

      // Its public entry keeps its own address, pages, rate and reply, and its key holds the wider methods behind the claim.
      const [endpoint] = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).filter((one) => one.managedBy === 'corner-shop');
      expect(endpoint?.ref).toBe('my_orders');
      const definition = JSON.parse(endpoint!.definition) as Doc;
      expect(definition).toMatchObject({
        path: '/my_orders',
        methods: ['GET', 'PUT', 'DELETE', 'BATCH'],
        pagination: { default_limit: 10, max_limit: 40, order: 'number.desc' },
        rate_limit: { requests: 20, window: '1m' },
        response: { shape: 'object', envelope: 'data' },
        auth: { role: 'authenticated' },
      });
      const key = (await publicKeysRepo(h.meta).list()).find((one) => one.managedBy === 'corner-shop' && one.revokedAt === null);
      expect(JSON.parse(key!.access as unknown as string)).toEqual({ [endpoint!.id]: ['GET', 'PUT', 'DELETE', 'BATCH'] });
    });

    it('update: what nobody changed is rewritten, what somebody changed is kept, what is no longer carried goes; uninstall takes back the unchanged', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await h.stageApp(shop());
      expect((await h.install('corner-shop', '1.0.0')).statusCode).toBe(200);
      const manifestId = await installRow(h);
      const [layout] = await invoiceDocumentsRepo(h.meta).list({ kind: 'template' });
      const [schedule] = await scheduledReportsRepo(h.meta).list();
      // The owner renames the layout, and chooses who the schedule goes to and switches it on: only the rename is an edit.
      await invoiceDocumentsRepo(h.meta).patch(layout!.id, { name: 'Our invoice' });
      await scheduledReportsRepo(h.meta).update(schedule!.id, { recipients: ['boss@example.test'], enabled: true, nextRunAt: Date.now() + 1000 });

      const next = shop('1.0.1');
      next['reports'][0].name = 'Weekly sales, v2';
      next['invoiceLayouts'][0].name = 'Plain invoice, v2';
      next['scheduledReports'][0].schedule.time = '09:30';
      next['reports'].push({ key: 'monthly', name: 'Monthly', kind: 'template', body: report });
      delete next['payments'].payPage;
      next['publicAccess'][0].rateLimit = { requests: 30, window: '1h' };
      await h.stageApp(next);
      const updated = await h.inject({ method: 'POST', url: '/apps/corner-shop/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);

      expect((await reportDocumentsRepo(h.meta).list()).map((row) => row.name).sort()).toEqual(['Monthly', 'Weekly sales, v2']);
      expect((await invoiceDocumentsRepo(h.meta).findById(layout!.id))?.name).toBe('Our invoice');
      const after = await scheduledReportsRepo(h.meta).findById(schedule!.id);
      expect(after).toMatchObject({ recipients: ['boss@example.test'], enabled: true });
      expect(after!.schedule.time).toBe('09:30');
      expect(after!.nextRunAt).toEqual(expect.any(Number));
      // The endpoint follows the new version's rate.
      const [endpoint] = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).filter((one) => one.managedBy === 'corner-shop');
      expect(JSON.parse(endpoint!.definition)).toMatchObject({ rate_limit: { requests: 30, window: '1h' }, methods: ['GET', 'PUT', 'DELETE', 'BATCH'] });
      // Its recipients were chosen: nothing is left to fill in of it.
      expect(seam.calls.at(-1)!.items).toEqual([{ kind: 'bank-account', item: 'manual/bank-transfer', field: 'details.accounts' }]);

      // A version that carries no schedule and no payable: the unchanged schedule goes even though it is switched on, and so does the payable table.
      const fewer = shop('1.0.2');
      delete fewer['scheduledReports'];
      fewer['payments'] = { ways: fewer['payments'].ways };
      fewer['reports'] = [fewer['reports'][0]];
      fewer['reports'][0].name = 'Weekly sales, v2';
      await h.stageApp(fewer);
      expect((await h.inject({ method: 'POST', url: '/apps/corner-shop/update', payload: {} })).statusCode).toBe(200);
      expect(await scheduledReportsRepo(h.meta).findById(schedule!.id)).toBeNull();
      expect(await payableProfilesRepo(h.meta).list(h.connectionId)).toEqual([]);
      expect((await reportDocumentsRepo(h.meta).list()).map((row) => row.name)).toEqual(['Weekly sales, v2']);

      // Uninstalled: the unchanged report goes, the renamed layout stays the owner's; the ways and the pay page stay.
      const gone = await h.inject({ method: 'DELETE', url: '/apps/corner-shop', payload: {} });
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await reportDocumentsRepo(h.meta).list()).toEqual([]);
      expect((await invoiceDocumentsRepo(h.meta).findById(layout!.id))?.name).toBe('Our invoice');
      expect(await appPartsRepo(h.meta).list(manifestId)).toEqual([]);
      expect((await paymentMethodsRepo(h.meta).list()).length).toBe(2);
      expect((await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).filter((one) => one.managedBy === 'corner-shop')).toEqual([]);
      expect(await paymentSettingsRepo(h.meta).get(PAY_PAGE_DOC, payPageSchema)).not.toBeNull();
    });

    it('a way to pay or a pay page set up here already is never changed by a file', async () => {
      h = await addOnHarness(dialect, { unbuiltWords: {} });
      await paymentMethodsRepo(h.meta).put({ source: 'manual', method: 'cash-on-delivery', label: null, enabled: false, rules: { countries: [], currencies: [], min: null, max: null, onlyFor: [] }, details: { note: 'Pay the driver' }, position: 3 });
      await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Mine', logoFileId: null, contactEmail: 'me@example.test', contactPhone: null, shopCountry: 'FR', showLines: false });
      await h.stageApp(shop());
      expect((await h.install('corner-shop', '1.0.0')).statusCode).toBe(200);
      const cash = await paymentMethodsRepo(h.meta).find('manual', 'cash-on-delivery');
      expect(cash).toMatchObject({ enabled: false, details: { note: 'Pay the driver' }, position: 3 });
      expect(await paymentSettingsRepo(h.meta).get(PAY_PAGE_DOC, payPageSchema)).toMatchObject({ shopName: 'Mine', contactEmail: 'me@example.test', shopCountry: 'FR' });
    });
  });
}

describe('who may install them', () => {
  it('each part needs what its own screen needs', async () => {
    const manifest = shop() as unknown as Manifest;
    const holding = (held: string[]) => async (permission: string) => held.includes(permission);
    expect(await savedPartsRefusal(manifest, holding(['system:settings:manage', 'system:reports:manage', 'system:payments:manage']))).toBeNull();
    const noPayments = await savedPartsRefusal(manifest, holding(['system:settings:manage', 'system:reports:manage']));
    expect(noPayments?.statusCode).toBe(403);
    expect(noPayments?.message).toContain('payments');
    expect((await savedPartsRefusal(manifest, holding(['system:payments:manage', 'system:reports:manage'])))?.message).toContain('report documents');
    expect((await savedPartsRefusal(manifest, holding(['system:settings:manage', 'system:payments:manage'])))?.message).toContain('scheduled reports');
    // A file that carries none of them asks for nothing.
    const bare = { ...shop(), reports: undefined, invoiceLayouts: undefined, scheduledReports: undefined, payments: undefined } as unknown as Manifest;
    expect(await savedPartsRefusal(bare, holding([]))).toBeNull();
  });
});
