// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING A DATABASE'S DOCUMENT PROFILES, AND INSTALLING THEM.
 *
 * A profile made by hand on one database becomes an entry of the file, its
 * tables by ref, and installs as the same profile on a fresh database: the
 * same slots, the operator's options, the change that draws it (a new rule
 * there), kept the same way, and mailed to a slot the owner chooses again.
 * A profile an install made, one switched off and a trigger with no form stay
 * behind or are said. On every engine.
 */
import { automationsRepo, documentProfilesRepo, manifestsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { addOnManifest, ENGINES } from './app-add-ons.helpers.js';
import { standInProvider } from './app-documents.helpers.js';
import { addOnHarness, choices, expectNoneOf, expectValid, handMadeShop, installSaved, sourceOf, withOtherParts, type Harness } from './app-save-parts.helpers.js';

/** The add-on that draws invoices, installed once per server. */
async function invoicesAddOn(meta: MetaDb): Promise<void> {
  await manifestsRepo(meta, { encrypt: (v) => v, decrypt: (v) => v }).install({
    manifestKey: 'invoices',
    version: '1.2.0',
    kind: 'add-on',
    source: 'file',
    document: addOnManifest('invoices', { version: '1.2.0', addOn: { attaches: [{ app: '*' }], slots: [] } }),
  });
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`saving a database's documents [${dialect}]`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.close();
    });

    it('a profile made by hand travels by ref and installs as the same profile', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      await invoicesAddOn(h.meta);
      const model = (await sourceOf(h)).model;
      const id = (name: string) => model.tables.find((table) => table.name === name)!.id;
      const profiles = documentProfilesRepo(h.meta);
      const invoice = await profiles.create({
        addOnKey: 'invoices',
        kind: 'invoice',
        name: 'Shop invoice',
        connectionId: h.connectionId,
        table: id('orders'),
        mapping: {
          number: { column: 'number' },
          clientName: { ref: 'client_id', column: 'name', table: id('clients') },
          lines: { collection: { table: id('order_lines'), fkColumn: 'order_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
        },
        options: { locale: 'de-DE', paper: 'a4', prefix: 'SHOP-', literals: { footer: 'Danke' }, numberColumn: 'number', where: { column: 'status', in: ['sent', 'paid'] } },
        trigger: { event: 'record.updated', when: { column: 'status', op: 'is', value: 'sent' }, automationId: 'auto_source_rule_01' },
        deliver: { store: true, emailSlot: 'clientEmail' },
        orderBy: 'position',
      });
      // Drawn when a row is deleted: no form in a file.
      await profiles.create({ addOnKey: 'invoices', kind: 'credit-note', name: 'Credit on delete', connectionId: h.connectionId, table: id('orders'), mapping: { number: { column: 'number' } }, trigger: { event: 'record.deleted' } });
      // Switched off, and one an install made: neither travels.
      await profiles.create({ addOnKey: 'invoices', kind: 'receipt', name: 'Old receipt', connectionId: h.connectionId, table: id('orders'), mapping: { number: { column: 'number' } }, enabled: false });
      await profiles.create({ addOnKey: 'invoices', kind: 'statement', name: 'An app’s', connectionId: h.connectionId, table: id('clients'), mapping: {}, ownerApp: 'studio' });

      const result = await convertToApp(await sourceOf(h), choices());
      const doc = withOtherParts(result);
      expect(doc['documents']).toEqual([
        { kind: 'credit-note', addOn: 'invoices', table: 'orders', name: 'Credit on delete', mapping: { number: { column: 'number' } }, deliver: { store: true } },
        {
          kind: 'invoice',
          addOn: 'invoices',
          table: 'orders',
          name: 'Shop invoice',
          mapping: {
            number: { column: 'number' },
            clientName: { via: 'client_id', column: 'name' },
            lines: { collection: { table: 'order_lines', via: 'order_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
          },
          where: { column: 'status', in: ['sent', 'paid'] },
          options: { locale: 'de-DE', paper: 'a4', prefix: 'SHOP-', literals: { footer: 'Danke' } },
          trigger: { event: 'record.updated', when: { column: 'status', value: 'sent' } },
          deliver: { store: true, emailSlot: 'clientEmail' },
        },
      ]);
      expect(doc['addOns']).toEqual({ suggests: [{ key: 'invoices', range: '>=1.2.0', reason: { 'en-US': 'Used because it draws the app’s documents.' }, checked: true }] });
      expectNoneOf(doc, [invoice.id, 'auto_source_rule_01', h.connectionId, id('orders')]);
      const codes = result.check.map((item) => [item.code, item.item]);
      expect(codes).toEqual(expect.arrayContaining([['DOCUMENT_TRIGGER_NO_FORM', 'Credit on delete'], ['DOCUMENT_OFF', 'Old receipt'], ['DOCUMENT_RECIPIENT', 'Shop invoice']]));
      expect(result.check.find((item) => item.code === 'DOCUMENT_RECIPIENT')).toMatchObject({ group: 'after', afterKind: 'delivery', field: 'deliver.emailSlot' });
      expectValid(doc);

      const { runtime } = standInProvider();
      const target = await addOnHarness(dialect, { unbuiltWords: {}, documents: { runtime: () => runtime } });
      open.push(target);
      await invoicesAddOn(target.meta);
      // The suggested add-on, ticked, as the wizard sends it.
      const reply = await installSaved(target, doc, new Map(), { addOns: [{ key: 'invoices', version: '1.2.0' }] });
      // The review lists where it is mailed as the owner's to choose.
      const made = (await documentProfilesRepo(target.meta).listOwnedBy(target.connectionId, 'corner-shop')).find((one) => one.kind === 'invoice');
      expect(made, JSON.stringify(reply)).toBeDefined();
      const targetModel = (await sourceOf(target)).model;
      const tid = (name: string) => targetModel.tables.find((table) => table.name === name)!.id;
      expect(made).toMatchObject({ addOnKey: 'invoices', name: 'Shop invoice', table: tid('orders'), orderBy: 'position', enabled: true });
      expect(made!.mapping).toEqual({
        number: { column: 'number' },
        clientName: { ref: 'client_id', column: 'name', table: tid('clients') },
        lines: { collection: { table: tid('order_lines'), fkColumn: 'order_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
      });
      expect(made!.options).toMatchObject({ locale: 'de-DE', paper: 'a4', prefix: 'SHOP-', literals: { footer: 'Danke' }, where: { column: 'status', in: ['sent', 'paid'] } });
      expect(made!.deliver).toEqual({ store: true, emailSlot: null });
      expect(made!.trigger).toMatchObject({ event: 'record.updated', when: { column: 'status', op: 'is', value: 'sent' }, automationId: expect.any(String) });
      expect(made!.trigger!.automationId).not.toBe('auto_source_rule_01');
      expect(await automationsRepo(target.meta).findById(made!.trigger!.automationId!)).not.toBeNull();
      const items = await target.meta.db.selectFrom('adminium_app_after_install').selectAll().execute();
      expect(items.map((item) => [item.kind, item.item])).toEqual(expect.arrayContaining([['delivery', 'orders/invoice']]));
    });
  });
}
