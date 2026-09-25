// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An invoicing app built on an add-on's shape, installed and used over the
 * wire on the built server — the release check for what an app that numbers,
 * totals, chases and prints invoices asks of the engine.
 *
 * Two packages are made in the test, byte for byte, and uploaded as an
 * operator would: a small add-on that defines an `invoice@1` shape (a
 * document, its lines, its payments: formulas, a gapless number with a
 * prefix setting, states, three reminders held for approval, a document
 * profile) and draws documents (a stand-in renderer in its server half), and
 * an app whose tables are built on that shape. The app is installed on the
 * seeded connection of each engine, as its own principal, used, and
 * uninstalled with its tables; the add-on is removed after it.
 *
 * ── WHY OVER THE WIRE ──────────────────────────────────────────────────────
 * Every piece has its own three-engine suite in `apps/server/test`. What only
 * this proves is that they hold together through the built server: the add-on
 * store and runtime, the install that installs the add-on first, the write
 * path's formulas and numbers, the outbox's producers and the worker that
 * sends, the SMTP sink that receives, and the document pipeline.
 *
 * ── WHAT IS STILL LANDING ──────────────────────────────────────────────────
 * The steps that need pieces not on main yet are written below as
 * `test.fixme`, with their assertions, so they switch on as those land: a
 * client signing in by an emailed link and accepting a proposal (its
 * fingerprint), states and locks refusing, and the install checking the
 * app's tables against the installed shape.
 */
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

import { bundleOf } from './appBundle.js';
import { BASE_URL, SINK_URL, ownStorageStatePath, type SinkMessage } from './constants.js';
import { seededConnectionId, useOwnPrincipal } from './helpers.js';

test.describe.configure({ mode: 'serial' });
useOwnPrincipal('invoicing');

const ADD_ON = 'e2e-invoices';
const ADD_ON_VERSION = '1.0.0';
const KEY = 'e2e-ledger';
const VERSION = '1.0.0';
const PREFIX = 'e2e_ledger_';
const ZONE = 'Europe/London';
const CLEO = { email: 'cleo@ledger.dev', name: 'Cleo Park', company: 'Cleo Ltd' };

type Row = Record<string, unknown>;

// ── the add-on: a shape, and a renderer ───────────────────────────────────

const id = { ref: 'id', type: 'int', role: 'pk' };
const money = (ref: string, rules?: Record<string, unknown>, nullable = true) => ({
  ref,
  type: 'decimal',
  scale: 2,
  ...(nullable ? { nullable: true } : {}),
  ...(rules === undefined ? {} : { rules }),
});

/** The shape's parts, in the shape's own names. */
const PARTS = {
  document: {
    columns: [
      id,
      { ref: 'number_seq', type: 'int', nullable: true, rules: { sequence: { gapless: true } } },
      {
        ref: 'number',
        type: 'text',
        maxLength: 24,
        nullable: true,
        unique: true,
        rules: { format: { from: 'number_seq', prefixSetting: { addOn: ADD_ON, setting: 'prefix_invoice' }, pad: 4 } },
      },
      { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'void'], default: 'draft' },
      { ref: 'due_on', type: 'date', nullable: true },
      { ref: 'tax_rate', type: 'decimal', scale: 3, nullable: true },
      money('subtotal', { rollup: { from: 'lines', via: 'document_id', sum: 'amount' } }),
      money('tax', { formula: { round: { div: [{ mul: [{ coalesce: ['subtotal', 0] }, { coalesce: ['tax_rate', 0] }] }, 100] } } }),
      money('total', { formula: { add: [{ coalesce: ['subtotal', 0] }, { coalesce: ['tax', 0] }] } }),
      money('paid', {
        rollup: { from: 'payments', via: 'document_id', sum: 'amount', where: { column: 'voided', eq: false }, balance: { column: 'balance', of: 'total' }, cap: true },
      }),
      money('balance'),
      { ref: 'sent_at', type: 'timestamptz', nullable: true, rules: { stamp: { set: 'now', on: { column: 'status', values: ['sent'] } } } },
    ],
    states: {
      column: 'status',
      initial: 'draft',
      moves: {
        draft: [{ to: 'sent', requires: { children: { lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
        sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] } }],
      },
      lock: { when: ['sent', 'void'], except: ['due_on'] },
      children: { lines: { via: 'document_id', lock: true }, payments: { via: 'document_id', parentIn: ['sent'] } },
      noDelete: { when: 'numbered' },
    },
  },
  lines: {
    columns: [
      id,
      { ref: 'document_id', type: 'fk', references: 'document' },
      { ref: 'position', type: 'int', default: 0 },
      { ref: 'description', type: 'text', maxLength: 200, nullable: true },
      { ref: 'qty', type: 'decimal', scale: 3, default: 1 },
      money('rate'),
      money('amount', { formula: { max: [0, { mul: ['qty', { coalesce: ['rate', 0] }] }] } }),
    ],
  },
  payments: {
    columns: [
      id,
      { ref: 'document_id', type: 'fk', references: 'document' },
      money('amount', undefined, false),
      { ref: 'voided', type: 'bool', default: false },
      { ref: 'paid_on', type: 'date', nullable: true },
    ],
  },
};

