// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tools and the contexts, against a real meta store and a real (fake-
 * adapter, SQLite-backed) source database.
 *
 * What these cases are really about is REFUSAL. The interesting behaviour of
 * this layer is not that it can read a table — it is what happens when the
 * person the turn runs as may not, when there is no person at all, when the
 * workspace has row data switched off, and when a column holds personal data.
 * Each of those is a promise made on the Settings page, so each has a case
 * here.
 */

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDialect } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdapterRegistry,
  adapterCapabilitiesSchema,
  parseDatabaseModel,
  type AdapterProvider,
  type DatabaseAdapter,
  type DatabaseModel,
} from '@adminium/engine/adapter';
import { emailTemplatesRepo, invoiceDocumentsRepo, reportDocumentsRepo, settingsRepo } from '@adminium/meta';

import { acceptInvoiceBody } from '../src/invoices/document.js';
import { acceptReportBody } from '../src/report-documents/document.js';
import { setUpTurn } from '../src/assistant/turn-setup.js';
import { ROW_LIMIT_MAX } from '../src/assistant/tools/rows.js';
import { ROWS_UNAVAILABLE_NOTE } from '../src/assistant/tools/catalogue.js';
import {
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  type DataTestContext,
} from './connections-helpers.js';

// --- the source ---------------------------------------------------------------

