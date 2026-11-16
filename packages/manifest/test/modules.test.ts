// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE PARTS OF AN APP (`modules`): what the manifest check accepts and
 * refuses, what an install leaves out while the add-on a part's tables are
 * built on is not connected, and the release an app that says it asks for.
 */
import { describe, expect, it } from 'vitest';

import { addOnManifest } from './invoicing-fixture.js';
import { installFloorWords, modulesLeftOut, optionalShapeAddOns, tablesLeftOut, validateManifest, withoutModules } from '../src/index.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const page = (ref: string, table: string, more: Doc = {}) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: table }, ...more });

function app(change: (m: Doc) => void = () => undefined, floor = '0.3.28'): Doc {
  const m: Doc = {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    addOns: {
      suggests: [{ key: 'invoices', range: '>=1.0.0', reason: en('Quotes are made by this add-on.'), checked: true }],
      features: [{ id: 'quotes', label: en('Quotes'), requires: ['invoices'] }],
    },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'jobs', label: en('Jobs on site'), default: 'off' },
      { id: 'quotes', label: en('Quotes'), default: 'on', feature: 'quotes' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'deals',
          module: 'selling',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'quote_id', type: 'int', nullable: true },
            { ref: 'quoted', type: 'decimal', scale: 'currency', nullable: true, rules: { rollup: { from: 'quotes', via: 'deal_id', latest: { of: 'total', by: 'sent_at', row: 'quote_id' } } } },
          ],
        },
        { ref: 'jobs', module: 'jobs', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }] },
        {
          ref: 'notes',
          module: 'selling',
          indexes: [['quote_id', 'deal_id']],
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }, { ref: 'quote_id', type: 'fk', references: 'quotes', nullable: true }],
        },
        {
          ref: 'quotes',
          module: 'quotes',
          builtOn: 'invoices/quote@1',
          part: 'document',
          columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals', index: true }, { ref: 'total', type: 'decimal', scale: 'currency', default: 0 }, { ref: 'sent_at', type: 'timestamptz', nullable: true }],
        },
        { ref: 'quote_lines', module: 'quotes', builtOn: 'invoices/quote@1', part: 'lines', columns: [id, { ref: 'document_id', type: 'fk', references: 'quotes' }] },
      ],
    },
    roles: [
      { key: 'rep', name: 'Sales rep', names: { 'de-DE': 'Vertrieb' }, modules: ['selling', 'quotes'], permissions: ['table:@deals:read', 'table:@quotes:read', 'table:@quotes:update', 'page:@crm-quotes:view', 'page:@crm-deals:view'], limits: { quotes: { writable: ['total'] } } },
      { key: 'quoter', name: 'Quote clerk', modules: ['quotes'], permissions: ['table:@quotes:read'] },
      { key: 'fitter', name: 'Fitter', modules: ['jobs'], permissions: ['table:@jobs:read'] },
    ],
    pages: [page('crm-deals', 'deals', { module: 'selling' }), page('crm-jobs', 'jobs', { module: 'jobs' }), page('crm-quotes', 'quotes', { module: 'quotes' }), page('crm-quote-lines', 'quote_lines')],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
  change(m);
  return m;
}

const messages = (m: Doc): string[] => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const tables = (m: Doc) => (m['requiredSchema'] as { tables: Doc[] }).tables;