/** A reminder held for approval, some days after the invoice is due; paid or void drops it. */
const rung = (n: number, table: string) => ({
  kind: `invoice-rung-${String(n)}`,
  link: 'invoice_id',
  hold: true,
  onChange: { table, column: 'status', to: 'sent' },
  due: { date: 'due_on', days: n * 7, at: '09:00' },
  dropWhen: [
    { column: 'balance', lte: 0, reason: 'paid' },
    { column: 'status', eq: 'void', reason: 'void' },
  ],
});

const SHAPE = {
  name: 'invoice',
  version: 1,
  parts: PARTS,
  documentProfiles: [
    {
      kind: 'invoice',
      part: 'document',
      name: { 'en-US': 'Invoice' },
      mapping: {
        number: { column: 'number' },
        total: { column: 'total' },
        balance: { column: 'balance' },
        lines: { collection: { table: 'lines', via: 'document_id', orderBy: 'position', columns: { description: 'description', amount: 'amount' } } },
      },
    },
  ],
  outbox: { producers: [rung(1, 'document'), rung(2, 'document'), rung(3, 'document')] },
};

/**
 * The add-on's server half: a renderer that draws a document as its subject,
 * so the test reads what a document printed from the file itself.
 */
const RENDERER = `
const SLOTS = {
  invoice: [
    { id: 'number', type: 'text', required: false },
    { id: 'clientName', type: 'text', required: false },
    { id: 'total', type: 'money', required: false },
    { id: 'balance', type: 'money', required: false },
    { id: 'lines', type: 'collection', required: false, columns: [{ id: 'description', type: 'text' }, { id: 'amount', type: 'money' }] },
  ],
};
export function kinds() {
  return [{ id: 'invoice', label: { 'en-US': 'Invoice' }, formats: ['html'], paper: ['a4'], coverage: 'winansi' }];
}
export function describe(kind) {
  return { slots: SLOTS[kind] ?? [] };
}
export async function render(input) {
  const text = JSON.stringify(input.subject).replace(/[<>&]/g, (c) => ({ '<': '\\\\u003c', '>': '\\\\u003e', '&': '\\\\u0026' })[c]);
  return [{
    format: 'html',
    filename: input.kind + '.html',
    mediaType: 'text/html; charset=utf-8',
    bytes: new TextEncoder().encode('<!doctype html><script type="application/json" id="subject">' + text + '</script>'),
    locale: input.subject.locale,
    warnings: [],
  }];
}
`;

const ADD_ON_MANIFEST = {
  kind: 'add-on',
  manifestVersion: 1,
  key: ADD_ON,
  name: 'E2E Invoices',
  version: ADD_ON_VERSION,
  publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
  license: 'AGPL-3.0-only',
  description: { key: 'addon.e2e-invoices.line', fallback: 'Numbers, totals and draws invoices.' },
  categories: ['data'],
  compatibility: { minAdminiumVersion: '0.3.0', requires: [] },
  settings: [{ key: 'prefix_invoice', type: 'string', default: 'INV-', label: { key: 'addon.e2e-invoices.prefix', fallback: 'Invoice prefix' } }],
  addOn: {
    attaches: [{ app: '*' }],
    provides: [{ contract: 'document-render', version: 1, server: 'server/documents.mjs' }],
    connect: { kind: 'none' },
    shapes: [SHAPE],
  },
};

// ── the app, built on the shape ───────────────────────────────────────────

/** The shape's part names as the app's tables. */
const TABLE_OF: Record<string, string> = { document: 'invoices', lines: 'invoice_lines', payments: 'payments' };

/** A part's columns as the app spells them: its own table names wherever the part names another part. */
function spelled(part: keyof typeof PARTS): Record<string, unknown>[] {
  return PARTS[part].columns.map((column) => {
    const out: Record<string, unknown> = { ...column };
    if (typeof out['references'] === 'string') out['references'] = TABLE_OF[out['references']];
    const rules = out['rules'] as Record<string, unknown> | undefined;
    const rollup = rules?.['rollup'] as Record<string, unknown> | undefined;
    if (rollup !== undefined) out['rules'] = { ...rules, rollup: { ...rollup, from: TABLE_OF[rollup['from'] as string] } };
    return out;
  });
}

const APP_STATES = {
  ...PARTS.document.states,
  moves: {
    draft: [{ to: 'sent', requires: { children: { invoice_lines: 1 }, where: [{ column: 'total', gt: 0 }] } }, 'void'],
    sent: [{ to: 'void', requires: { where: [{ column: 'paid', eq: 0 }] } }],
  },
  children: { invoice_lines: { via: 'document_id', lock: true }, payments: { via: 'document_id', parentIn: ['sent'] } },
};

const template = (key: string, subject: string) => ({
  key: `${KEY}-${key}`,
  name: subject,
  locales: { 'en-US': { subject, blocks: [{ block: 'email.text', data: { text: 'Hi {{recipient.first_name}}, invoice {{invoice.number}} for {{invoice.total}} is waiting.' } }] } },
});

const RUNGS = ['invoice-rung-1', 'invoice-rung-2', 'invoice-rung-3'];