function seedSqlite(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE customers (
      customer_id TEXT PRIMARY KEY,
      company_name TEXT NOT NULL,
      phone TEXT
    );
    CREATE TABLE orders (
      order_id INTEGER PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(customer_id),
      status TEXT,
      amount REAL
    );
  `);
  const customers = db.prepare('INSERT INTO customers VALUES (?, ?, ?)');
  for (let n = 1; n <= 60; n += 1) {
    customers.run(`C${String(n).padStart(3, '0')}`, `Company ${String(n)}`, `555-01${String(n).padStart(2, '0')}`);
  }
  const orders = db.prepare('INSERT INTO orders VALUES (?, ?, ?, ?)');
  orders.run(1, 'C001', 'shipped', 120);
  orders.run(2, 'C001', 'pending', 80);
  orders.run(3, 'C002', 'shipped', 40);
  return db;
}

function fakeModel(): DatabaseModel {
  return parseDatabaseModel({
    dialect: 'postgres',
    name: 'fakedb',
    defaultSchema: 'main',
    schemas: ['main'],
    tables: [
      {
        schema: 'main',
        name: 'customers',
        primaryKey: ['customer_id'],
        columns: [
          { name: 'customer_id', logicalType: 'varchar', nullable: false, isPrimaryKey: true },
          { name: 'company_name', logicalType: 'varchar', nullable: false },
          { name: 'phone', logicalType: 'varchar', nullable: true },
        ],
      },
      {
        schema: 'main',
        name: 'orders',
        primaryKey: ['order_id'],
        columns: [
          { name: 'order_id', logicalType: 'integer', nullable: false, isPrimaryKey: true },
          {
            name: 'customer_id',
            logicalType: 'varchar',
            nullable: false,
            references: { tableId: 'main.customers', column: 'customer_id' },
          },
          { name: 'status', logicalType: 'varchar', nullable: true },
          { name: 'amount', logicalType: 'decimal', nullable: true },
        ],
      },
    ],
    relations: [
      {
        id: 'fk_orders_customers',
        kind: 'declared-fk',
        cardinality: 'one-to-many',
        from: { tableId: 'main.orders', columns: ['customer_id'] },
        to: { tableId: 'main.customers', columns: ['customer_id'] },
      },
    ],
  });
}

function makeFakeRegistry(sqlite: BetterSqlite3.Database): AdapterRegistry<AdapterProvider> {
  const capabilities = adapterCapabilitiesSchema.parse({});
  const makeAdapter = (role: string): DatabaseAdapter =>
    ({
      dialect: 'postgres',
      capabilities,
      role,
      connect: async () => undefined,
      test: async () => ({
        ok: true,
        latencyMs: 1,
        serverVersion: 'FakeSQL 1.0',
        currentUser: 'fake',
        canWrite: true,
        ssl: false,
      }),
      probeCapabilities: async () => ({
        capabilities,
        privileges: { canReadSchema: true, canRead: true, canWrite: true, canDDL: true },
        serverVersion: 'FakeSQL 1.0',
        currentRole: { name: 'fake', readOnly: false },
      }),
      introspect: async () => fakeModel(),
      count: async () => ({ value: 0, capped: false }),
      sample: async () => [],
      query: async () => ({ rows: [], columns: [] }),
      mutate: async () => ({ affected: 0, returning: null }),
      close: async () => undefined,
    }) as unknown as DatabaseAdapter;

  const registry = new AdapterRegistry<AdapterProvider>();
  registry.register({
    dialect: 'postgres',
    create: (config) => makeAdapter(config.role) as never,
    createQueryEngine: () => ({
      dialect: new SqliteDialect({ database: sqlite }),
      identifiers: { quote: (identifier: string) => `"${identifier}"`, maxLength: 63 },
      serializers: {},
      destroy: async () => undefined,
    }),
  });
  return registry;
}

/** The one descriptor these cases run: how many orders in each status. */
function ordersByStatus(): Record<string, unknown> {
  return {
    shape: 'categorical',
    source: { schema: 'main', name: 'orders' },
    groupBy: ['status'],
    aggregations: [{ fn: 'count', alias: 'n' }],
  };
}

// --- the suite ----------------------------------------------------------------

let t: DataTestContext;
let connId: string;

/** A turn's setup for one page, as one of the test's people. */
async function setup(options: {
  context?: 'email' | 'invoice-template' | 'invoices' | 'report';
  user?: 'admin' | 'viewer' | null;
  managerOverride?: Partial<DataTestContext['manager']>;
} = {}) {
  const who = options.user === undefined ? 'admin' : options.user;
  const userId = who === null ? null : t.users[who].id;
  return setUpTurn({
    meta: t.meta,
    manager: (options.managerOverride === undefined
      ? t.manager
      : (Object.assign(Object.create(Object.getPrototypeOf(t.manager) as object), t.manager, options.managerOverride) as DataTestContext['manager'])),
    context: options.context ?? 'email',
    host: { connectionIds: [connId] },
    userId,
    can: () => Promise.resolve(who === 'admin'),
  });
}

/** A template row of each page's own kind, built the way its route builds one. */
async function makeInvoiceTemplate(name: string) {
  return invoiceDocumentsRepo(t.meta).create({
    kind: 'template',
    name,
    topic: 'other',
    lang: 'en',
    number: 'INV-1000',
    body: { ...acceptInvoiceBody({}) },
    summary: {
      number: 'INV-1000',
      customerName: '',
      title: 'Invoice',
      logoText: '',
      logoIcon: 'receipt',
      accent: '#4f46e5',
      currency: '$',
      cents: true,
      totalMinor: 0,
      itemCount: 0,
    },
  });
}

async function makeReportTemplate(name: string) {
  return reportDocumentsRepo(t.meta).create({
    kind: 'template',
    name,
    body: { ...acceptReportBody({ reportTitle: name }) },
    summary: {
      reportTitle: name,
      kicker: '',
      accent: '#4f46e5',
      blockCount: 0,
      kpiCount: 0,
      series: [],
      starterIcon: 'file-text',
    },
  });
}

beforeAll(async () => {
  t = await buildDataTestApp({ registry: makeFakeRegistry(seedSqlite()) });
  connId = await createConnectionViaApi(t, 'postgres://fake@fake-host:5432/fakedb');
  await introspectViaApi(t, connId);
  // The admin reads both tables; the viewer reads only orders, which is what
  // makes "you cannot read that" observable rather than theoretical.
  await t.grantTable(t.roles.admin, connId, 'main.customers', { read: true });
  await t.grantTable(t.roles.admin, connId, 'main.orders', { read: true });
  await t.grantTable(t.roles.viewer, connId, 'main.orders', { read: true });
}, 60_000);

afterAll(async () => {
  await t.app.close();
  await t.manager.disposeAll();
});

describe('what the model is allowed to know', () => {
  it('describes only the tables the person may read', async () => {
    const admin = await setup({ user: 'admin' });
    const seen = await admin.execute({ id: 'c1', tool: 'describe_schema', args: { connectionId: connId } });
    const tables = (seen.result as { tables: { id: string }[] }).tables.map((table) => table.id);
    expect(tables.sort()).toEqual(['main.customers', 'main.orders']);

    const viewer = await setup({ user: 'viewer' });
    const narrowed = await viewer.execute({ id: 'c1', tool: 'describe_schema', args: { connectionId: connId } });
    expect((narrowed.result as { tables: { id: string }[] }).tables.map((table) => table.id)).toEqual(['main.orders']);
  });

  it('says which columns hold personal data, and hides no column it may name', async () => {
    const admin = await setup({ user: 'admin' });
    const seen = await admin.execute({ id: 'c1', tool: 'describe_schema', args: { connectionId: connId } });
    const customers = (seen.result as { tables: { id: string; columns: { name: string; personalData: boolean }[] }[] }).tables.find(
      (table) => table.id === 'main.customers',
    );
    // Introspection classified `phone` as PII and proposed the mask.
    expect(customers?.columns.find((column) => column.name === 'phone')?.personalData).toBe(true);
    expect(customers?.columns.find((column) => column.name === 'company_name')?.personalData).toBe(false);
  });

  it('reads no table at all when the turn carries no person', async () => {
    const nobody = await setup({ user: null });
    const seen = await nobody.execute({ id: 'c1', tool: 'describe_schema', args: { connectionId: connId } });
    expect((seen.result as { tables: unknown[] }).tables).toEqual([]);

    const rows = await nobody.execute({
      id: 'c2',
      tool: 'read_rows',
      args: { connectionId: connId, table: 'main.orders' },
    });
    expect(rows.error?.code).toBe('TABLE_FORBIDDEN');
  });
});

describe('reading rows', () => {
  it('refuses a table the person cannot read, without opening the connection', async () => {
    let opened = false;
    const viewer = await setup({
      user: 'viewer',
      managerOverride: {
        data: () => {
          opened = true;
          throw new Error('the connection must not be opened for a forbidden table');
        },
      },
    });
    const outcome = await viewer.execute({
      id: 'c1',
      tool: 'read_rows',
      args: { connectionId: connId, table: 'main.customers' },
    });
    expect(outcome.error?.code).toBe('TABLE_FORBIDDEN');
    expect(opened).toBe(false);
    // A refusal is not a source: nothing was read.
    expect(outcome.tables).toBeUndefined();
  });

  it('masks personal data whoever is asking', async () => {
    // The admin holds `connections.manage`, which is what lets them see this
    // column unmasked in the grid. It still leaves here masked: sending a
    // value to a third-party model is a different act.
    const admin = await setup({ user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'read_rows',
      args: { connectionId: connId, table: 'main.customers', limit: 2 },
    });
    const rows = (outcome.result as { rows: Record<string, unknown>[] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.phone).toBeNull();
    expect(rows[0]?._masked).toEqual(['phone']);
    expect(rows[0]?.company_name).toBe('Company 1');
    expect(outcome.tables).toEqual([`${connId}.main.customers`]);
  });

  it('never returns more than the per-call cap, whatever was asked for', async () => {
    const admin = await setup({ user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'read_rows',
      args: { connectionId: connId, table: 'main.customers', limit: 500 },
    });
    const result = outcome.result as { rows: unknown[]; returned: number; total: number | null };
    expect(result.rows).toHaveLength(ROW_LIMIT_MAX);
    expect(result.returned).toBe(ROW_LIMIT_MAX);
    // The total is still the truth about the table, so the model knows there
    // is more than it was given.
    expect(result.total).toBe(60);
  });

  it('answers an unknown table with the advice to look first', async () => {
    const admin = await setup({ user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'read_rows',
      args: { connectionId: connId, table: 'main.invoices' },
    });
    expect(outcome.error?.code).toBe('UNKNOWN_TABLE');
    expect(outcome.error?.message).toContain('describe_schema');
  });

  it('computes an aggregate through the same compiler the widgets use', async () => {
    const admin = await setup({ context: 'report', user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'aggregate',
      args: { connectionId: connId, descriptor: ordersByStatus() },
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.tables).toEqual([`${connId}.main.orders`]);
  });

  it('tells the model which field of a descriptor it got wrong', async () => {
    const admin = await setup({ context: 'report', user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'aggregate',
      args: { connectionId: connId, descriptor: { shape: 'categorical' } },
    });
    expect(outcome.error?.code).toBe('BAD_DESCRIPTOR');
    expect(outcome.error?.message).toContain('source');
    // A refusal read nothing, so it is not a source.
    expect(outcome.tables).toBeUndefined();
  });

  it('refuses an aggregate over a table the person cannot read', async () => {
    const viewer = await setup({ context: 'report', user: 'viewer' });
    const outcome = await viewer.execute({
      id: 'c1',
      tool: 'aggregate',
      args: {
        connectionId: connId,
        descriptor: {
          shape: 'categorical',
          source: { schema: 'main', name: 'customers' },
          groupBy: ['company_name'],
          aggregations: [{ fn: 'count', alias: 'n' }],
        },
      },
    });
    expect(outcome.error?.code).toBe('TABLE_FORBIDDEN');
  });

  it('refuses to aggregate a column that holds personal data', async () => {
    // The compiler's own refusal, inherited: a total over a masked column
    // would put personal data behind a number and send it out anyway.
    const admin = await setup({ context: 'report', user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'aggregate',
      args: {
        connectionId: connId,
        descriptor: {
          shape: 'categorical',
          source: { schema: 'main', name: 'customers' },
          groupBy: ['phone'],
          aggregations: [{ fn: 'count', alias: 'n' }],
        },
      },
    });
    expect(outcome.error?.code).toBe('COLUMN_FORBIDDEN');
  });

  it('answers a descriptor that names no such connection', async () => {
    const admin = await setup({ context: 'report', user: 'admin' });
    const outcome = await admin.execute({
      id: 'c1',
      tool: 'aggregate',
      args: { connectionId: 'conn_nope', descriptor: ordersByStatus() },
    });
    expect(outcome.error?.code).toBe('CONNECTION_NOT_FOUND');
  });
});

describe('when the workspace has row data switched off', () => {
  it('drops the row tools from the catalogue and says why in the prompt', async () => {
    await settingsRepo(t.meta).set('assistant.rowData', false);
    try {
      const admin = await setup({ user: 'admin' });
      expect(admin.specs.map((spec) => spec.name)).not.toContain('read_rows');
      expect(admin.specs.map((spec) => spec.name)).not.toContain('aggregate');
      expect(admin.system).toContain(ROWS_UNAVAILABLE_NOTE);
      // And the tool does not exist to be called: the model is told what is
      // there rather than being handed a permission error it cannot act on.
      const outcome = await admin.execute({
        id: 'c1',
        tool: 'read_rows',
        args: { connectionId: connId, table: 'main.orders' },
      });
      expect(outcome.error?.code).toBe('UNKNOWN_TOOL');
      expect(outcome.error?.message).toContain('describe_schema');
    } finally {
      await settingsRepo(t.meta).set('assistant.rowData', true);
    }
  });

  it('keeps the schema and document tools, which are not row data', async () => {
    await settingsRepo(t.meta).set('assistant.rowData', false);
    try {
      const admin = await setup({ user: 'admin' });
      const names = admin.specs.map((spec) => spec.name);
      expect(names).toContain('describe_schema');
      expect(names).toContain('list_documents');
    } finally {
      await settingsRepo(t.meta).set('assistant.rowData', true);
    }
  });
});

describe('the prompt each page builds', () => {
  it('names the page, its documents and the readable tables', async () => {
    await emailTemplatesRepo(t.meta).create({
      key: 'welcome-note',
      locale: 'en_US',
      name: 'Welcome note',
      subject: 'Welcome',
      blocks: [],
      kind: 'template',
    });
    const admin = await setup({ context: 'email', user: 'admin' });
    expect(admin.system).toContain('Email templates');
    expect(admin.system).toContain('Welcome note');
    expect(admin.system).toContain('main.customers');
    // The reply contract itself is in the prompt, rendered from the schema.
    expect(admin.system).toContain('adminium.assistant/v1');
    // And the block vocabulary the page actually has.
    expect(admin.system).toContain('email.heading');
  });

  it('gives each page its own tools', async () => {
    const email = await setup({ context: 'email', user: 'admin' });
    expect(email.specs.map((spec) => spec.name)).toContain('email_variables');

    const invoices = await setup({ context: 'invoices', user: 'admin' });
    const names = invoices.specs.map((spec) => spec.name);
    expect(names).toContain('sample_record');
    expect(names).not.toContain('email_variables');

    const report = await setup({ context: 'report', user: 'admin' });
    expect(report.specs.map((spec) => spec.name)).not.toContain('sample_record');
  });

  it('counts what each page holds', async () => {
    await makeInvoiceTemplate('Standard');
    await makeReportTemplate('Quarterly');

    const invoices = await setup({ context: 'invoice-template', user: 'admin' });
    const facts = await invoices.adapter.pageFacts(invoices.deps);
    // NUMBERS, not a sentence: the page's own copy words them, because a
    // sentence composed here would be English on the wire.
    expect(facts.values.templates).toBe(1);
    expect(facts.values.pattern).toBe('INV-1000');
    expect(facts.scope.extra).toBe(2);

    const report = await setup({ context: 'report', user: 'admin' });
    const reportFacts = await report.adapter.pageFacts(report.deps);
    expect(reportFacts.values.templates).toBe(1);
    expect(reportFacts.values.tables).toBe(2);
  });
});

describe('what each page will accept as a draft', () => {
  it('refuses an email block kind the page does not have, naming it', async () => {
    const email = await setup({ context: 'email', user: 'admin' });
    const outcome = await email.adapter.acceptArtefact(
      {
        kind: 'template',
        name: 'Broken',
        locale: 'en_US',
        document: { subject: 'Hi', blocks: [{ block: 'email.hero', data: {} }] },
      },
      email.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(JSON.stringify(outcome.errors)).toContain('email.hero');
  });

  it('accepts an email document the page`s own save would accept', async () => {
    const email = await setup({ context: 'email', user: 'admin' });
    const outcome = await email.adapter.acceptArtefact(
      {
        kind: 'template',
        name: 'Welcome',
        locale: 'en_US',
        document: {
          subject: 'Welcome aboard',
          blocks: [
            { block: 'email.heading', data: { text: 'Welcome' } },
            { block: 'email.text', data: { text: 'Glad you are here.' } },
          ],
        },
      },
      email.deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // And the diff it projects reads as the document, not as JSON.
    const lines = email.adapter.projectForDiff(outcome.artefact);
    expect(lines[0]).toBe('subject: Welcome aboard');
    expect(lines).toContain('  email.heading: Welcome');
  });

  it('refuses an invoice that names no real template, or mints its own number', async () => {
    const template = await makeInvoiceTemplate('Consulting');
    const invoices = await setup({ context: 'invoices', user: 'admin' });

    const unknown = await invoices.adapter.acceptArtefact(
      { basedOn: 'inv_nothing', name: 'March', body: {} },
      invoices.deps,
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.code).toBe('TEMPLATE_NOT_FOUND');

    const numbered = await invoices.adapter.acceptArtefact(
      { basedOn: template.id, name: 'March', body: { number: 'INV-2001' } },
      invoices.deps,
    );
    expect(numbered.ok).toBe(false);
    if (!numbered.ok) expect(numbered.errors[0]?.code).toBe('NUMBER_NOT_YOURS');

    const good = await invoices.adapter.acceptArtefact(
      {
        basedOn: template.id,
        name: 'March',
        body: { customerName: 'Company 1', items: [{ desc: 'Work', qty: '2', rate: '100.00' }] },
      },
      invoices.deps,
    );
    expect(good.ok).toBe(true);
  });

  it('keeps a report`s figures with the descriptors that produced them, and saves it as a draft', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const descriptor = ordersByStatus();
    const outcome = await report.adapter.acceptArtefact(
      {
        name: 'Order mix',
        body: {
          reportTitle: 'Order mix',
          blocks: [
            { id: 'b1', block: 'kpi', title: 'Totals', w: 'full', show: true, kpis: [{ label: 'Orders', value: '3' }] },
            {
              id: 'b2',
              block: 'bar',
              title: 'By status',
              w: 'half',
              show: true,
              points: [
                { label: 'shipped', value: 2 },
                { label: 'pending', value: 1 },
              ],
            },
          ],
        },
        sources: [
          { blockId: 'b1', descriptor, reason: 'counts every order' },
          { blockId: 'b2', descriptor, reason: 'the same count, by status' },
        ],
      },
      report.deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // One descriptor per filled block, so the numbers can be re-run later.
    expect((outcome.artefact.sources as { blockId: string }[]).map((source) => source.blockId)).toEqual(['b1', 'b2']);
    // Never published by the assistant.
    expect(outcome.artefact.status).toBe('draft');

    // Rows are KINDS with their numbers, never sentences: the dashboard words
    // them, because English on the wire cannot be translated.
    const details = report.adapter.details(outcome.artefact);
    expect(details.find((row) => row.kind === 'sourcesChosen')?.args.sources).toContain('counts every order');
    expect(details.map((row) => row.kind)).toContain('notPublished');
  });

  it('refuses a report source that names a block the report does not have', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const outcome = await report.adapter.acceptArtefact(
      {
        name: 'Orphan',
        body: { reportTitle: 'Orphan', blocks: [{ id: 'b1', block: 'text', title: '', w: 'full', show: true, text: 'x' }] },
        sources: [{ blockId: 'b9', descriptor: {} }],
      },
      report.deps,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.errors[0]?.code).toBe('SOURCE_BLOCK_UNKNOWN');
  });
});

