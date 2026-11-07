// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT THE REVIEW OF A SELF-MADE FILE SHOWS, read through the real routes on
 * every engine this run can reach.
 *
 * The zod serializer keeps only what a reply declares, so each new field is
 * asserted on the reply itself: where and when the file was made, what the
 * owner fills in once it is installed (a rule's webhook arrives empty and
 * switched off, a schedule goes to nobody yet, a bank account is theirs to
 * give), and the parts only such a file carries. The list is kept with the
 * install and follows its updates; and a file is not installed back onto the
 * very database it was saved from.
 */
import { appAfterInstallRepo, appSavesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { bodyColumn as invoiceBodyColumn } from '../src/invoices/document.js';
import { blankBody as blankInvoice } from '../src/invoices/starters.js';
import { bodyColumn as reportBodyColumn } from '../src/report-documents/document.js';
import { blankBody as blankReport } from '../src/report-documents/starters.js';
import { addOnHarness, appManifest, ENGINES, type Harness } from './app-add-ons.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
type Doc = Record<string, any>;

const LINEAGE = 'corner-shop-lineage-01';
const report = reportBodyColumn({ ...blankReport(), reportTitle: 'Weekly sales' });
const invoice = invoiceBodyColumn(blankInvoice({ now: Date.UTC(2026, 10, 1), lang: 'en', number: 'INV-1000' }));
const node = (id: string, kind: string, more: Doc = {}) => ({ id, kind, title: `Step ${id}`, ...more });

function shop(version = '1.0.0', withSchedule = true): Doc {
  return appManifest('corner-shop', {
    name: 'Corner shop',
    version,
    publisher: { id: 'local', name: 'This Adminium' },
    compatibility: { minAdminiumVersion: '0.3.49', engines: ['postgres', 'mysql', 'sqlite'] },
    provenance: { lineage: LINEAGE, savedAt: '2026-11-05T09:30:00Z', adminiumVersion: '0.3.49', label: 'Corner shop, Leith' },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
            { ref: 'total', type: 'decimal', scale: 2, default: 0 },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:corner-shop', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    automations: [
      {
        key: 'tell-slack',
        name: 'Tell the shop channel',
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'orders' },
        graph: { version: 1, nodes: [node('t', 'trigger'), node('w', 'action', { action: { kind: 'webhook', bodyKind: 'slack', body: 'Order {{record.number}}' } })] },
      },
    ],
    reports: [{ key: 'weekly-sales', name: 'Weekly sales', body: report }],
    invoiceLayouts: [{ key: 'plain', name: 'Plain invoice', topic: 'sales', body: invoice }],
    ...(withSchedule ? { scheduledReports: [{ key: 'monday-orders', name: 'Orders on Monday', page: 'orders', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00' } }] } : {}),
    payments: {
      payables: [{ table: 'orders', label: 'number', amount: { column: 'total' }, currency: { fixed: 'EUR' }, payments: { kind: 'kept' }, customerEmail: 'email', pageFields: ['number', 'total'] }],
      ways: [{ source: 'manual', method: 'bank-transfer', enabled: true, label: { en: 'Bank transfer' }, rules: { currencies: ['EUR'] } }],
      payPage: { shopName: 'Corner shop', shopCountry: 'GB', showLines: true },
    },
  });
}

/** An app whose sample file fills its orders and not its suppliers, with a rule mailing a column of each. */
function mailShop(): Doc {
  const table = (ref: string) => ({ ref, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80, nullable: true }, { ref: 'email', type: 'text', maxLength: 200, nullable: true }] });
  const mail = (key: string, table: string) => ({
    key,
    name: key,
    enabled: true,
    trigger: { kind: 'record', event: 'created', table },
    graph: { version: 1, nodes: [node('t', 'trigger'), node('m', 'action', { action: { kind: 'email', templateKey: 'mail-shop-thanks', to: { kind: 'field', column: 'email' }, class: 'service' } })] },
  });
  return appManifest('mail-shop', {
    name: 'Mail shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'This Adminium' },
    compatibility: { minAdminiumVersion: '0.3.49', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: { tables: [table('orders'), table('suppliers')] },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'mail-shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:mail-shop', icon: 'list', order: 1 }, bindings: { main: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    emailTemplates: [{ key: 'mail-shop-thanks', name: 'Thanks', locales: { 'en-US': { subject: 'Thanks, {{record.name}}', blocks: [{ block: 'email.text', data: { text: 'Thank you.' } }] } } }],
    sampleData: { file: 'seeds/sample.json' },
    automations: [mail('mail-order', 'orders'), mail('mail-supplier', 'suppliers')],
  });
}
const MAIL_SHOP_SAMPLE = JSON.stringify({ format: 'adminium.sample/1', app: 'mail-shop', tables: [{ ref: 'orders', rows: [{ '@label': 'o1', name: 'Ada', email: 'ada@example.com' }] }] });

const afterInstallOf = async (h: Harness) => {
  const row = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'corner-shop').executeTakeFirstOrThrow();
  return (await appAfterInstallRepo(h.meta).list(row.id)).map((item) => [item.kind, item.item, item.field]).sort();
};

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`the review of a self-made file [${dialect}]`, () => {
    let h: Harness | null = null;
    afterEach(async () => {
      await h?.close();
      h = null;
    });

    it('says where it was made, what is left to fill in and what it carries; keeps that list, and follows its updates', async () => {
      h = await addOnHarness(dialect);
      const planned = await h.plan(shop());
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = planned.json().plan;
      expect(plan.madeAt).toEqual({ label: 'Corner shop, Leith', savedAt: '2026-11-05T09:30:00Z', adminiumVersion: '0.3.49' });
      expect(plan.savedParts).toEqual({ reports: 1, invoiceLayouts: 1, scheduledReports: 1, payments: true });
      const listed = [
        ['bank-account', 'manual/bank-transfer', 'details.accounts'],
        ['recipients', 'monday-orders', 'recipients'],
        ['webhook', 'tell-slack', 'w.url'],
      ];
      expect((plan.afterInstall as { kind: string; item: string; field: string }[]).map((item) => [item.kind, item.item, item.field]).sort()).toEqual(listed);

      const installed = await h.install('corner-shop', '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
      // What the review said is what the install keeps for the owner.
      expect(await afterInstallOf(h)).toEqual(listed);

      // The next version brings no schedule: who it went to is nothing to fill in any more.
      await h.stageApp(shop('1.0.1', false));
      const updated = await h.inject({ method: 'POST', url: '/apps/corner-shop/update', payload: {} });
      expect(updated.statusCode, updated.body).toBe(200);
      expect(await afterInstallOf(h)).toEqual(listed.filter(([kind]) => kind !== 'recipients'));
    });

    it('reads its sample file: a mail to a column of a table the file fills arrives switched off, the others as shipped', async () => {
      h = await addOnHarness(dialect);
      await h.stageApp(mailShop(), { 'seeds/sample.json': MAIL_SHOP_SAMPLE });
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'mail-shop', version: '1.0.0', connectionId: h.connectionId } });
      expect(planned.statusCode, planned.body).toBe(200);
      const outbound = (planned.json().plan.afterInstall as { kind: string; item: string; field: string }[]).filter((item) => item.kind === 'outbound');
      expect(outbound).toEqual([{ kind: 'outbound', item: 'mail-order', field: 'm' }]);
      const installed = await h.install('mail-shop', '1.0.0');
      expect(installed.statusCode, installed.body).toBe(200);
      const rules = await h.meta.db.selectFrom('adminium_automations').select(['templateKey', 'enabled']).where('managedBy', '=', 'mail-shop').execute();
      expect(Object.fromEntries(rules.map((rule) => [rule.templateKey, Boolean(rule.enabled)]))).toEqual({ 'mail-order': false, 'mail-supplier': true });
    });

    it('is not installed back onto the database it was saved from', async () => {
      h = await addOnHarness(dialect);
      // The dashboard this file was saved from is this database.
      await appSavesRepo(h.meta).create({ appKey: 'corner-shop', version: '1.0.0', lineage: LINEAGE, connectionId: h.connectionId, label: 'Corner shop, Leith', savedBy: null, integrity: `sha512-${'a'.repeat(86)}==`, bytes: 1024 });
      const planned = await h.plan(shop());
      expect(planned.json().plan.installable).toBe(false);
      expect(planned.json().plan.problems).toContainEqual({
        code: 'SAVED_FROM_HERE',
        table: 'corner-shop',
        message: '"Corner shop" was saved from this database. Its tables and pages are here already as the dashboard it came from: install it on another database.',
      });
      const refused = await h.install('corner-shop', '1.0.0');
      expect(refused.statusCode, refused.body).toBe(422);
      expect(refused.body).toContain('SAVED_FROM_HERE');
    });
  });
}