function appManifest(version = VERSION, extra: Record<string, unknown> = {}, moreTables: Record<string, unknown>[] = []): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: KEY,
    name: 'E2E Ledger',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Invoices built on an add-on.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.1.0' },
    addOns: { requires: [{ key: ADD_ON, range: '>=1.0.0', reason: { 'en-US': 'Numbers, totals and draws the invoices.' } }] },
    pages: [
      {
        ref: 'e2e-ledger-invoices',
        template: 'page-crud',
        title: { key: 't', fallback: 'Invoices' },
        nav: { group: 'library', icon: 'list', order: 1 },
        bindings: { rows: 'invoices' },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'settings', columns: [id, { ref: 'studio_name', type: 'text', maxLength: 80, nullable: true }] },
        {
          ref: 'clients',
          columns: [id, { ref: 'email', type: 'text', maxLength: 254, unique: true }, { ref: 'name', type: 'text', maxLength: 120, nullable: true }, { ref: 'company', type: 'text', maxLength: 120, nullable: true }],
        },
        {
          ref: 'invoices',
          builtOn: `${ADD_ON}/invoice@1`,
          part: 'document',
          columns: [...spelled('document'), { ref: 'client_id', type: 'fk', references: 'clients' }],
          states: APP_STATES,
        },
        { ref: 'invoice_lines', builtOn: `${ADD_ON}/invoice@1`, part: 'lines', columns: spelled('lines') },
        { ref: 'payments', builtOn: `${ADD_ON}/invoice@1`, part: 'payments', columns: spelled('payments') },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: RUNGS },
            { ref: 'status', type: 'enum', enum: ['held', 'queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            { ref: 'to_address', type: 'text', maxLength: 254, nullable: true },
            { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
            { ref: 'invoice_id', type: 'fk', references: 'invoices', nullable: true },
            { ref: 'skip_reason', type: 'text', maxLength: 24, nullable: true },
            { ref: 'approved_by', type: 'text', maxLength: 120, nullable: true },
            { ref: 'due', type: 'timestamptz', nullable: true },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            { ref: 'error', type: 'text', maxLength: 200, nullable: true },
          ],
        },
        ...moreTables,
      ],
    },
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', due: 'due', sentAt: 'sent_at', error: 'error', skipReason: 'skip_reason', approvedBy: 'approved_by' },
      links: { client: 'client_id', invoice: 'invoice_id' },
      recipient: { via: 'client_id', table: 'clients', email: 'email', name: 'name' },
      settings: { table: 'settings', name: 'studio_name' },
      kinds: Object.fromEntries(RUNGS.map((kind) => [kind, `${KEY}-${kind}`])),
      producers: [rung(1, 'invoices'), rung(2, 'invoices'), rung(3, 'invoices')],
    },
    emailTemplates: [template('invoice-rung-1', 'A gentle reminder'), template('invoice-rung-2', 'A second reminder'), template('invoice-rung-3', 'A last reminder')],
    // The client's company, from the app's own table, on the shape's invoice.
    documents: [{ kind: 'invoice', addOn: ADD_ON, table: 'invoices', name: { 'en-US': 'Ledger invoice' }, mapping: { clientName: { via: 'client_id', column: 'company' } } }],
    sampleData: { file: 'seeds/ledger.sample.json' },
    ...extra,
  };
}

/** A small business's history: last month's invoices, a payment, and the studio's own settings row only if it has none. */
const SAMPLE = {
  format: 'adminium.sample/1',
  app: KEY,
  tables: [
    { ref: 'settings', rows: [{ '@label': 'studio', '@onlyIfEmpty': true, studio_name: 'Sample Studio' }] },
    {
      ref: 'clients',
      rows: [
        { '@label': 'ann', email: 'ann@sample.example', name: 'Ann Sample', company: 'Ann & Co' },
        { '@label': 'ben', email: 'ben@sample.example', name: 'Ben Sample', company: 'Ben Works' },
      ],
    },
    {
      ref: 'invoices',
      rows: [
        // A sample never numbers a row into the real series.
        { '@label': 'i1', client_id: { '@ref': 'ann' }, number_seq: null, number: null, status: 'sent', tax_rate: 20, due_on: { '@month': -1, '@dom': 14 } },
        { '@label': 'i2', client_id: { '@ref': 'ben' }, number_seq: null, number: null, status: 'draft', tax_rate: 0, due_on: { '@month': 0, '@dom': 28 } },
      ],
    },
    {
      ref: 'invoice_lines',
      rows: [
        { document_id: { '@ref': 'i1' }, position: 1, description: 'Design', qty: 2, rate: 50 },
        { document_id: { '@ref': 'i1' }, position: 2, description: 'Print', qty: 1, rate: 30 },
        { document_id: { '@ref': 'i2' }, position: 1, description: 'Hours', qty: 3, rate: 10 },
      ],
    },
    { ref: 'payments', rows: [{ document_id: { '@ref': 'i1' }, amount: 56, paid_on: { '@month': -1, '@dom': 20 } }] },
  ],
};

// ── helpers ───────────────────────────────────────────────────────────────

async function ok<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()) as T;
}

async function codeOf(response: APIResponse): Promise<string | undefined> {
  const body = (await response.json()) as { error?: { code?: string }; code?: string };
  return body.error?.code ?? body.code;
}

