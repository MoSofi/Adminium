// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVING A DATABASE'S PAYMENTS SET-UP, AND INSTALLING IT.
 *
 * Its payable tables, the ways to pay and the pay page's plain settings
 * travel; a bank account, the pay page's logo and contacts, and a payment
 * service's keys never do. The target holds the same set-up, with the bank
 * transfer off until an account is given, and the keys and the account on
 * the "after you install" list. On every engine.
 */
import { NO_RULES, payableProfilesRepo, paymentMethodsRepo, paymentSettingsRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import { PAY_PAGE_DOC, payPageSchema } from '../src/routes/payments/ways.js';
import { ENGINES } from './app-add-ons.helpers.js';
import { addOnHarness, choices, expectNoneOf, expectValid, handMadeShop, installSaved, sourceOf, withOtherParts, type Harness } from './app-save-parts.helpers.js';

const MAPPING = {
  label: 'number',
  amount: { column: 'total', unit: null },
  currency: { fixed: 'GBP' },
  due: null,
  payments: { kind: 'kept' as const },
  status: { column: 'status', paid: 'paid', refunded: null },
  customerEmail: 'email',
  customerCountry: null,
  pageFields: ['number', 'total'],
};

async function setUp(h: Harness): Promise<{ profileId: string }> {
  const orders = (await sourceOf(h)).model.tables.find((table) => table.name === 'orders')!;
  const profile = await payableProfilesRepo(h.meta).create({ connectionId: h.connectionId, tableName: orders.id, mapping: MAPPING, ownerApp: null, createdBy: null });
  const ways = paymentMethodsRepo(h.meta);
  await ways.put({ source: 'manual', method: 'bank-transfer', label: { en: 'Bank transfer' }, enabled: true, rules: { ...NO_RULES, currencies: ['GBP'] }, details: { accounts: [{ holder: 'Corner Shop Ltd', iban: 'GB33BUKB20201555555555' }] }, position: 1 });
  await ways.put({ source: 'manual', method: 'cash-on-delivery', label: null, enabled: true, rules: { ...NO_RULES, onlyFor: [profile!.id] }, details: null, position: 2 });
  await ways.put({ source: 'paylater', method: 'card', label: null, enabled: true, rules: NO_RULES, details: null, position: 3 });
  await paymentSettingsRepo(h.meta).set(PAY_PAGE_DOC, payPageSchema, { shopName: 'Corner shop', logoFileId: 'file_logo_0002', contactEmail: 'pay@shop.example.test', contactPhone: '+44 20 7946 0002', shopCountry: 'GB', showLines: true });
  return { profileId: profile!.id };
}

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`saving a database's payments set-up [${dialect}]`, () => {
    const open: Harness[] = [];
    afterEach(async () => {
      for (const h of open.splice(0)) await h.close();
    });

    it('travels without a bank account, a logo, contacts or keys, and installs as the same set-up', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      const { profileId } = await setUp(h);
      const result = await convertToApp(await sourceOf(h), choices());
      const doc = withOtherParts(result);

      expect(doc['payments']).toEqual({
        payables: [{ table: 'orders', label: 'number', amount: { column: 'total' }, currency: { fixed: 'GBP' }, payments: { kind: 'kept' }, status: { column: 'status', paid: 'paid' }, customerEmail: 'email', pageFields: ['number', 'total'] }],
        ways: [
          { source: 'manual', method: 'bank-transfer', enabled: true, label: { en: 'Bank transfer' }, rules: { currencies: ['GBP'] }, position: 1 },
          { source: 'manual', method: 'cash-on-delivery', enabled: true, position: 2 },
          { source: 'paylater', method: 'card', enabled: true, position: 3 },
        ],
        payPage: { shopName: 'Corner shop', shopCountry: 'GB', showLines: true },
      });
      // A way to pay from a service: the service is suggested, its keys are given after installing.
      expect(doc['addOns']).toEqual({ suggests: [{ key: 'paylater', range: '>=0.0.0', reason: { 'en-US': 'Used because it takes payments.' }, checked: true }] });
      expectNoneOf(doc, [profileId, h.connectionId, 'GB33BUKB', 'Corner Shop Ltd', 'file_logo_0002', 'pay@shop', '7946']);
      const after = result.check.filter((item) => item.group === 'after').map((item) => [item.code, item.item, item.afterKind]);
      expect(after).toEqual(expect.arrayContaining([['BANK_ACCOUNT', 'manual/bank-transfer', 'bank-account'], ['PAYMENT_KEY', 'paylater', 'payment-key']]));
      expect(result.check.map((item) => item.code)).toEqual(expect.arrayContaining(['PAYMENT_WAY_NARROWED', 'PAY_PAGE_CONTACTS']));
      expectNoneOf(result.check, ['GB33BUKB', 'pay@shop', profileId]);
      expectValid(doc);

      const target = await addOnHarness(dialect, { unbuiltWords: {} });
      open.push(target);
      await installSaved(target, doc);
      const [payable] = await payableProfilesRepo(target.meta).list(target.connectionId);
      expect(payable).toMatchObject({ ownerApp: 'corner-shop', enabled: true });
      expect(payable!.tableName).toMatch(/orders$/);
      expect(payable!.mapping).toEqual({ ...MAPPING, payments: { kind: 'kept' } });
      const ways = await paymentMethodsRepo(target.meta).list();
      // The service is not installed there: its way waits for it. The transfer waits, off, for an account.
      expect(ways.map((way) => [way.source, way.method, way.enabled, way.details, way.position])).toEqual([
        ['manual', 'bank-transfer', false, null, 1],
        ['manual', 'cash-on-delivery', true, null, 2],
      ]);
      expect(ways[0]!.rules.currencies).toEqual(['GBP']);
      expect(await paymentSettingsRepo(target.meta).get(PAY_PAGE_DOC, payPageSchema)).toEqual({ shopName: 'Corner shop', logoFileId: null, contactEmail: null, contactPhone: null, shopCountry: 'GB', showLines: true });
    });

    it('nothing when the person said no, or when no table is set up to be paid', async () => {
      const h = await handMadeShop(dialect);
      open.push(h);
      await paymentMethodsRepo(h.meta).put({ source: 'manual', method: 'cash-on-delivery', label: null, enabled: true, rules: NO_RULES, details: null, position: 0 });
      expect((await convertToApp(await sourceOf(h), choices())).manifest.payments).toBeUndefined();
      await setUp(h);
      expect((await convertToApp(await sourceOf(h), choices({ payments: false }))).manifest.payments).toBeUndefined();
    });
  });
}