describe('modules: the vocabulary', () => {
  it('accepts an app in parts, with a part built on an add-on the app only suggests', () => {
    expect(messages(app())).toEqual([]);
  });

  it('asks for the release that reads the words', () => {
    const words = installFloorWords(app()).map((found) => found.word);
    expect(words).toContain('app.modules');
    expect(words).toContain('roles.names');
    expect(messages(app(undefined, '0.3.26')).join('\n')).toContain('"app.modules" is read by Adminium 0.3.28 and later');
  });

  it('refuses a module declared twice, a feature the app does not have, and a name that is no module', () => {
    const twice = messages(app((m) => (m['modules'] as Doc[]).push({ id: 'jobs', label: en('Jobs'), default: 'on' })));
    expect(twice.join('\n')).toContain('"jobs" is declared twice');
    const feature = messages(app((m) => ((m['modules'] as Doc[])[1]!['feature'] = 'stock')));
    expect(feature.join('\n')).toContain('"stock" is not one of the app\'s addOns.features');
    for (const change of [
      (m: Doc) => (tables(m)[1]!['module'] = 'vans'),
      (m: Doc) => ((m['pages'] as Doc[])[0]!['module'] = 'vans'),
      (m: Doc) => ((m['roles'] as Doc[])[2]!['modules'] = ['vans']),
    ]) {
      expect(messages(app(change)).join('\n')).toContain('"vans" is not one of the app\'s modules');
    }
  });

  it('refuses a module named twice by one role', () => {
    expect(messages(app((m) => ((m['roles'] as Doc[])[2]!['modules'] = ['jobs', 'jobs']))).join('\n')).toContain('"jobs" is named twice');
  });

  it('still requires the add-on of a shape whose table sits in no module of that add-on', () => {
    const plain = messages(app((m) => (tables(m)[3]!['module'] = 'selling')));
    expect(plain.join('\n')).toContain('"invoices" defines the shape, so the app requires it');
    const none = messages(app((m) => delete tables(m)[4]!['module']));
    expect(none.join('\n')).toContain('"invoices" defines the shape, so the app requires it');
  });

  it('refuses the words in an add-on', () => {
    const addOn = { ...addOnManifest(), compatibility: { minAdminiumVersion: '0.3.28' }, requiredSchema: { prefixed: true, tables: [{ ref: 'notes', module: 'selling', columns: [id] }] } };
    expect(messages(addOn).join('\n')).toContain('an add-on declares no module');
  });
});

describe('modules: a part left out while its add-on is not connected', () => {
  it('names the add-ons the app installs without, and the parts each takes with it', () => {
    expect([...optionalShapeAddOns(app())]).toEqual([['invoices', ['quotes']]]);
    expect(modulesLeftOut(app(), () => false)).toEqual(['quotes']);
    expect(modulesLeftOut(app(), (key) => key === 'invoices')).toEqual([]);
    expect(tablesLeftOut(app(), ['quotes'])).toEqual(['quotes', 'quote_lines']);
    // A required add-on is always there: nothing is left out for it.
    const required = app((m) => (m['addOns'] = { requires: [{ key: 'invoices', range: '>=1.0.0', reason: en('Quotes.') }], features: [{ id: 'quotes', label: en('Quotes'), requires: ['invoices'] }] }));
    expect(messages(required)).toEqual([]);
    expect(modulesLeftOut(required, () => false)).toEqual([]);
  });

  it('takes the part out with everything that names its tables, and what is left is a whole manifest', () => {
    const full = app();
    const left = withoutModules(full, ['quotes']);
    expect(tables(left).map((table) => table['ref'])).toEqual(['deals', 'jobs', 'notes']);
    // A kept total over a table that is not there: the column stays, empty.
    const deals = tables(left)[0]!['columns'] as Doc[];
    expect(deals.map((column) => column['ref'])).toEqual(['id', 'name', 'quote_id', 'quoted']);
    expect(deals[3]!['rules']).toBeUndefined();
    // A link into it goes, with the index that read it.
    const notes = tables(left)[2]!;
    expect((notes['columns'] as Doc[]).map((column) => column['ref'])).toEqual(['id', 'deal_id']);
    expect(notes['indexes']).toBeUndefined();
    expect((left['pages'] as Doc[]).map((entry) => entry['ref'])).toEqual(['crm-deals', 'crm-jobs']);
    const roles = left['roles'] as Doc[];
    expect(roles.map((role) => role['key'])).toEqual(['rep', 'fitter']);
    expect(roles[0]).toMatchObject({ modules: ['selling'], permissions: ['table:@deals:read', 'page:@crm-deals:view'] });
    expect(roles[0]!['limits']).toBeUndefined();
    // The part stays declared: it is off, not unknown.
    expect((left['modules'] as Doc[]).map((module) => module['id'])).toEqual(['selling', 'jobs', 'quotes']);
    expect(messages(left)).toEqual([]);
    // The manifest it was cut from is not touched.
    expect(tables(full)).toHaveLength(5);
  });

  it('refuses a manifest that is not whole without the add-on', () => {
    // A formula of a kept table reads a link that goes with the part.
    const broken = app((m) => (tables(m)[2]!['columns'] as Doc[]).push({ ref: 'quote_no', type: 'int', nullable: true, rules: { formula: { coalesce: ['quote_id', 0] } } }));
    const found = messages(broken).join('\n');
    expect(found).toContain('installed without "invoices" (module "quotes" left out)');
  });

  it('leaves out a rule, a starting row, a document and a public entry of the part', () => {
    const m = app((doc) => {
      doc['automations'] = [
        { key: 'on-quote', name: en('A quote'), enabled: false, trigger: { kind: 'record', event: 'created', table: 'quotes' }, graph: { nodes: [{ id: 'a', kind: 'action', action: { kind: 'record.update', values: { total: 1 } } }] } },
        { key: 'on-deal', name: en('A deal'), enabled: false, module: 'quotes', trigger: { kind: 'record', event: 'created', table: 'deals' }, graph: { nodes: [{ id: 'a', kind: 'action', action: { kind: 'record.update', values: { name: 'x' } } }] } },
        { key: 'kept', name: en('Kept'), enabled: false, module: 'selling', trigger: { kind: 'record', event: 'created', table: 'deals' }, graph: { nodes: [{ id: 'a', kind: 'action', action: { kind: 'record.update', values: { name: 'x' } } }] } },
      ];
      doc['seeds'] = [{ table: 'quotes', rows: [{ total: 1 }] }, { table: 'deals', rows: [{ name: 'First' }] }];
    });
    const left = withoutModules(m, ['quotes']);
    expect((left['automations'] as Doc[]).map((rule) => rule['key'])).toEqual(['kept']);
    expect((left['seeds'] as Doc[]).map((seed) => seed['table'])).toEqual(['deals']);
  });
});