const num = (value: unknown): number => Number(value ?? 0);
/**
 * The day of the month a `date` column holds, as the data API spells it: the
 * day itself (`2026-08-14`), or — Postgres — the server's local midnight as an
 * instant, read back on the same machine's clock.
 */
const dayOfMonth = (value: unknown): number => {
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? Number(text.slice(8, 10)) : new Date(text).getDate();
};
const cents = (value: unknown): number => Math.round(num(value) * 100);

async function sink(request: APIRequestContext): Promise<SinkMessage[]> {
  return (await (await request.get(`${SINK_URL}/messages`)).json()) as SinkMessage[];
}

async function mailTo(request: APIRequestContext, pick: (message: SinkMessage) => boolean, label: string): Promise<SinkMessage> {
  // The worker sends on its own clock; the sweep runs once a minute.
  for (let i = 0; i < 180; i += 1) {
    const found = (await sink(request)).find(pick);
    if (found !== undefined) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the sink never received ${label}`);
}

/** The subject a stand-in document printed, read back from its bytes. */
function printed(html: string): { number: string | null; fields: Row; collections: Record<string, Row[]> } {
  const json = /<script type="application\/json" id="subject">([\s\S]*)<\/script>/.exec(html)?.[1];
  if (json === undefined) throw new Error(`not a stand-in document: ${html.slice(0, 200)}`);
  return JSON.parse(json) as { number: string | null; fields: Row; collections: Record<string, Row[]> };
}

/** The app's tables' ids on the connection, by their short name. */
async function tablesOf(staff: APIRequestContext, connectionId: string): Promise<Record<string, string>> {
  const schema = await ok<{ model: { tables: { id: string; name: string }[] } }>(await staff.get(`/api/v1/connections/${connectionId}/schema`));
  const out: Record<string, string> = {};
  for (const table of schema.model.tables) if (table.name.startsWith(PREFIX)) out[table.name.slice(PREFIX.length)] = table.id;
  return out;
}

/** Upload the add-on, then the app, and install the app — which installs and attaches the add-on first. */
async function uploadAndInstall(staff: APIRequestContext, connectionId: string, manifest: Record<string, unknown>) {
  const addOn = bundleOf({
    'package.json': JSON.stringify({ name: `@adminiumjs/add-on-${ADD_ON}`, version: ADD_ON_VERSION }),
    'manifest.json': JSON.stringify(ADD_ON_MANIFEST),
    'server/documents.mjs': RENDERER,
  });
  await ok(
    await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: addOn.buffer,
    }),
  );
  const app = bundleOf({
    'package.json': JSON.stringify({ name: `@adminium-apps/${KEY}`, version: String(manifest['version']) }),
    'manifest.json': JSON.stringify(manifest),
    'staff/index.html': '<!doctype html><html><body data-app="e2e-ledger-staff"></body></html>',
    'seeds/ledger.sample.json': JSON.stringify(SAMPLE),
  });
  await ok(
    await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, {
      headers: { 'content-type': 'application/octet-stream' },
      data: app.buffer,
    }),
  );
  const body = { key: KEY, version: String(manifest['version']), connectionId };
  const plan = await ok<{ plan: { installable: boolean; checksum: string; addOns: { key: string; action: string; source: string }[] } }>(
    await staff.post('/api/v1/apps/plan', { data: body }),
  );
  return { plan: plan.plan, install: () => staff.post('/api/v1/apps/install', { data: { ...body, planChecksum: plan.plan.checksum } }) };
}

/** Leave the shared instance as the other specs expect it. */
async function cleanUp(request: APIRequestContext, connectionId: string, priorZone: string | null): Promise<void> {
  await request.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }).catch(() => undefined);
  await request.delete(`/api/v1/add-ons/${ADD_ON}`).catch(() => undefined);
  if (connectionId !== '') await request.patch(`/api/v1/connections/${connectionId}`, { data: { timezone: priorZone } }).catch(() => undefined);
}

let connectionId = '';
let priorZone: string | null = null;

// ── the check ─────────────────────────────────────────────────────────────

test.describe('an invoicing app built on an add-on, end to end', () => {
  // After each: every test installs the two packages afresh, and none may leave them behind.
  test.afterEach(async ({ playwright }) => {
    // Signed in as this file's own principal: a cookie-less clean-up would clean nothing.
    const request = await playwright.request.newContext({ baseURL: BASE_URL, storageState: ownStorageStatePath('invoicing') });
    await cleanUp(request, connectionId, priorZone);
    await request.put('/api/v1/public-api', { data: { enabled: false } }).catch(() => undefined);
    await request.dispose();
  });

  test('installs the add-on first, numbers, totals, chases, prints and uninstalls', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    const staff = page.request;
    priorZone = (await ok<{ timezone: string | null }>(await staff.get(`/api/v1/connections/${connectionId}`))).timezone ?? null;
    await ok(await staff.patch(`/api/v1/connections/${connectionId}`, { data: { timezone: ZONE } }));

    // ── install: the add-on goes in first, attached to the app; every rule is kept ─
    const { plan, install } = await uploadAndInstall(staff, connectionId, appManifest());
    expect(plan.installable).toBe(true);
    expect(plan.addOns.map((a) => [a.key, a.action, a.source])).toEqual([[ADD_ON, 'install', 'upload']]);
    const installed = await ok<{ rules: { skipped: unknown[] }; addOns: { installed: { key: string; version: string }[]; attached: unknown[] } }>(await install());
    expect(installed.rules.skipped).toEqual([]);
    expect(installed.addOns.installed.map((a) => [a.key, a.version])).toEqual([[ADD_ON, ADD_ON_VERSION]]);
    const addOns = await ok<{ addOns: { key: string; attachedTo?: string[]; attachments?: { attachedTo: string }[] }[] }>(await staff.get('/api/v1/add-ons'));
    const ours = addOns.addOns.find((a) => a.key === ADD_ON)!;
    expect(JSON.stringify(ours)).toContain(KEY);

    const tables = await tablesOf(staff, connectionId);
    expect(Object.keys(tables).sort()).toEqual(['clients', 'invoice_lines', 'invoices', 'messages', 'payments', 'settings']);
    const data = (table: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tables[table]!)}`;
    const add = async (table: string, values: Row) => (await ok<{ data: Row }>(await staff.post(data(table), { data: { values } }), 201)).data;
    const edit = async (table: string, rowId: unknown, values: Row) =>
      (await ok<{ data: Row }>(await staff.patch(`${data(table)}/${String(rowId)}`, { data: { values } }))).data;
    const rows = async (table: string) => (await ok<{ data: Row[] }>(await staff.get(`${data(table)}?limit=200`))).data;
    const one = async (table: string, rowId: unknown) => (await ok<{ data: Row }>(await staff.get(`${data(table)}/${String(rowId)}`))).data;

    // The studio's own settings row, before the sample: the sample must keep it.
    await add('settings', { studio_name: 'Ledger Studio' });
    await ok(await staff.put(`/api/v1/add-ons/${ADD_ON}/settings`, { data: { values: { prefix_invoice: 'INV-' } } }));

    // ── sample add: every sample invoice's totals and balance equal its rows ─
    await ok(await staff.post(`/api/v1/apps/${KEY}/sample-data`));
    await expect.poll(async () => (await ok<{ loaded: boolean }>(await staff.get(`/api/v1/apps/${KEY}/sample-data`))).loaded, { timeout: 60_000 }).toBe(true);
    const settle = async () => {
      const [invoices, lines, payments] = await Promise.all([rows('invoices'), rows('invoice_lines'), rows('payments')]);
      for (const invoice of invoices) {
        const subtotal = lines.filter((l) => l['document_id'] === invoice['id']).reduce((sum, l) => sum + Math.round(num(l['qty']) * cents(l['rate'])), 0);
        const tax = Math.round((subtotal * num(invoice['tax_rate'])) / 100);
        const paid = payments.filter((p) => p['document_id'] === invoice['id'] && ![true, 1, '1', 't'].includes(p['voided'] as never)).reduce((sum, p) => sum + cents(p['amount']), 0);
        expect([cents(invoice['subtotal']), cents(invoice['tax']), cents(invoice['total']), cents(invoice['paid']), cents(invoice['balance'])], `invoice ${String(invoice['id'])}`).toEqual([
          subtotal,
          tax,
          subtotal + tax,
          paid,
          subtotal + tax - paid,
        ]);
      }
      return invoices;
    };
    const sampleInvoices = await settle();
    expect(sampleInvoices).toHaveLength(2);
    // Numbered by nothing: the real series is untouched.
    expect(sampleInvoices.map((i) => [i['number_seq'] ?? null, i['number'] ?? null])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(sampleInvoices.map((i) => cents(i['total'])).sort((a, b) => a - b)).toEqual([3000, 15600]);
    // Last month's history, whatever day it is added.
    const i1 = sampleInvoices.find((i) => cents(i['total']) === 15600)!;
    expect(dayOfMonth(i1['due_on'])).toBe(14);
    // The studio's own settings row was kept; the sample's was not added.
    expect((await rows('settings')).map((s) => s['studio_name'])).toEqual(['Ledger Studio']);

    // ── two invoices at once: consecutive numbers, never a gap or a repeat ─
    const cleo = await add('clients', CLEO);
    const created = await Promise.all([
      staff.post(data('invoices'), { data: { values: { client_id: cleo['id'], tax_rate: 20, due_on: '2026-01-10' } } }),
      staff.post(data('invoices'), { data: { values: { client_id: cleo['id'], tax_rate: 0, due_on: '2026-01-10' } } }),
    ]);
    const pair = await Promise.all(created.map(async (res) => (await ok<{ data: Row }>(res, 201)).data));
    expect(pair.map((i) => num(i['number_seq'])).sort()).toEqual([1, 2]);
    expect(pair.map((i) => i['number']).sort()).toEqual(['INV-0001', 'INV-0002']);
    const first = pair.find((i) => i['number'] === 'INV-0001')!;
    expect(dayOfMonth(first['due_on'])).toBe(10);
    const second = pair.find((i) => i['number'] === 'INV-0002')!;

    // Lines total the invoice by the shape's formulas.
    await add('invoice_lines', { document_id: first['id'], position: 2, description: 'Printing', qty: 1, rate: 20 });
    await add('invoice_lines', { document_id: first['id'], position: 1, description: 'Design', qty: 2, rate: 50 });
    const totalled = await one('invoices', first['id']);
    expect([cents(totalled['subtotal']), cents(totalled['tax']), cents(totalled['total']), cents(totalled['balance'])]).toEqual([12000, 2400, 14400, 14400]);

    // ── sending it makes its three reminders, held; a person approves one; the worker sends it ─
    const sent = await edit('invoices', first['id'], { status: 'sent' });
    expect(sent['sent_at']).not.toBeNull();
    const held = async () => (await rows('messages')).filter((m) => m['invoice_id'] === first['id']).sort((a, b) => String(a['kind']).localeCompare(String(b['kind'])));
    await expect.poll(async () => (await held()).map((m) => [m['kind'], m['status'], m['to_address']]), { timeout: 30_000 }).toEqual(
      RUNGS.map((kind) => [kind, 'held', CLEO.email]),
    );
    const [rung1] = await held();
    const approved = await edit('messages', rung1!['id'], { status: 'queued' });
    expect(approved['approved_by']).not.toBeNull();
    const reminder = await mailTo(page.request, (m) => m.to.includes(CLEO.email) && m.subject === 'A gentle reminder', 'Cleo’s first reminder');
    expect(reminder.text).toContain('INV-0001');
    await expect.poll(async () => (await held()).map((m) => m['status']), { timeout: 90_000 }).toEqual(['sent', 'held', 'held']);

    // ── money: a payment above the balance is refused; a void reopens it ─
    const over = await staff.post(data('payments'), { data: { values: { document_id: first['id'], amount: 200, paid_on: '2026-01-12' } } });
    expect(over.status()).toBe(409);
    expect(await codeOf(over)).toBe('BALANCE_EXCEEDED');
    const payment = await add('payments', { document_id: first['id'], amount: 44, paid_on: '2026-01-12' });
    expect([cents((await one('invoices', first['id']))['paid']), cents((await one('invoices', first['id']))['balance'])]).toEqual([4400, 10000]);
    await edit('payments', payment['id'], { voided: true });
    expect([cents((await one('invoices', first['id']))['paid']), cents((await one('invoices', first['id']))['balance'])]).toEqual([0, 14400]);
    // A draft voided.
    expect((await edit('invoices', second['id'], { status: 'void' }))['status']).toBe('void');

    // ── the document of a row, with its own number, the client's company and its lines in order ─
    const drawn = await staff.post(`/api/v1/apps/${KEY}/documents/render`, { data: { kind: 'invoice', ref: 'invoices', pk: { id: first['id'] } } });
    const doc = await ok<{ id: string; contentUrl: string; reused: boolean; document: { number: string } }>(drawn, 201);
    expect(doc.document.number).toBe('INV-0001');
    const sheet = printed(await (await staff.get(doc.contentUrl)).text());
    expect(sheet.number).toBe('INV-0001');
    expect(sheet.fields['clientName']).toBe(CLEO.company);
    expect(sheet.fields['total']).toBe(14400);
    expect(sheet.collections['lines']!.map((l) => l['description'])).toEqual(['Design', 'Printing']);
    // The same row, unchanged: the same document.
    const again = await ok<{ id: string; reused: boolean }>(await staff.post(`/api/v1/apps/${KEY}/documents/render`, { data: { kind: 'invoice', ref: 'invoices', pk: { id: first['id'] } } }));
    expect(again).toMatchObject({ id: doc.id, reused: true });

    // ── sample remove: its rows go, the studio's stay ────────────────────
    await ok(await staff.post(`/api/v1/apps/${KEY}/sample-data/remove`, { data: { keepChanged: false } }));
    expect((await rows('invoices')).map((i) => i['number']).sort()).toEqual(['INV-0001', 'INV-0002']);
    expect((await rows('clients')).map((c) => c['email'])).toEqual([CLEO.email]);
    expect((await rows('settings')).map((s) => s['studio_name'])).toEqual(['Ledger Studio']);

    // ── uninstall, with its tables; then the add-on ─────────────────────
    await ok(await staff.delete(`/api/v1/apps/${KEY}`, { data: { dropTables: true, confirmKey: KEY } }));
    expect(Object.keys(await tablesOf(staff, connectionId))).toEqual([]);
    const removed = await staff.delete(`/api/v1/add-ons/${ADD_ON}`);
    expect([200, 204], await removed.text()).toContain(removed.status());
  });

  /*
   * ── STILL LANDING ─────────────────────────────────────────────────────
   * Each of these installs the same two packages afresh (the flow above
   * leaves nothing behind) and asserts what its lane delivers.
   */

  // Lane I (install checks tables against the installed shape).
  test.fixme('refuses an app whose table differs from the installed shape, naming the column', async ({ page }) => {
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    const staff = page.request;
    const drifted = appManifest('1.0.1');
    const tables = (drifted['requiredSchema'] as { tables: { ref: string; columns: Row[] }[] }).tables;
    const invoices = tables.find((t) => t.ref === 'invoices')!;
    // The shape's number is 24 characters; this app's is 12.
    invoices.columns = invoices.columns.map((c) => (c['ref'] === 'number' ? { ...c, maxLength: 12 } : c));
    const { plan, install } = await uploadAndInstall(staff, connectionId, drifted);
    expect(plan.installable).toBe(false);
    const refused = await install();
    expect(refused.status()).toBe(422);
    expect(await codeOf(refused)).toBe('SHAPE_MISMATCH');
    expect(await refused.text()).toContain('invoices.number');
    expect(await tablesOf(staff, connectionId)).toEqual({});
  });

  // Lane W (states and locks, for every writer).
  test.fixme('keeps an invoice to its states: no empty send, no edit once sent, no delete once numbered', async ({ page }) => {
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    const staff = page.request;
    const { install } = await uploadAndInstall(staff, connectionId, appManifest());
    await ok(await install());
    const tables = await tablesOf(staff, connectionId);
    const data = (table: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tables[table]!)}`;
    const add = async (table: string, values: Row) => (await ok<{ data: Row }>(await staff.post(data(table), { data: { values } }), 201)).data;
    const client = await add('clients', CLEO);
    const invoice = await add('invoices', { client_id: client['id'], tax_rate: 0 });
    // Sent with no lines: refused, and why.
    const empty = await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { status: 'sent' } } });
    expect(empty.status()).toBe(409);
    expect(['DOCUMENT_EMPTY', 'STATE_MOVE_REFUSED']).toContain(await codeOf(empty));
    const line = await add('invoice_lines', { document_id: invoice['id'], description: 'Design', qty: 1, rate: 100 });
    await ok(await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { status: 'sent' } } }));
    // Once sent: its lines and its own columns are locked; the due date stays open.
    const lineEdit = await staff.patch(`${data('invoice_lines')}/${String(line['id'])}`, { data: { values: { rate: 1 } } });
    expect(lineEdit.status()).toBe(409);
    expect(await codeOf(lineEdit)).toBe('RECORD_LOCKED');
    const taxEdit = await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { tax_rate: 5 } } });
    expect(await codeOf(taxEdit)).toBe('RECORD_LOCKED');
    await ok(await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { due_on: '2026-02-01' } } }));
    // Back to draft is not a move; a numbered invoice is never deleted.
    const back = await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { status: 'draft' } } });
    expect(await codeOf(back)).toBe('STATE_MOVE_REFUSED');
    const gone = await staff.delete(`${data('invoices')}/${String(invoice['id'])}`);
    expect(gone.status()).toBe(409);
    expect(await codeOf(gone)).toBe('DELETE_REFUSED');
    // Paid in part, it cannot be voided.
    await add('payments', { document_id: invoice['id'], amount: 10, paid_on: '2026-01-12' });
    const voided = await staff.patch(`${data('invoices')}/${String(invoice['id'])}`, { data: { values: { status: 'void' } } });
    expect(await codeOf(voided)).toBe('STATE_MOVE_REFUSED');
  });

  // Lanes P (sign-in by emailed link, children only as visible as their parent) and W (a fingerprint stamped on acceptance).
  test.fixme('lets a client sign in by an emailed link, see only their own, and accept a proposal with its fingerprint', async ({ page, playwright }) => {
    await page.goto('/');
    connectionId = await seededConnectionId(page);
    const staff = page.request;
    await ok(await staff.put('/api/v1/public-api', { data: { enabled: true } }));
    // v1.1.0 adds the client's side: an emailed-link identity, their invoices, the lines only through them, and proposals they accept.
    const proposals = [
      {
        ref: 'proposals',
        columns: [
          id,
          { ref: 'client_id', type: 'fk', references: 'clients' },
          { ref: 'status', type: 'enum', enum: ['draft', 'sent', 'accepted'], default: 'draft' },
          { ref: 'signed_name', type: 'text', maxLength: 120, nullable: true },
          {
            ref: 'fingerprint',
            type: 'text',
            maxLength: 64,
            nullable: true,
            rules: {
              stamp: {
                set: { hashOf: { columns: ['signed_name'], children: [{ table: 'proposal_lines', via: 'proposal_id', columns: ['position', 'amount'], orderBy: 'position' }] } },
                on: [{ column: 'status', values: ['accepted'] }, { column: 'signed_name', filled: true }],
              },
            },
          },
        ],
      },
      { ref: 'proposal_lines', columns: [id, { ref: 'proposal_id', type: 'fk', references: 'proposals' }, { ref: 'position', type: 'int', default: 0 }, money('amount')] },
    ];
    const portal = appManifest(
      '1.1.0',
      {
        publicAccess: [
          { table: 'clients', methods: ['GET'], select: ['id', 'name', 'company'], claim: { verify: 'email-link', email: 'email' }, humanCheck: true, level: 'verified' },
          { table: 'invoices', methods: ['GET'], select: ['id', 'number', 'status', 'total', 'balance'], claimedBy: { table: 'clients', column: 'client_id' }, level: 'verified', documents: ['invoice'] },
          { table: 'invoice_lines', methods: ['GET'], select: ['id', 'description', 'amount'], visibleWith: { table: 'invoices', via: 'document_id' }, level: 'verified' },
          {
            table: 'proposals',
            methods: ['GET', 'PATCH'],
            select: ['id', 'status', 'fingerprint'],
            writable: ['status', 'signed_name'],
            writableValues: { status: ['accepted'] },
            writableWhen: { status: ['sent'] },
            claimedBy: { table: 'clients', column: 'client_id' },
            level: 'verified',
          },
        ],
      },
      proposals,
    );
    const { install } = await uploadAndInstall(staff, connectionId, portal);
    const installed = await ok<{ publicAccess: { keys: Record<string, string> } }>(await install());
    expect(Object.keys(installed.publicAccess.keys)).toEqual(['customer']);
    const tables = await tablesOf(staff, connectionId);
    const data = (table: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tables[table]!)}`;
    const add = async (table: string, values: Row) => (await ok<{ data: Row }>(await staff.post(data(table), { data: { values } }), 201)).data;
    const cleo = await add('clients', CLEO);
    const other = await add('clients', { email: 'dee@ledger.dev', name: 'Dee', company: 'Dee plc' });
    const hers = await add('invoices', { client_id: cleo['id'], tax_rate: 0 });
    const theirs = await add('invoices', { client_id: other['id'], tax_rate: 0 });
    await add('invoice_lines', { document_id: hers['id'], description: 'Design', qty: 1, rate: 100 });
    await add('invoice_lines', { document_id: theirs['id'], description: 'Secret', qty: 1, rate: 999 });

    const anonymous = await playwright.request.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
    const config = await ok<{ publishableKey: string }>(await anonymous.get(`/apps/${KEY}/customer/surface-config.json`));
    const guest = await playwright.request.newContext({
      baseURL: BASE_URL,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { authorization: `Bearer ${config.publishableKey}`, origin: BASE_URL },
    });
    // A lookup is refused for an emailed-link identity; the link request answers the same for anyone.
    const lookup = await guest.post('/api/v1/public/claim', { data: { match: { email: CLEO.email } } });
    expect(await codeOf(lookup)).toBe('PUBLIC_CLAIM_UNAVAILABLE');
    expect((await guest.post('/api/v1/public/claim/link', { data: { email: CLEO.email, lang: 'en-US' } })).status()).toBe(202);
    expect((await guest.post('/api/v1/public/claim/link', { data: { email: 'nobody@ledger.dev', lang: 'en-US' } })).status()).toBe(202);
    const mail = await mailTo(anonymous, (m) => m.to.includes(CLEO.email) && m.text.includes('/c#'), 'Cleo’s sign-in link');
    const token = /\/c#([A-Za-z0-9_-]{20,})/.exec(mail.text)![1]!;
    const signedIn = await ok<{ data: { session: string; level: string } }>(await guest.post('/api/v1/public/claim/link/verify', { data: { token } }));
    expect(signedIn.data.level).toBe('verified');
    // Used once only.
    expect((await guest.post('/api/v1/public/claim/link/verify', { data: { token } })).status()).toBe(410);
    const session = { 'x-adminium-public-session': signedIn.data.session };
    const invoices = await ok<{ data: Row[] }>(await guest.get('/api/v1/public/records/e2e_ledger_invoices_verified', { headers: session }));
    expect(invoices.data.map((i) => i['id'])).toEqual([hers['id']]);
    // Lines only through her own invoices.
    const lines = await ok<{ data: Row[] }>(await guest.get('/api/v1/public/records/e2e_ledger_invoice_lines', { headers: session }));
    expect(lines.data.map((l) => l['description'])).toEqual(['Design']);
    // Her invoice's document, drawn from the row.
    const doc = await ok<{ data: { id: string; number: string } }>(
      await guest.post('/api/v1/public/documents/render', { headers: session, data: { ref: 'e2e_ledger_invoices_verified', id: hers['id'], kind: 'invoice' } }),
      201,
    );
    expect(doc.data.number).toBe(String(hers['number']));
    // Accepting a proposal stamps its fingerprint — the signed name and its lines, hashed — once.
    const proposal = await add('proposals', { client_id: cleo['id'], status: 'sent' });
    await add('proposal_lines', { proposal_id: proposal['id'], position: 1, amount: 1200 });
    await add('proposal_lines', { proposal_id: proposal['id'], position: 2, amount: 800 });
    const accepted = await ok<{ data: Row }>(
      await guest.patch(`/api/v1/public/records/e2e_ledger_proposals_verified/${String(proposal['id'])}`, {
        headers: session,
        data: { values: { status: 'accepted', signed_name: 'Cleo Park' } },
      }),
    );
    expect(accepted.data['fingerprint']).toMatch(/^[0-9a-f]{64}$/);
    // Accepted once: a second acceptance touches nothing.
    const twice = await guest.patch(`/api/v1/public/records/e2e_ledger_proposals_verified/${String(proposal['id'])}`, {
      headers: session,
      data: { values: { status: 'accepted', signed_name: 'Someone Else' } },
    });
    expect(twice.status()).toBe(404);
    const stored = (await ok<{ data: Row }>(await staff.get(`${data('proposals')}/${String(proposal['id'])}`))).data;
    expect([stored['signed_name'], stored['fingerprint']]).toEqual(['Cleo Park', accepted.data['fingerprint']]);
    await anonymous.dispose();
    await guest.dispose();
  });
});