/**
 * The format spec has to name the fields the acceptor reads.
 *
 * It did not: it told the model to write `block: <kind>` — the EMAIL page's
 * field name — while this page's acceptor reads `kind` and degrades a block
 * without one to a text block reading "unknown block". Every chart the model
 * drafted came back as prose, and nothing caught it, because `projectForDiff`
 * tolerates either spelling and the artefact still validated. The scripted
 * e2e provider found it on its first real turn.
 */
describe('the report format spec', () => {
  it('names the field the acceptor reads, and the acceptor keeps the block', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const spec = report.adapter.formatSpec();
    expect(spec).toContain('kind: <kind>');
    expect(spec).not.toContain('block: <kind>');

    // The other half: a block written the way the spec describes survives.
    const outcome = await report.adapter.acceptArtefact(
      {
        name: 'Charted',
        body: {
          reportTitle: 'Charted',
          blocks: [{ id: 'b1', kind: 'bar', title: 'By status', w: 'full', show: true, series: [{ label: 'a', value: '3' }] }],
        },
      },
      report.deps,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const blocks = (outcome.artefact.body as { blocks: Record<string, unknown>[] }).blocks;
    expect(blocks[0]?.kind).toBe('bar');
    expect(blocks[0]?.series).toHaveLength(1);
  });
});