describe('modules: a payable of a part left out', () => {
  const money = (ref: string) => ({ ref, type: 'decimal', scale: 2, default: 0 });
  const paymentsTable = (ref: string, link: string, linkTo: string, module: string, more: Doc[] = []): Doc => ({
    ref,
    module,
    columns: [
      id,
      { ref: link, type: 'fk', references: linkTo },
      money('amount'),
      { ref: 'paid_at', type: 'timestamptz', nullable: true },
      { ref: 'method', type: 'enum', enum: ['cash', 'online'], default: 'cash' },
      { ref: 'payment_ref', type: 'text', maxLength: 64, nullable: true, unique: true },
      { ref: 'provider', type: 'text', maxLength: 40, nullable: true },
      ...more,
    ],
  });
  const payable = (table: string, payments: string, link: string, more: Doc = {}): Doc => ({
    table,
    amount: { column: table === 'quotes' ? 'total' : 'owed' },
    currency: { fixed: 'EUR' },
    due: { column: table === 'quotes' ? 'total' : 'owed' },
    payments: { kind: 'table', table: payments, link, amount: 'amount', paidAt: 'paid_at', method: { column: 'method', values: { '*': 'online' } }, reference: 'payment_ref', provider: 'provider' },
    ...more,
  });
  /** The CRM with quotes paid online, and deals that may be paid too (a deposit on the deal itself). */
  const paid = (change: (m: Doc) => void = () => undefined): Doc =>
    app((m) => {
      const all = tables(m);
      (all[0]!['columns'] as Doc[]).push(money('owed'), { ref: 'last_quote', type: 'fk', references: 'quotes', nullable: true });
      all.push(paymentsTable('quote_payments', 'quote_id', 'quotes', 'quotes'), paymentsTable('deal_payments', 'deal_id', 'deals', 'selling'));
      m['payments'] = { payables: [payable('quotes', 'quote_payments', 'quote_id'), payable('deals', 'deal_payments', 'deal_id', { pageFields: ['name', 'last_quote'] })] };
      const roles = m['roles'] as Doc[];
      (roles[0]!['permissions'] as string[]).push('payments:@:refund');
      change(m);
    }, '0.3.60');
  const payables = (m: Doc): Doc[] => ((m['payments'] as Doc | undefined)?.['payables'] as Doc[] | undefined) ?? [];

  it('goes with its table, and the manifest left is whole', () => {
    const full = paid();
    expect(messages(full)).toEqual([]);
    const left = withoutModules(full, ['quotes']);
    expect(payables(left).map((entry) => entry['table'])).toEqual(['deals']);
    // A field of the pay page that was a link into the part is dropped from the page; the payable stays.
    expect(payables(left)[0]!['pageFields']).toEqual(['name']);
    // A payable is still left: the role keeps the right to give money back.
    expect((left['roles'] as Doc[])[0]!['permissions']).toContain('payments:@:refund');
    expect(messages(left)).toEqual([]);
    expect(payables(full)).toHaveLength(2);
  });

  it('goes when its payments table is of the part, and the block goes when nothing is left', () => {
    const m = paid((doc) => {
      tables(doc).find((table) => table['ref'] === 'deal_payments')!['module'] = 'quotes';
    });
    expect(messages(m)).toEqual([]);
    const left = withoutModules(m, ['quotes']);
    expect(left['payments']).toBeUndefined();
    // No payable left: no role of the app is given the refund right.
    expect((left['roles'] as Doc[])[0]!['permissions']).not.toContain('payments:@:refund');
    expect(messages(left)).toEqual([]);
  });

  it('goes when a column it names is a link that went with the part', () => {
    const m = paid((doc) => {
      payables(doc)[1]!['label'] = 'last_quote';
    });
    expect(payables(withoutModules(m, ['quotes'])).map((entry) => entry['table'])).toEqual([]);
  });

  it('goes when its refund rows, its currency or its refund switch are kept in a table of the part', () => {
    const refundRows = { ref: 'deal_refunds', module: 'quotes', columns: [id, { ref: 'payment_id', type: 'fk', references: 'deal_payments' }, money('amount'), { ref: 'ref', type: 'text', maxLength: 64, nullable: true }, { ref: 'state', type: 'text', maxLength: 20, nullable: true }] };
    const settings = { ref: 'quote_settings', module: 'quotes', columns: [id, { ref: 'currency', type: 'text', maxLength: 3, nullable: true }, { ref: 'auto_refund', type: 'bool', default: true }] };
    const cases: ((doc: Doc) => void)[] = [
      (doc) => {
        tables(doc).push(refundRows);
        payables(doc)[1]!['refunds'] = { model: 'rows', table: 'deal_refunds', payment: 'payment_id', amount: 'amount', when: [{ column: 'state', isNull: true }], providerRef: 'ref', state: 'state' };
      },
      (doc) => {
        tables(doc).push(settings);
        payables(doc)[1]!['currency'] = { setting: { table: 'quote_settings', column: 'currency' } };
      },
      (doc) => {
        tables(doc).push(settings);
        (tables(doc)[0]!['columns'] as Doc[]).push({ ref: 'stage', type: 'enum', enum: ['open', 'lost'], default: 'open' });
        payables(doc)[1]!['status'] = { column: 'stage', paid: 'open', from: ['open'] };
        payables(doc)[1]!['refundOn'] = { moves: [{ to: 'lost', by: ['customer'] }], switch: { table: 'quote_settings', column: 'auto_refund' } };
      },
    ];
    for (const change of cases) {
      const m = paid(change);
      expect(messages(m)).toEqual([]);
      const left = withoutModules(m, ['quotes']);
      expect(left['payments']).toBeUndefined();
      expect(messages(left)).toEqual([]);
    }
  });

  it('takes the pay link off a create of a table no longer payable, and an invoice the shape maps goes with its table', () => {
    const m = paid((doc) => {
      tables(doc).find((table) => table['ref'] === 'deal_payments')!['module'] = 'quotes';
      doc['publicAccess'] = [{ table: 'deals', key: 'shop', methods: ['POST'], writable: ['name'], humanCheck: true, pay: true }];
      doc['publicKeys'] = { shop: { origins: ['https://shop.example'] } };
    });
    const left = withoutModules(m, ['quotes']);
    expect((left['publicAccess'] as Doc[])[0]!['pay']).toBeUndefined();
    const shape = withoutModules({ ...paid(), payments: { payables: [{ table: 'quotes', shape: true, receipt: 'engine' }] } }, ['quotes']);
    expect(shape['payments']).toBeUndefined();
  });
});
