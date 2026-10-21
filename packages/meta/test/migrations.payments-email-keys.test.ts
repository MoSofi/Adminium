// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0062 makes `payment-link` and `payment-receipt` built-in email keys. A
 * template a person made before it under one of those keys is theirs: it
 * moves to a key of its own, in every language it has, and the automation
 * steps that sent it follow — on every available dialect.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALL_MIGRATIONS, applyMigrations, automationsRepo, emailTemplatesRepo } from '../src/index.js';
import { TEST_DIALECTS, type TestDb } from './helpers/db.js';

const PRE_0062 = ALL_MIGRATIONS.filter((m) => m.name < '0062_payments');
const TRIGGER = { kind: 'record', event: 'created', connectionId: 'cnx_1', table: 'public.orders', watch: true } as const;
const graphSending = (templateKey: string) => ({
  version: 1,
  nodes: [
    { id: 'n1', kind: 'trigger', title: 'When an order is paid' },
    { id: 'n2', kind: 'action', title: 'Send the receipt', action: { kind: 'email', templateKey, to: null } },
  ],
});

for (const dialect of TEST_DIALECTS) {
  describe.skipIf(!dialect.available)(`0062 moves a person's own payment-* templates [${dialect.name}]`, () => {
    let t: TestDb;
    beforeEach(async () => {
      t = await dialect.make();
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect, migrations: PRE_0062 });
    });
    afterEach(async () => {
      await t.destroy();
    });

    const own = (key: string, locale: string, name: string) =>
      emailTemplatesRepo(t.meta).upsert(key, locale, { name, subject: name, blocks: [], enabled: true, isBuiltinCopy: false, updatedBy: null }, Date.now());

    it('gives each a free key in every language, and the steps that sent it follow', async () => {
      await own('payment-receipt', 'en_US', 'Payment receipt');
      await own('payment-receipt', 'de_DE', 'Zahlungsbeleg');
      // `-2` is taken already: the next free number is used.
      await own('payment-receipt-2', 'en_US', 'Payment receipt (old)');
      await own('payment-link', 'en_US', 'Payment link');
      await own('order-shipped', 'en_US', 'Order shipped');
      const sends = await automationsRepo(t.meta).create({ connectionId: null, name: 'Receipt', trigger: TRIGGER as never, graph: graphSending('payment-receipt') as never });
      const other = await automationsRepo(t.meta).create({ connectionId: null, name: 'Shipped', trigger: TRIGGER as never, graph: graphSending('order-shipped') as never });

      expect((await applyMigrations(t.meta.db, { dialect: t.meta.dialect })).applied).toContain('0062_payments');

      const repo = emailTemplatesRepo(t.meta);
      expect(await repo.findByKeyLocale('payment-receipt', 'en_US')).toBeNull();
      expect(await repo.findByKeyLocale('payment-receipt', 'de_DE')).toBeNull();
      expect(await repo.findByKeyLocale('payment-link', 'en_US')).toBeNull();
      expect(await repo.findByKeyLocale('payment-receipt-3', 'en_US')).toMatchObject({ name: 'Payment receipt' });
      expect(await repo.findByKeyLocale('payment-receipt-3', 'de_DE')).toMatchObject({ name: 'Zahlungsbeleg' });
      expect(await repo.findByKeyLocale('payment-receipt-2', 'en_US')).toMatchObject({ name: 'Payment receipt (old)' });
      expect(await repo.findByKeyLocale('payment-link-2', 'en_US')).toMatchObject({ name: 'Payment link' });
      expect(await repo.findByKeyLocale('order-shipped', 'en_US')).toMatchObject({ name: 'Order shipped' });

      const moved = await automationsRepo(t.meta).findById(sends.id);
      expect(JSON.stringify(moved?.graph)).toContain('"templateKey":"payment-receipt-3"');
      expect(JSON.stringify(moved?.graph)).not.toContain('"templateKey":"payment-receipt"');
      expect(JSON.stringify((await automationsRepo(t.meta).findById(other.id))?.graph)).toContain('"templateKey":"order-shipped"');
    });

    it('changes nothing in a store with no such template', async () => {
      await own('order-shipped', 'en_US', 'Order shipped');
      await applyMigrations(t.meta.db, { dialect: t.meta.dialect });
      expect((await emailTemplatesRepo(t.meta).list()).map((row) => row.key)).toEqual(['order-shipped']);
    });
  });
}