/**
 * *Run full preview*: the report's stored descriptors, executed again.
 *
 * The point of recording a descriptor beside every figure is that the figure
 * can be checked against today's database — so these cases run against the
 * seeded rows rather than a stub, and assert the numbers that come back, the
 * grants that still apply, and that a refusal is REPORTED rather than
 * leaving a stale figure beside fresh ones with nobody told.
 */
describe('re-running a report’s sources', () => {
  /** A report whose bar block was filled from `ordersByStatus`, with a figure that is now wrong. */
  function draftedReport(descriptor: Record<string, unknown>, blockId = 'b1'): Record<string, unknown> {
    return {
      name: 'Orders by status',
      body: {
        reportTitle: 'Orders by status',
        blocks: [
          { id: 'b1', kind: 'bar', title: 'By status', w: 'full', show: true, series: [{ label: 'stale', value: '999' }] },
          { id: 'b2', kind: 'kpi', title: 'Orders', w: 'half', show: true, kpis: [{ label: 'Total', value: '999' }] },
        ],
      },
      sources: [{ blockId, descriptor: { ...descriptor, connectionId: connId }, reason: 'the order counts' }],
    };
  }

  it('writes today’s answer into the block the descriptor filled', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const artefact = draftedReport(ordersByStatus());
    const run = await report.adapter.resample?.(artefact, report.deps);

    expect(run?.refreshed).toBe(1);
    expect(run?.refused).toEqual([]);
    const blocks = (run?.artefact.body as { blocks: Record<string, unknown>[] }).blocks;
    const series = blocks[0]?.series as { label: string; value: string }[];
    // The seeded rows, not the drafted figure.
    expect(series.some((point) => point.label === 'stale')).toBe(false);
    expect(series.length).toBeGreaterThan(0);
    for (const point of series) expect(Number.isNaN(Number(point.value))).toBe(false);
  });

  it('leaves the drafted artefact alone — a preview is not an edit', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const artefact = draftedReport(ordersByStatus());
    const before = JSON.stringify(artefact);
    await report.adapter.resample?.(artefact, report.deps);
    expect(JSON.stringify(artefact)).toBe(before);
  });

  it('fills a KPI from a single metric, and leaves a shape the block cannot hold', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const metric = { shape: 'single-metric', source: { schema: 'main', name: 'orders' }, aggregations: [{ fn: 'count', alias: 'n' }] };

    const kpi = await report.adapter.resample?.(draftedReport(metric, 'b2'), report.deps);
    expect(kpi?.refreshed).toBe(1);
    const filled = (kpi?.artefact.body as { blocks: Record<string, unknown>[] }).blocks[1];
    expect((filled?.kpis as { value: string }[])[0]?.value).not.toBe('999');

    // A bar cannot show one number. Nothing is written and nothing is
    // claimed: the block keeps the figure it was drafted with.
    const mismatch = await report.adapter.resample?.(draftedReport(metric, 'b1'), report.deps);
    expect(mismatch?.refreshed).toBe(0);
    const untouched = (mismatch?.artefact.body as { blocks: Record<string, unknown>[] }).blocks[0];
    expect((untouched?.series as { value: string }[])[0]?.value).toBe('999');
  });

  it('re-runs with the acting person’s grants, and says which source refused', async () => {
    // The viewer may read `orders` and not `customers`, so a descriptor over
    // customers refuses here and would not for the admin — a re-run cannot
    // reach further than the draft was allowed to.
    const report = await setup({ context: 'report', user: 'viewer' });
    const forbidden = {
      shape: 'categorical',
      source: { schema: 'main', name: 'customers' },
      groupBy: ['country'],
      aggregations: [{ fn: 'count', alias: 'n' }],
    };
    const run = await report.adapter.resample?.(draftedReport(forbidden), report.deps);

    expect(run?.refreshed).toBe(0);
    expect(run?.refused).toHaveLength(1);
    expect(run?.refused[0]?.blockId).toBe('b1');
    expect(run?.refused[0]?.message).toContain('main.customers');
    // The block keeps what it was drafted with rather than being blanked.
    const blocks = (run?.artefact.body as { blocks: Record<string, unknown>[] }).blocks;
    expect((blocks[0]?.series as { value: string }[])[0]?.value).toBe('999');
  });

  it('refuses a source with no connection rather than guessing one', async () => {
    const report = await setup({ context: 'report', user: 'admin' });
    const artefact = draftedReport(ordersByStatus());
    (artefact.sources as { descriptor: Record<string, unknown> }[])[0]!.descriptor = ordersByStatus();
    const run = await report.adapter.resample?.(artefact, report.deps);
    expect(run?.refreshed).toBe(0);
    expect(run?.refused[0]?.message).toContain('no connection');
  });

  it('belongs only to the two pages whose preview can change under it', async () => {
    // A report's figures came from a database and can be re-run; an invoice
    // TEMPLATE is a layout and can be drawn over a different record. An email
    // template and a drafted invoice are neither — their preview is the thing
    // itself, and a second look at it is the same look.
    for (const context of ['email', 'invoices'] as const) {
      const page = await setup({ context, user: 'admin' });
      expect(page.adapter.resample, context).toBeUndefined();
    }
    for (const context of ['report', 'invoice-template'] as const) {
      const page = await setup({ context, user: 'admin' });
      expect(page.adapter.resample, context).toBeTypeOf('function');
    }
  });
});

