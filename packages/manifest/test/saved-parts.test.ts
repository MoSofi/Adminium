// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a file made on an Adminium carries beyond a catalog app: rules that
 * call out (with no address in them), documents with their options, trigger
 * and delivery, report documents, invoice layouts, scheduled reports,
 * payments, and public entries with the wider methods and fields. Each new
 * word has a floor, so an older Adminium says "needs Adminium 0.3.49".
 */
import { describe, expect, it } from 'vitest';

import { appReleaseWireSchema, installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;

const TEMPLATE = { key: 'corner-shop-order-note', name: 'Order note', locales: { 'en-US': { subject: 'Order {{record.number}}', blocks: [{ block: 'email.text', data: { text: 'Total {{record.total}}.' } }] } } };

function app(over: Doc = {}): Doc {
  return {
    manifestVersion: 1,
    key: 'corner-shop',
    name: 'Corner shop',
    version: '1.0.0',
    publisher: { id: 'local', name: 'This Adminium' },
    license: 'MIT',
    description: { key: 'shop.description', fallback: 'A shop built by hand.' },
    categories: ['commerce'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'number', type: 'text', maxLength: 40 },
            { ref: 'total', type: 'money' },
            { ref: 'due', type: 'money', nullable: true },
            { ref: 'status', type: 'enum', enum: ['open', 'paid'] },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
          ],
        },
        {
          ref: 'order_payments',
          columns: [
            { ref: 'id', type: 'id', role: 'pk' },
            { ref: 'order_id', type: 'fk', references: 'orders' },
            { ref: 'amount', type: 'money' },
            { ref: 'paid_on', type: 'date' },
            { ref: 'method', type: 'text', maxLength: 40 },
            { ref: 'reference', type: 'text', maxLength: 80 },
          ],
        },
      ],
    },
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 'shop.orders', fallback: 'Orders' }, nav: { group: 'manifest:corner-shop', icon: 'list', order: 1 }, bindings: { table: 'orders' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
    ...over,
  };
}
const asCatalog = (doc: Doc): Doc => ({ ...doc, publisher: { id: 'adminium', name: 'Adminium' } });

