// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A studio's invoicing app and the add-on whose shape it builds on, shared by
 * the tests of the manifest's invoicing fields. Each test breaks one thing.
 */
import { validateManifest } from '../src/index.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Record<string, unknown>) => ({ ref, type: 'decimal', scale: 'currency', nullable: true, ...(rules === undefined ? {} : { rules }) });

/** The three parts of `invoices/invoice@1`, as the add-on defines them and an app spells them out. */
export function invoiceParts() {
  return {
    document: {
      columns: [
        id,
        { ref: 'number_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true, startSetting: { addOn: 'invoices', setting: 'number_start_invoice' } } } },
        { ref: 'number', type: 'text', maxLength: 24, nullable: true, rules: { format: { from: 'number_seq', prefixSetting: { addOn: 'invoices', setting: 'prefix_invoice' }, pad: 4 } } },
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
        { ref: 'issued_on', type: 'date', nullable: true, rules: { stamp: { set: 'today', on: { column: 'status', values: ['sent'] } } } },
        { ref: 'terms', type: 'enum', enum: ['net7', 'net14', 'net30', 'on-receipt'], default: 'net14' },
        {
          ref: 'due_on',
          type: 'date',
          nullable: true,
          rules: { stamp: { set: { addDays: { date: 'issued_on', days: 'terms', map: { net7: 7, net14: 14, net30: 30, 'on-receipt': 0 } } }, on: { column: 'status', values: ['sent'] } } },
        },
        { ref: 'currency', type: 'text', maxLength: 3, nullable: true, rules: { default: { from: 'connection.currency' } } },
        { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true, rules: { default: { from: { addOn: 'invoices', setting: 'default_tax_rate' } } } },
        money('subtotal', { rollup: { from: 'lines', via: 'document_id', sum: 'amount' } }),
        money('tax', { formula: { round: { div: [{ mul: ['subtotal', 'tax_rate'] }, 100] } } }),
        money('total', { formula: { add: ['subtotal', { coalesce: ['tax', 0] }] } }),
        money('paid', { rollup: { from: 'payments', via: 'document_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'total' }, cap: true } }),
        money('balance'),
        { ref: 'ladder', type: 'enum', enum: ['gentle', 'standard', 'firm'], default: 'standard' },
        { ref: 'void_reason', type: 'text', maxLength: 500, nullable: true },
      ],
      states: {
        column: 'status',
        initial: 'draft',
        moves: {
          draft: [{ to: 'sent', requires: { children: { lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
          sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] } }],
        },
        lock: { when: ['sent', 'void'], except: ['due_on', 'ladder', 'void_reason'] },
        children: { lines: { via: 'document_id', lock: true }, payments: { via: 'document_id', parentIn: ['sent'] } },
        noDelete: { when: 'numbered' },
      },
    },
    lines: {
      columns: [
        id,
        { ref: 'document_id', type: 'fk', references: 'document' },
        { ref: 'position', type: 'int', default: 0 },
        { ref: 'description', type: 'text', maxLength: 500, nullable: true },
        { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
        money('rate'),
        { ref: 'discount_kind', type: 'enum', enum: ['amount', 'percent'], default: 'amount' },
        money('discount'),
        money('amount', {
          formula: {
            if: [
              { eq: ['discount_kind', 'percent'] },
              { mul: ['qty', 'rate', { sub: [1, { div: [{ coalesce: ['discount', 0] }, 100] }] }] },
              { max: [0, { sub: [{ mul: ['qty', 'rate'] }, { coalesce: ['discount', 0] }] }] },
            ],
          },
        }),
      ],
    },
    payments: {
      columns: [
        id,
        { ref: 'document_id', type: 'fk', references: 'document' },
        { ref: 'amount', type: 'decimal', scale: 'currency' },
        { ref: 'paid_on', type: 'date' },
        { ref: 'voided', type: 'bool', default: false },
      ],
    },
  };
}

/** The app's side: the parts under its own names, plus its own tables and columns. */
export function tables(): Record<string, unknown>[] {
  const parts = invoiceParts();
  const rename = (columns: Record<string, unknown>[]) =>
    columns.map((c) => (c['references'] === 'document' ? { ...c, references: 'invoices' } : c));
  const doc = parts.document;
  return [
    {
      ref: 'settings',
      columns: [
        id,
        { ref: 'singleton', type: 'text', maxLength: 16, unique: true, default: 'studio' },
        { ref: 'reply_to', type: 'text', maxLength: 200, nullable: true },
      ],
    },
    {
      ref: 'clients',
      columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, { ref: 'contact_name', type: 'text', maxLength: 120, nullable: true }],
    },
    {
      ref: 'invoices',
      builtOn: 'invoices/invoice@1',
      part: 'document',
      columns: [
        ...doc.columns.map((c) => (c.ref === 'subtotal' ? money('subtotal', { rollup: { from: 'invoice_lines', via: 'document_id', sum: 'amount' } }) : c.ref === 'paid' ? { ...c, rules: { rollup: { ...(c as { rules: { rollup: object } }).rules.rollup, from: 'payments' } } } : c)),
        { ref: 'client_id', type: 'fk', references: 'clients' },
        { ref: 'project_id', type: 'fk', references: 'projects', nullable: true },
        { ref: 'client_paid_at', type: 'timestamptz', nullable: true },
      ],
      states: {
        ...doc.states,
        moves: {
          draft: [{ to: 'sent', requires: { children: { invoice_lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
          sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] }, roles: ['manager'] }],
        },
        lock: { when: ['sent', 'void'], except: ['due_on', 'ladder', 'void_reason', 'client_paid_at'] },
        children: {
          invoice_lines: { via: 'document_id', lock: true },
          payments: { via: 'document_id', parentIn: ['sent'], clearOnCreate: ['client_paid_at'] },
        },
      },
    },
    { ref: 'invoice_lines', builtOn: 'invoices/invoice@1', part: 'lines', columns: rename(parts.lines.columns as Record<string, unknown>[]) },
    { ref: 'payments', builtOn: 'invoices/invoice@1', part: 'payments', columns: rename(parts.payments.columns as Record<string, unknown>[]) },
    {
      ref: 'proposals',
      columns: [
        id,
        { ref: 'client_id', type: 'fk', references: 'clients' },
        { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'accepted'], default: 'draft' },
        { ref: 'valid_until', type: 'date', nullable: true },
        { ref: 'signed_name', type: 'text', maxLength: 120, nullable: true },
        { ref: 'signed_email', type: 'text', maxLength: 254, nullable: true, rules: { stamp: { set: { claim: 'email' }, on: { column: 'status', values: ['accepted'] } } } },
        {
          ref: 'fingerprint',
          type: 'text',
          maxLength: 64,
          nullable: true,
          rules: {
            stamp: {
              set: { hashOf: { columns: ['signed_name', 'signed_email'], children: [{ table: 'proposal_lines', via: 'proposal_id', columns: ['position', 'amount'], orderBy: 'position' }] } },
              on: [{ column: 'status', values: ['accepted'] }, { column: 'signed_name', filled: true }],
            },
          },
        },
      ],
      states: { column: 'status', initial: 'draft', moves: { draft: ['sent'], sent: ['accepted'] }, lock: { when: ['sent', 'accepted'], except: ['valid_until', 'signed_name'] }, onlyLater: ['valid_until'] },
    },
    { ref: 'proposal_lines', columns: [id, { ref: 'proposal_id', type: 'fk', references: 'proposals' }, { ref: 'position', type: 'int', default: 0 }, money('amount')] },
    {
      ref: 'projects',
      columns: [
        id,
        { ref: 'client_id', type: 'fk', references: 'clients' },
        { ref: 'status', type: 'enum', enum: ['active', 'paused', 'done'], default: 'active' },
        { ref: 'share_token', type: 'text', maxLength: 16, nullable: true, unique: true, rules: { code: { length: 16 } } },
        { ref: 'share_expires_on', type: 'date', nullable: true },
        { ref: 'share_stopped', type: 'bool', default: false },
        { ref: 'handover_file', type: 'text', maxLength: 64, nullable: true },
      ],
    },
    {
      ref: 'deliverable_versions',
      columns: [
        id,
        { ref: 'project_id', type: 'fk', references: 'projects' },
        { ref: 'v', type: 'int', nullable: true, rules: { sequence: { gapless: true, scope: 'project_id' } } },
        { ref: 'file', type: 'text', maxLength: 64, nullable: true },
      ],
    },
    {
      ref: 'messages',
      columns: [
        id,
        { ref: 'kind', type: 'enum', enum: ['invoice-rung-1', 'invoice-sent'] },
        { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
        { ref: 'to', type: 'text', maxLength: 254, nullable: true },
        { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
        { ref: 'invoice_id', type: 'fk', references: 'invoices', nullable: true },
        { ref: 'project_id', type: 'fk', references: 'projects', nullable: true },
        { ref: 'due', type: 'timestamptz', nullable: true },
        { ref: 'skip_reason', type: 'text', maxLength: 24, nullable: true },
        { ref: 'body_override', type: 'text', maxLength: 1000, nullable: true },
        { ref: 'effect_at', type: 'timestamptz', nullable: true },
      ],
    },
  ];
}

function template(key: string) {
  return { key, name: 'Mail', locales: { 'en-US': { subject: 'Hello', blocks: [{ block: 'email.text', data: { text: 'Hi' } }] } } };
}

export function manifest(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'studio',
    name: 'Studio',
    version: '0.2.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'studio.description', fallback: 'A studio' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    requiredSchema: { prefixed: true, tables: tables() },
    pages: [{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'studio', icon: 'home', order: 1 }, feature: 'holidays' }],
    roles: [{ key: 'manager', name: 'Manager', permissions: ['table:@invoices:update'] }],
    frontends: [{ side: 'staff', kind: 'spa' }, { side: 'customer', kind: 'spa' }],
    publicKeys: { handover: {} },
    publicAccess: [
      { table: 'clients', methods: ['GET'], select: ['contact_name'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true },
      {
        table: 'invoices',
        methods: ['GET', 'PATCH'],
        select: ['number', 'total', 'balance'],
        writable: ['client_paid_at'],
        writableWhen: { client_paid_at: [null] },
        claimedBy: { table: 'clients', column: 'client_id' },
        level: 'verified',
        documents: ['invoice', 'statement'],
      },
      { table: 'invoice_lines', methods: ['GET'], select: ['amount'], visibleWith: { table: 'invoices', via: 'document_id' }, level: 'verified' },
      { table: 'payments', methods: ['GET'], select: ['amount'], visibleWith: { table: 'invoices', via: 'document_id' }, level: 'verified', documents: ['receipt'] },
      {
        table: 'proposals',
        methods: ['GET', 'PATCH'],
        select: ['status', 'valid_until'],
        writable: ['signed_name'],
        writableWhen: { valid_until: 'from-today', signed_name: [null] },
        claimedBy: { table: 'clients', column: 'client_id' },
        level: 'verified',
      },
      { table: 'projects', methods: ['GET'], select: ['status', 'handover_file'], claim: { by: 'token', column: 'share_token', expires: 'share_expires_on', stopped: 'share_stopped' }, key: 'handover', files: ['handover_file'] },
      { table: 'deliverable_versions', methods: ['GET'], select: ['v', 'file'], visibleWith: { table: 'projects', via: 'project_id' }, key: 'handover', files: ['file'] },
    ],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to', due: 'due', skipReason: 'skip_reason', bodyOverride: 'body_override', effectAt: 'effect_at' },
      links: { invoice: 'invoice_id', client: 'client_id', project: 'project_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email' },
      kinds: { 'invoice-rung-1': 'studio-rung-1', 'invoice-sent': 'studio-invoice-sent' },
      producers: [
        {
          kind: 'invoice-rung-1',
          link: 'invoice_id',
          onChange: { table: 'invoices', column: 'status', to: 'sent' },
          hold: true,
          due: { date: 'due_on', days: { setting: { addOn: 'invoices', setting: 'ladders' }, byColumn: 'ladder', index: 0 }, at: '09:00' },
          supersede: 'rungs',
          dropWhen: [{ column: 'balance', lte: 0, reason: 'paid' }, { column: 'status', eq: 'void', reason: 'void' }],
          onSent: { table: 'projects', via: 'project_id', set: { status: 'paused' } },
        },
        { kind: 'invoice-sent', link: 'invoice_id', onChange: { table: 'invoices', column: 'status', to: 'sent' }, recipient: { setting: { table: 'settings', column: 'reply_to' } } },
      ],
    },
    emailTemplates: [{ ...template('studio-rung-1') }, { ...template('studio-invoice-sent'), attach: { kind: 'invoice', link: 'invoice' } }],
    addOns: {
      requires: [{ key: 'invoices', range: '>=1.1.0', reason: { 'en-US': 'Invoices are made by this add-on.' } }],
      suggests: [{ key: 'holiday-calendars', range: '>=1.1.0', checked: true, reason: { 'en-US': 'Public holidays as days off.' } }],
      features: [{ id: 'holidays', label: { 'en-US': 'Holidays' }, requires: ['holiday-calendars'] }],
    },
    documents: [
      {
        kind: 'statement',
        addOn: 'invoices',
        table: 'clients',
        name: { 'en-US': 'Statement' },
        mapping: { name: { column: 'contact_name' } },
        statement: {
          documents: { table: 'invoices', via: 'client_id', date: 'issued_on', amount: 'total', number: 'number', where: { column: 'status', in: ['sent', 'void'] } },
          payments: { table: 'payments', via: 'document_id', date: 'paid_on', amount: 'amount', unless: 'voided' },
        },
      },
    ],
  };
}

export type Doc = Record<string, unknown>;
export const tableOf = (m: Doc, ref: string) => ((m['requiredSchema'] as { tables: Doc[] }).tables).find((t) => t['ref'] === ref)!;
export const columnOf = (m: Doc, table: string, ref: string) => (tableOf(m, table)['columns'] as Doc[]).find((c) => c['ref'] === ref)!;
export const entryOf = (m: Doc, table: string, key?: string) => (m['publicAccess'] as Doc[]).find((e) => e['table'] === table && e['key'] === key)!;

export function messages(m: Doc): string[] {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((i) => `${i.path}: ${i.message}`);
}

export function issuesText(m: Doc): string {
  return messages(m).join('\n');
}

/** The fixture with its one deliberate fault fixed, so each test breaks exactly one thing. */
export function valid(): Doc {
  const m = manifest();
  const doc = (m['documents'] as Doc[])[0]!;
  (doc['statement'] as Doc)['payments'] = { table: 'invoices', via: 'client_id', date: 'issued_on', amount: 'paid' };
  return m;
}

export function addOnManifest(): Doc {
  return {
    kind: 'add-on',
    manifestVersion: 1,
    key: 'invoices',
    name: 'Invoices & Receipts',
    version: '1.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'invoices.description', fallback: 'Invoices' },
    categories: ['payments'],
    compatibility: { minAdminiumVersion: '0.3.1' },
    settings: [
      { key: 'number_start_invoice', type: 'number', default: 1 },
      { key: 'prefix_invoice', type: 'string', default: 'INV-' },
      { key: 'default_tax_rate', type: 'number', default: 0 },
      { key: 'ladders', type: 'json' },
    ],
    addOn: {
      attaches: [{ app: '*', range: '>=0.2.0 <1.0.0' }],
      connect: { kind: 'none' },
      shapes: [
        {
          name: 'invoice',
          version: 1,
          parts: invoiceParts(),
          documentProfiles: [
            {
              kind: 'invoice',
              part: 'document',
              name: { 'en-US': 'Invoice' },
              mapping: {
                number: { column: 'number' },
                lines: { collection: { table: 'lines', via: 'document_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
              },
            },
          ],
          outbox: {
            producers: [{ kind: 'invoice-rung-1', link: 'invoice_id', onChange: { table: 'document', column: 'status', to: 'sent' }, hold: true }],
            templates: [{ kind: 'invoice-rung-1', name: 'Rung 1', locales: { 'en-US': { subject: 'Reminder', blocks: [{ block: 'email.text' }] } } }],
          },
        },
      ],
    },
  };
}