/**
 * *Preview another sample* on the invoice builder: the same template, drawn
 * over a real invoice rather than the one it was drafted with.
 */
describe('re-sampling an invoice template', () => {
  /** A drafted template, with the parties and lines the model made up. */
  function draftedTemplate(): Record<string, unknown> {
    return {
      name: 'EU services',
      body: {
        title: 'INVOICE',
        accent: '#0d9488',
        number: 'DRAFT-001',
        customerName: 'Placeholder Ltd',
        from: ['Drafted From'],
        customer: ['drafted customer'],
        items: [{ id: 'i1', desc: 'Drafted line', qty: '1', rate: '1' }],
        taxRate: '10',
      },
    };
  }

  it('keeps the template and takes the record from a real invoice', async () => {
    const page = await setup({ context: 'invoice-template', user: 'admin' });
    const made = await invoiceDocumentsRepo(t.meta).create({
      kind: 'invoice',
      name: 'Sample source',
      topic: 'other',
      lang: 'en',
      number: 'INV-9001',
      body: { ...acceptInvoiceBody({ number: 'INV-9001', customerName: 'Northwind Traders', items: [{ id: 'r1', desc: 'Real line', qty: '2', rate: '50' }] }) },
      summary: { number: 'INV-9001', customerName: 'Northwind Traders', title: 'Invoice', logoText: '', logoIcon: 'receipt', accent: '#4f46e5', currency: '$', cents: true, totalMinor: 10_000, itemCount: 1 },
    });
    try {
      const run = await page.adapter.resample?.(draftedTemplate(), page.deps);
      expect(run?.refreshed).toBe(1);
      expect(run?.refused).toEqual([]);
      const body = run?.artefact.body as Record<string, unknown>;
      // The RECORD's parties and lines…
      expect(body.customerName).toBe('Northwind Traders');
      expect(body.number).toBe('INV-9001');
      expect((body.items as { desc: string }[])[0]?.desc).toBe('Real line');
      // …and the TEMPLATE's own look, untouched.
      expect(body.accent).toBe('#0d9488');
      expect(body.taxRate).toBe('10');
      expect(body.title).toBe('INVOICE');
    } finally {
      await invoiceDocumentsRepo(t.meta).removeById(made.id);
    }
  });

  it('says there was nothing to sample rather than reporting a sample', async () => {
    const page = await setup({ context: 'invoice-template', user: 'admin' });
    const rows = await invoiceDocumentsRepo(t.meta).list({ kind: 'invoice' });
    if (rows.length > 0) return; // another case left one behind; its own assertions cover it
    const run = await page.adapter.resample?.(draftedTemplate(), page.deps);
    expect(run?.refreshed).toBe(0);
    expect(run?.refused[0]?.message).toContain('no invoice in this workspace');
  });
});