const check = (doc: Doc, local = true): string[] => {
  const result = validateManifest(doc, { allowLocalPublisher: local });
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const words = (doc: Doc): string[] => installFloorWords(doc).map((found) => found.word);

const node = (id: string, kind: string, extra: Doc = {}) => ({ id, kind, title: id, ...extra });
/** An app whose rules may mail its one template. */
const mailing = (over: Doc): Doc => app({ emailTemplates: [TEMPLATE], ...over });
const rule = (action: Doc, trigger: Doc = { kind: 'record', event: 'created', table: 'orders' }): Doc => ({
  key: 'tell-out',
  name: 'Tell outside',
  enabled: true,
  trigger,
  graph: { version: 1, nodes: [node('t', 'trigger'), node('a', 'action', { action })] },
});

describe('rules that call out', () => {
  it('a webhook carries no address and no header value; a typed address carries no address', () => {
    expect(check(app({ automations: [rule({ kind: 'webhook', bodyKind: 'json', body: '{"n":"{{record.number}}"}', headerName: 'X-Token' })] }))).toEqual([]);
    expect(check(app({ automations: [rule({ kind: 'webhook', url: 'https://example.test/hook' })] })).join('\n')).toContain('url');
    expect(check(mailing({ automations: [rule({ kind: 'email', templateKey: 'corner-shop-order-note', to: { kind: 'fixed' } })] }))).toEqual([]);
    expect(check(mailing({ automations: [rule({ kind: 'email', templateKey: 'corner-shop-order-note', to: { kind: 'fixed', addresses: ['shop@example.test'] } })] }))).not.toEqual([]);
  });

  it('a webhook body names columns of the record', () => {
    expect(check(app({ automations: [rule({ kind: 'webhook', body: '{{record.nope}}' })] })).join('\n')).toContain('"orders" has no column "nope"');
  });

  it('a document is drawn for the rule\'s own record, from a table of the app', () => {
    const draw = (table: string) => rule({ kind: 'document.render', document: { table, kind: 'invoice' } });
    expect(check(app({ automations: [draw('orders')] }))).toEqual([]);
    expect(check(app({ automations: [draw('order_payments')] })).join('\n')).toContain('draws a document of that table');
  });

  it('a purpose is said of a marketing mail only; a rule may watch rows written around Adminium', () => {
    const mail = (extra: Doc) => rule({ kind: 'email', templateKey: 'corner-shop-order-note', to: { kind: 'field', column: 'email' }, ...extra });
    expect(check(mailing({ automations: [mail({ class: 'marketing', purpose: 'surveys' })] }))).toEqual([]);
    expect(check(mailing({ automations: [mail({ class: 'service', purpose: 'surveys' })] })).join('\n')).toContain('a purpose is said of a marketing mail');
    expect(check(app({ automations: [rule({ kind: 'notification', to: { roles: ['clerk'] }, title: 'New' }, { kind: 'record', event: 'created', table: 'orders', watch: true })], roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read'] }] }))).toEqual([]);
  });

  it('each new step and field is a word with the next release as its floor', () => {
    const doc = mailing({
      automations: [
        { ...rule({ kind: 'webhook' }, { kind: 'record', event: 'created', table: 'orders', watch: false }), key: 'a' },
        { ...rule({ kind: 'document.render', document: { table: 'orders', kind: 'invoice' } }), key: 'b' },
        { ...rule({ kind: 'email', templateKey: 'corner-shop-order-note', to: { kind: 'field', column: 'email' }, class: 'marketing', purpose: 'newsletter' }), key: 'c' },
        { ...rule({ kind: 'email', templateKey: 'corner-shop-order-note', to: { kind: 'fixed' } }), key: 'd' },
      ],
    });
    expect(words(doc)).toEqual(expect.arrayContaining(['automations.webhook', 'automations.documentRender', 'automations.purpose', 'automations.fixedAddress', 'automations.watch']));
    for (const word of ['automations.webhook', 'automations.documentRender', 'automations.purpose', 'automations.fixedAddress', 'automations.watch'] as const) expect(WORD_FLOORS[word]).toBe('0.3.49');
    // Under an older floor, the older Adminium would refuse the keys: the file says what it needs instead.
    const older = check({ ...doc, compatibility: { minAdminiumVersion: '0.3.45' } }).join('\n');
    expect(older).toContain('"automations.webhook" is read by Adminium 0.3.49 and later');
  });
});

describe('a document\'s options, trigger and delivery', () => {
  const doc = (extra: Doc): Doc =>
    app({
      addOns: { requires: [{ key: 'invoices', range: '^1.0.0', reason: { 'en-US': 'Draws the invoices' } }] },
      documents: [{ kind: 'invoice', addOn: 'invoices', table: 'orders', name: 'Invoice', mapping: { number: { column: 'number' } }, ...extra }],
    });

  it('are read for every publisher, checked against the document\'s table', () => {
    const extra = { options: { locale: 'de-DE', paper: 'a4', formats: ['pdf'], prefix: 'INV-', literals: { footer: 'Thank you' } }, trigger: { event: 'record.updated', when: { column: 'status', value: 'paid' } }, deliver: { store: true, emailSlot: 'customerEmail' } };
    expect(check(asCatalog(doc(extra)), false)).toEqual([]);
    expect(words(doc(extra))).toEqual(expect.arrayContaining(['documents.options', 'documents.trigger', 'documents.deliver']));
    expect(check(doc({ trigger: { event: 'record.updated', when: { column: 'nope' } } })).join('\n')).toContain('"orders" has no column "nope"');
    expect(check(doc({ trigger: { event: 'record.created', when: { column: 'status' } } })).join('\n')).toContain('a changed column is said of a row that is updated');
    expect(check(doc({ deliver: { emailSlot: 'to', addresses: ['a@example.test'] } }))).not.toEqual([]);
  });
});

describe('reports, invoice layouts, scheduled reports and payments', () => {
  const parts: Doc = {
    reports: [{ key: 'weekly-sales', name: 'Weekly sales', body: { reportTitle: 'Weekly sales', blocks: [] } }],
    invoiceLayouts: [{ key: 'plain', name: 'Plain invoice', topic: 'sales', lang: 'en', body: { number: 'INV-1000' } }],
    scheduledReports: [{ key: 'monday-orders', name: 'Orders on Monday', page: 'orders', schedule: { frequency: 'weekly', dayOfWeek: 1, time: '08:00' }, format: 'pdf' }],
    payments: {
      payables: [
        {
          table: 'orders',
          label: 'number',
          amount: { column: 'total', unit: 'units' },
          currency: { fixed: 'EUR' },
          due: { column: 'due' },
          payments: { kind: 'table', table: 'order_payments', link: 'order_id', amount: 'amount', date: 'paid_on', method: { column: 'method', values: { card: 'card' } }, reference: 'reference' },
          status: { column: 'status', paid: 'paid' },
          customerEmail: 'email',
          pageFields: ['number', 'total'],
        },
      ],
      ways: [{ source: 'manual', method: 'bank-transfer', enabled: true, label: { en: 'Bank transfer' }, rules: { currencies: ['EUR'] } }],
      payPage: { shopName: 'Corner shop', shopCountry: 'DE', showLines: true },
    },
  };

  it('are read from a file made on an Adminium, with the next release as their floor', () => {
    expect(check(app(parts))).toEqual([]);
    expect(words(app(parts))).toEqual(expect.arrayContaining(['reports', 'invoiceLayouts', 'scheduledReports', 'payments']));
    expect(check({ ...app(parts), compatibility: { minAdminiumVersion: '0.3.45' } }).join('\n')).toContain('"payments" is read by Adminium 0.3.49');
  });

  it('are refused from any other publisher, which the published feed never carries', () => {
    const issues = check(asCatalog(app(parts)), false).join('\n');
    for (const block of ['reports', 'invoiceLayouts', 'scheduledReports', 'payments']) expect(issues).toContain(`${block}: "${block}" is read only from a file made on an Adminium`);
    // The feed's release record is the same strict shape: no block of these is a key of it.
    expect(Object.keys(appReleaseWireSchema.shape)).not.toContain('payments');
  });

  it('never carry a recipient, a zone, a bank account or a logo', () => {
    const withExtra = (path: 'scheduledReports' | 'ways' | 'payPage', extra: Doc): Doc => {
      const copy = structuredClone(parts) as Doc & { scheduledReports: Doc[]; payments: { ways: Doc[]; payPage: Doc } };
      if (path === 'scheduledReports') Object.assign(copy.scheduledReports[0]!, extra);
      else if (path === 'ways') Object.assign(copy.payments.ways[0]!, extra);
      else Object.assign(copy.payments.payPage, extra);
      return app(copy);
    };
    expect(check(withExtra('scheduledReports', { recipients: ['boss@example.test'] }))).not.toEqual([]);
    expect(check(withExtra('scheduledReports', { schedule: { frequency: 'daily', time: '08:00', timezone: 'Europe/Berlin' } }))).not.toEqual([]);
    expect(check(withExtra('ways', { details: { accounts: [{ iban: 'DE00TEST' }] } }))).not.toEqual([]);
    expect(check(withExtra('payPage', { logoFileId: 'fil_1' }))).not.toEqual([]);
    expect(check(withExtra('payPage', { contactEmail: 'shop@example.test' }))).not.toEqual([]);
  });

  it('name the app\'s own pages and columns, each key once', () => {
    const wrong = structuredClone(parts) as Doc & { scheduledReports: Doc[]; reports: Doc[]; payments: { payables: Doc[] } };
    wrong.scheduledReports[0]!['page'] = 'nowhere';
    wrong.reports.push({ ...wrong.reports[0]! });
    wrong.payments.payables[0]!['customerEmail'] = 'mail';
    const issues = check(app(wrong)).join('\n');
    expect(issues).toContain('"nowhere" is not one of this app\'s pages');
    expect(issues).toContain('"weekly-sales" is the key of another entry of reports');
    expect(issues).toContain('"orders" has no column "mail"');
    const day = structuredClone(parts) as Doc & { scheduledReports: { schedule: Doc }[] };
    day.scheduledReports[0]!.schedule = { frequency: 'monthly', time: '08:00' };
    expect(check(app(day)).join('\n')).toContain('a monthly report names its day');
  });
});

describe('public entries with the wider methods and fields', () => {
  const entry = (extra: Doc): Doc => app({ publicAccess: [{ table: 'orders', methods: ['GET'], claim: { match: ['number', 'email'] }, ...extra }] });

  it('replace, remove and write many behind a claim, in a file made on an Adminium', () => {
    expect(check(entry({ methods: ['GET', 'PUT', 'DELETE', 'BATCH'], writable: ['email'] }))).toEqual([]);
    expect(words(entry({ methods: ['GET', 'PUT', 'DELETE', 'BATCH'] }))).toEqual(expect.arrayContaining(['publicAccess.put', 'publicAccess.delete', 'publicAccess.batch']));
    const open = app({ publicAccess: [{ table: 'orders', methods: ['GET', 'PUT', 'DELETE'] }] });
    const issues = check(open).join('\n');
    expect(issues).toContain('PUT is allowed only with a claim');
    expect(issues).toContain('DELETE is allowed only with a claim');
  });

  it('its own path, pages, rate and reply', () => {
    const extra = { path: '/open_orders', pagination: { defaultLimit: 20, maxLimit: 100, order: 'number.desc' }, rateLimit: { requests: 30, window: '1m' }, response: 'wrapped' };
    expect(check(entry(extra))).toEqual([]);
    expect(words(entry(extra))).toEqual(expect.arrayContaining(['publicAccess.path', 'publicAccess.pagination', 'publicAccess.rateLimit', 'publicAccess.response']));
    expect(check(entry({ pagination: { defaultLimit: 20, maxLimit: 100, order: 'nope.asc' } })).join('\n')).toContain('"orders" has no column "nope"');
    expect(check(entry({ pagination: { defaultLimit: 120, maxLimit: 100 } }))).not.toEqual([]);
    // The app's own key is granted the entry, and an app's pages read rows wrapped in { data }.
    expect(check(entry({ response: 'array' })).join('\n')).toContain('its entries reply "wrapped"');
  });

  it('are refused from any other publisher', () => {
    const issues = check(asCatalog(entry({ methods: ['GET', 'PUT', 'BATCH'], path: '/open_orders', response: 'array' })), false).join('\n');
    expect(issues).toContain('PUT is read only from a file made on an Adminium');
    expect(issues).toContain('BATCH is read only from a file made on an Adminium');
    expect(issues).toContain('"path" is read only from a file made on an Adminium');
    expect(issues).toContain('"response" is read only from a file made on an Adminium');
    expect(check(asCatalog(entry({ methods: ['GET', 'DELETE'] })), false).join('\n')).toContain("DELETE is allowed only on an add-on's own link");
  });
});
