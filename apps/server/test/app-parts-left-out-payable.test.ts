// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PAYABLE IN A PART THAT IS LEFT OUT. An app whose quotes are paid online
 * keeps the quotes, and the table their payments land in, in a part built on
 * an add-on it only suggests. Installed without the add-on, the payable goes
 * with the part: the app installs, no payable is set up, and no role is given
 * the refund right for money the app cannot take. Connected later, the part
 * is put in with its payable, switched off for a payments manager to switch
 * on. Through the real routes, on SQLite, Postgres and MySQL.
 */
import { readFileSync } from 'node:fs';

import { manifestsRepo, payableProfilesRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { mapTableRefs } from '../src/apps/real-refs.js';
import { addOnHarness, appManifest, CRYPTO, ENGINES, type Harness } from './app-add-ons.helpers.js';

type Doc = Record<string, unknown>;
const en = (text: string) => ({ 'en-US': text });
const id = { ref: 'id', type: 'int', role: 'pk' };

const invoicesAddOn = (): Doc => ({ ...(JSON.parse(readFileSync(new URL('./fixtures/invoices-add-on.json', import.meta.url), 'utf8')) as Doc), version: '1.1.0' });

/** A part of the quote shape, spelled out as the app's own table. */
function tableOnPart(part: string, ref: string, extra: Doc[] = []): Doc {
  const names: Record<string, string> = { document: 'quotes', lines: 'quote_lines' };
  const shape = (invoicesAddOn()['addOn'] as { shapes: Doc[] }).shapes.find((one) => one['name'] === 'quote')!;
  const def = (shape['parts'] as Record<string, { columns: Doc[]; states?: Doc }>)[part]!;
  const map = (short: string) => names[short] ?? short;
  const columns = def.columns.map((column) => {
    const rules = column['rules'] as Doc | undefined;
    return {
      ...column,
      ...(typeof column['references'] === 'string' ? { references: map(column['references']) } : {}),
      ...(rules === undefined ? {} : { rules: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, name === 'rollup' ? mapTableRefs(rule, map, { refKeys: ['from'] }).value : mapTableRefs(rule, map).value])) }),
    };
  });
  return { ref, module: 'quotes', builtOn: 'invoices/quote@1', part, columns: [...columns, ...extra], ...(def.states === undefined ? {} : { states: mapTableRefs(def.states, map).value }) };
}

const page = (ref: string, table: string, module: string) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'manifest:sample', icon: 'list', order: 1 }, bindings: { rows: table }, module });

function crm(): Doc {
  return appManifest('crm', {
    version: '0.2.0',
    compatibility: { minAdminiumVersion: '0.3.60', engines: ['postgres', 'mysql', 'sqlite'] },
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.1.0', reason: en('Quotes are made by this add-on.'), checked: true }],
      features: [{ id: 'quotes', label: en('Quotes'), requires: ['invoices'] }],
    },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'quotes', label: en('Quotes'), default: 'on', feature: 'quotes' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        tableOnPart('document', 'quotes', [
          { ref: 'deal_id', type: 'fk', references: 'deals' },
          { ref: 'pay_due', type: 'decimal', scale: 2, default: 0 },
        ]),
        tableOnPart('lines', 'quote_lines'),
        {
          ref: 'quote_payments',
          module: 'quotes',
          columns: [
            id,
            { ref: 'quote_id', type: 'fk', references: 'quotes' },
            { ref: 'amount', type: 'decimal', scale: 2, default: 0 },
            { ref: 'paid_at', type: 'timestamptz', nullable: true },
            { ref: 'method', type: 'enum', enum: ['online'], default: 'online' },
            { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
            { ref: 'provider', type: 'text', maxLength: 40, nullable: true },
          ],
        },
      ],
    },
    roles: [
      { key: 'manager', name: 'Sales manager', modules: ['selling', 'quotes'], permissions: ['table:@deals:read', 'table:@quotes:read', 'page:@crm-deals:view', 'page:@crm-quotes:view', 'payments:@:refund'] },
    ],
    pages: [page('crm-deals', 'deals', 'selling'), page('crm-quotes', 'quotes', 'quotes')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
    payments: {
      payables: [
        {
          table: 'quotes',
          label: 'number',
          amount: { column: 'total' },
          currency: { fixed: 'EUR' },
          due: { column: 'pay_due' },
          payments: { kind: 'table', table: 'quote_payments', link: 'quote_id', amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', provider: 'provider' },
          payableWhen: [{ column: 'status', eq: 'accepted' }],
          receipt: 'engine',
        },
      ],
    },
  });
}

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

const stored = async (harness: Harness) => (((await manifestsRepo(harness.meta, CRYPTO).listByKey('crm'))[0] ?? null))!;
const appPayables = async (harness: Harness) => (await payableProfilesRepo(harness.meta).list(harness.connectionId)).filter((profile) => profile.ownerApp === 'crm');

for (const [dialect, available] of ENGINES) {
  describe.skipIf(!available)(`a payable in a part that is left out, on ${dialect}`, () => {
    it('goes with the part: the app installs without the add-on, and nothing is payable', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(crm());
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: '0.2.0', connectionId: h.connectionId, addOns: [] } });
      expect(planned.statusCode, planned.body).toBe(200);
      const plan = planned.json().plan;
      expect(plan.problems).toEqual([]);
      expect(plan.modules[1]).toMatchObject({ id: 'quotes', leftOut: true, tables: ['quotes', 'quote_lines', 'quote_payments'] });

      const installed = await h.install('crm', '0.2.0', { planChecksum: plan.checksum });
      expect(installed.statusCode, installed.body).toBe(200);
      expect(await h.tableNames()).not.toContain('crm_quote_payments');
      // The stored manifest is the app as it stands here: no payable, and no refund right with nothing to refund.
      const document = (await stored(h)).document as Doc;
      expect(document['payments']).toBeUndefined();
      expect(await appPayables(h)).toEqual([]);
      const role = (await rolesRepo(h.meta).list()).find((one) => one.slug === 'crm-manager')!;
      expect(role).toBeDefined();
      expect(((document['roles'] as Doc[])[0]!['permissions'] as string[])).not.toContain('payments:@:refund');
    });

    it('comes with the part when the add-on is connected afterwards, switched off', async () => {
      h = await addOnHarness(dialect);
      await h.stageAddOn(invoicesAddOn(), { bundled: true });
      await h.stageApp(crm());
      const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'crm', version: '0.2.0', connectionId: h.connectionId, addOns: [] } });
      const first = await h.install('crm', '0.2.0', { planChecksum: planned.json().plan.checksum });
      expect(first.statusCode, first.body).toBe(200);
      expect(await appPayables(h)).toEqual([]);

      const addOn = await h.inject({ method: 'POST', url: '/add-ons', payload: { key: 'invoices', version: '1.1.0', attachTo: ['crm'], connectionId: h.connectionId } });
      expect(addOn.statusCode, addOn.body).toBe(200);
      expect(await h.tableNames()).toEqual(expect.arrayContaining(['crm_quotes', 'crm_quote_payments']));
      const document = (await stored(h)).document as Doc;
      expect(((document['payments'] as Doc)['payables'] as Doc[]).map((entry) => entry['table'])).toEqual(['quotes']);
      const payables = await appPayables(h);
      expect(payables).toHaveLength(1);
      expect(payables[0]).toMatchObject({ ownerApp: 'crm', enabled: false });
    });
  });
}
