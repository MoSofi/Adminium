// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP: PAGES AND THEIR VIEWS, SAVED AND INSTALLED AGAIN.
 *
 * A database's generated pages, one list a person rearranged, a dashboard of
 * their own whose cards read two tables, a list at a long address another
 * page links to, a shared view and a personal one: saved into an app file,
 * validated, and installed on a fresh database of the same engine. The
 * target's pages show the same columns, order, sort, filters, cards and views.
 *
 * A page nobody touched travels in the short form. No connection, no page id
 * and no id of the source install is anywhere in the written pages, and a
 * widget's schema is the target's own (Postgres only).
 *
 * The tables part is another part's; its `requiredSchema` is written here by
 * hand, as that part writes it for these two tables.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { pageEnvelopeSchema } from '@adminium/engine/config';
import { validateManifest, type AppManifest } from '@adminium/manifest';
import { overridesRepo, pagesRepo, snapshotsRepo, viewsRepo, type Page } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { convertToApp } from '../src/apps/save/convert.js';
import type { SaveChoices, SaveSource } from '../src/apps/save/types.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runGeneration } from '../src/generate/run.js';
import { isUntouched } from '../src/pages/generated-stamp.js';
import { findInstanceIds } from '../src/project/instance-ids.js';
import { buildUserPageEnvelope } from '../src/routes/pages/envelope.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const LONG_SLUG = 'customers-with-their-whole-order-history';

function ddl(dialect: Dialect): string[] {
  const when = dialect === 'mysql' ? 'DATETIME NULL' : 'TIMESTAMP';
  return [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(120))',
    `CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, total DECIMAL(10,2), note TEXT, placed_at ${when}, FOREIGN KEY (customer_id) REFERENCES customers(id))`,
  ];
}

/** The tables as the tables part writes them. */
const REQUIRED_SCHEMA = {
  tables: [
    { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 120, nullable: true }] },
    {
      ref: 'orders',
      columns: [
        { ref: 'id', type: 'int', role: 'pk' },
        { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
        { ref: 'total', type: 'decimal', precision: 10, scale: 2, nullable: true },
        { ref: 'note', type: 'text', nullable: true },
        { ref: 'placed_at', type: 'timestamptz', nullable: true },
      ],
    },
  ],
};

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

async function harness(dialect: Dialect): Promise<Harness> {
  const h = await installHarness(dialect);
  harnesses.push(h);
  return h;
}

async function modelOf(h: Harness): Promise<DatabaseModel> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return parseDatabaseModel(snapshot!.schema);
}

async function pageAt(h: Harness, slug: string): Promise<Page> {
  const found = await pagesRepo(h.meta).findBySlug(h.connectionId, slug);
  expect(found, `no page at /p/${slug}`).not.toBeNull();
  return found!;
}

const body = (p: Page): Doc => (p.config as { config: Doc }).config;

interface Source {
  h: Harness;
  model: DatabaseModel;
  ownerId: string;
  personalViewId: string;
  sharedViewId: string;
}

/** A database with generated pages, and the edits a person makes. */
async function sourceDatabase(dialect: Dialect): Promise<Source> {
  const h = await harness(dialect);
  for (const statement of ddl(dialect)) await h.run(statement);
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  await runGeneration({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  const model = await modelOf(h);
  const id = (name: string) => model.tables.find((t) => t.name === name)!.id;
  const table = (name: string) => model.tables.find((t) => t.name === name)!;
  const pages = pagesRepo(h.meta);
  const ownerId = (await h.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id;

  // The orders list, rearranged: total first and renamed, a width, the note hidden, an order and a filter of its own.
  const orders = await pages.findBySlug(h.connectionId, 'orders');
  expect(orders).not.toBeNull();
  const generated = body(orders!)['columns'] as Doc[];
  const column = (name: string) => generated.find((c) => c['name'] === name)!;
  await pages.setTemplateConfig(orders!.id, {
    ...body(orders!),
    columns: [
      { ...column('total'), label: 'Amount', width: '9rem' },
      column('customer_id'),
      { ...column('id'), hidden: false, label: 'No.' },
      { ...column('note'), hidden: true },
      column('placed_at'),
    ],
    defaultSort: [{ column: 'total', dir: 'desc' }],
    pageSize: 25,
    filters: [{ column: 'total', control: 'number-range', label: 'Amount' }],
  });

  const ordersOfCustomer = model.relations.find((r) => r.from.tableId === id('orders') && r.to.tableId === id('customers'))!.id;
  // A list of customers at a long address, made by hand, with the orders as a related tab.
  const longId = 'page_long';
  const made = buildUserPageEnvelope({ id: longId, slug: LONG_SLUG, title: 'Customers and orders', template: 'page-crud', navGroup: 'people', navOrder: 4, connectionId: h.connectionId, table: id('customers') });
  await pages.create({ id: longId, connectionId: h.connectionId, slug: LONG_SLUG, type: 'page-crud', title: 'Customers and orders', config: made, origin: 'user', navGroup: 'people', navOrder: 4 });
  await pages.setTemplateConfig(longId, {
    ...((made['config'] as Doc | undefined) ?? {}),
    columns: [{ name: 'name', label: 'Customer', width: '14rem', logicalType: 'text', nullable: false }, { name: 'email', label: 'Mail', semantic: 'email' }],
    keyField: 'name',
    detail: { template: 'page-record', tabsFromInboundFks: false, tabs: [{ table: id('orders'), fkColumn: 'customer_id', label: 'Orders' }] },
    // A form whose orders are edited in place: its field names the relation by an id that holds both tables' ids.
    form: { v: 2, sections: [{ id: 'main', fields: [{ column: 'name' }, { column: 'email' }, { relation: ordersOfCustomer, control: 'child-rows', columns: [{ column: 'note' }, { column: 'total' }] }] }] },
  });

  // A dashboard of the person's own: two cards over two tables, one drilling into the long list.
  const schemaOf = (name: string) => (dialect === 'postgres' ? { schema: table(name).schema } : {});
  const overview = buildUserPageEnvelope({ id: 'page_overview', slug: 'overview', title: 'Overview', template: 'page-dashboard', navGroup: 'workspace', navOrder: 1, connectionId: h.connectionId });
  await pages.create({ id: 'page_overview', connectionId: h.connectionId, slug: 'overview', type: 'page-dashboard', title: 'Overview', config: overview, origin: 'user', navGroup: 'workspace', navOrder: 1 });
  await pages.setLayout('page_overview', {
    version: 1,
    toolbar: { link: { label: 'Every customer', href: `/p/${LONG_SLUG}` } },
    items: [
      { i: 'count', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title: 'Orders', binding: { kind: 'table-query', connectionId: h.connectionId, source: { name: 'orders', type: 'table', ...schemaOf('orders') }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] } } },
      { i: 'buyers', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { title: 'Buyers', href: `/p/${LONG_SLUG}?sort=name`, binding: { kind: 'table-query', connectionId: h.connectionId, source: { name: 'customers', type: 'table', ...schemaOf('customers') }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] } } },
    ],
  });
  await pages.setTemplateConfig('page_overview', { ...body((await pages.findById('page_overview'))!), domain: { key: 'shop', label: 'Shop', tables: [id('orders'), id('customers')] } });
  // Somebody's own arrangement of it: never a view of the app.
  await viewsRepo(h.meta).upsertLayoutOverride('page_overview', ownerId, { version: 1, items: [] });

  // A shared view (one of its filters names a person of this install), and somebody's own.
  const views = viewsRepo(h.meta);
  const shared = await views.create({ pageId: orders!.id, userId: null, name: 'Big', isDefault: true, config: { v: 1, sort: { column: 'total', dir: 'desc' }, filters: [{ column: 'total', op: 'gt', value: 100 }, { column: 'note', op: 'eq', value: ownerId }, { column: 'customer_id', op: 'eq', value: 1 }], pageSize: 25 } });
  const personal = await views.create({ pageId: orders!.id, userId: ownerId, name: 'Mine', isDefault: true, config: { v: 1, filters: [{ column: 'total', op: 'lt', value: 10 }] } });
  return { h, model, ownerId, personalViewId: personal.id, sharedViewId: shared.id };
}

function choices(extra: Partial<SaveChoices> = {}): SaveChoices {
  return { key: 'shop', name: 'Shop', version: '1.0.0', label: 'The test shop', lineage: 'lineage-0001', savedAt: '2026-11-06T10:00:00.000Z', ...extra };
}

function saveSource(s: Source, dialect: Dialect): SaveSource {
  return { meta: s.h.meta, connectionId: s.h.connectionId, dialect, model: s.model, adminiumVersion: '0.4.0' };
}

const pageOf = (manifest: AppManifest, ref: string) => {
  const found = manifest.pages.find((p) => p.ref === ref);
  expect(found, `no page "${ref}" in the file`).toBeDefined();
  return found!;
};

describe.each(ENGINES)('pages saved into an app on %s', (dialect, available) => {
  it.skipIf(!available)('install on a fresh database with the same columns, order, sort, cards and views', async () => {
    const s = await sourceDatabase(dialect);
    const first = await convertToApp(saveSource(s, dialect), choices());
    // Somebody's own view is the person's choice; nothing is written for it until they make it.
    const asked = first.check.filter((item) => item.group === 'choice');
    expect(asked).toEqual([expect.objectContaining({ code: 'PERSONAL_VIEW', kind: 'view', answer: { choices: ['make-shared', 'leave-out'], target: s.personalViewId } })]);
    expect(JSON.stringify(pageOf(first.manifest, 'orders').views)).not.toContain('Mine');

    const saved = await convertToApp(saveSource(s, dialect), choices({ shareViews: [s.personalViewId] }));
    expect(saved.check.filter((item) => item.group === 'choice')).toEqual([]);
    const manifest = { ...saved.manifest, requiredSchema: REQUIRED_SCHEMA } as AppManifest;

    // The person's filter that named somebody of this install is left out, and said.
    expect(saved.check).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INSTANCE_VALUE_LEFT_OUT', kind: 'view' })]));
    // The long address is shortened, and the dashboard's link follows it.
    const long = manifest.pages.find((p) => p.title.fallback === 'Customers and orders')!;
    expect(long.ref.length).toBeLessThanOrEqual(31);
    expect(long.ref).not.toBe(LONG_SLUG);
    expect((long.envelope!.config['form'] as { sections: { fields: Doc[] }[] }).sections[0]!.fields[2]!['relation']).toBe('orders.customer_id');
    const overviewFile = pageOf(manifest, 'overview');
    const cards = (overviewFile.envelope!.config['layout'] as { items: { config: Doc }[] }).items;
    expect(cards[1]!.config['href']).toBe(`/p/${long.ref}?sort=name`);
    // A query names its table by ref, with no connection and no schema, on every engine.
    expect(cards.map((card) => card.config['binding'])).toEqual([
      { kind: 'table-query', source: { name: 'orders', type: 'table' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] },
      { kind: 'table-query', source: { name: 'customers', type: 'table' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] },
    ]);
    expect(overviewFile.envelope!.config['domain']).toEqual({ key: 'shop', label: 'Shop', tables: ['orders', 'customers'] });
    // A column carries only what a person chose.
    const ordersFile = pageOf(manifest, 'orders');
    expect((ordersFile.envelope!.config['columns'] as Doc[])[0]).toEqual({ name: 'total', label: 'Amount', width: '9rem' });
    expect(ordersFile.bindings).toEqual({ rows: 'orders' });
    expect(ordersFile.config).toBeUndefined();
    expect(JSON.stringify(manifest.pages)).not.toContain('generatedHash');
    expect(JSON.stringify(manifest.pages)).not.toContain('logicalType');

    const valid = validateManifest(manifest, { allowLocalPublisher: true });
    expect(valid.ok, JSON.stringify(valid.ok ? null : valid.issues)).toBe(true);

    // Installed on a fresh database of the same engine.
    const t = await harness(dialect);
    const reply = await t.install(manifest as unknown as Doc);
    expect(reply.statusCode, reply.body).toBe(200);
    const target = await modelOf(t);
    const ordersTable = target.tables.find((x) => x.name === 'orders')!;
    const customersTable = target.tables.find((x) => x.name === 'customers')!;

    const list = await pageAt(t, 'orders');
    expect(pageEnvelopeSchema.safeParse(list.config).success).toBe(true);
    const columns = body(list)['columns'] as Doc[];
    expect(columns.map((c) => c['name'])).toEqual(['total', 'customer_id', 'id', 'note', 'placed_at']);
    expect(columns[0]).toMatchObject({ label: 'Amount', width: '9rem' });
    expect(columns[2]).toMatchObject({ label: 'No.' });
    expect(columns[3]!['hidden']).toBe(true);
    expect(columns[0]!['logicalType']).toBe(ordersTable.columns.find((c) => c.name === 'total')!.logicalType);
    expect(body(list)['defaultSort']).toEqual([{ column: 'total', dir: 'desc' }]);
    expect(body(list)['pageSize']).toBe(25);
    expect(body(list)['filters']).toEqual([{ column: 'total', control: 'number-range', label: 'Amount' }]);

    const overview = await pageAt(t, 'overview');
    expect(pageEnvelopeSchema.safeParse(overview.config).success).toBe(true);
    expect((body(overview)['domain'] as { tables: string[] }).tables).toEqual([ordersTable.id, customersTable.id]);
    const items = (body(overview)['layout'] as { items: { i: string; config: { binding: Doc; href?: string } }[] }).items;
    expect(items.map((item) => item.i)).toEqual(['count', 'buyers']);
    // The schema is the target's own, and only on Postgres.
    const schemaOf = (table: typeof ordersTable) => (dialect === 'postgres' ? { schema: table.schema } : {});
    expect(items[0]!.config.binding).toMatchObject({ connectionId: t.connectionId, source: { name: 'orders', type: 'table', ...schemaOf(ordersTable) } });
    expect(items[1]!.config.binding['source']).toEqual({ name: 'customers', type: 'table', ...schemaOf(customersTable) });
    expect(items[1]!.config.href).toBe(`/p/${long.ref}?sort=name`);
    expect((body(overview)['layout'] as { toolbar: { link: { href: string } } }).toolbar.link.href).toBe(`/p/${long.ref}`);

    const longPage = await pageAt(t, long.ref);
    expect((body(longPage)['columns'] as Doc[]).map((c) => [c['name'], c['label'], c['width']])).toEqual([
      ['name', 'Customer', '14rem'],
      ['email', 'Mail', undefined],
    ]);
    expect((body(longPage)['detail'] as { tabs: Doc[] }).tabs).toEqual([{ table: ordersTable.id, fkColumn: 'customer_id', label: 'Orders' }]);
    const relation = target.relations.find((r) => r.from.tableId === ordersTable.id && r.to.tableId === customersTable.id)!.id;
    expect((body(longPage)['form'] as { sections: { fields: Doc[] }[] }).sections[0]!.fields[2]).toMatchObject({ relation, control: 'child-rows' });

    const views = await t.meta.db.selectFrom('adminium_views').selectAll().where('pageId', '=', list.id).orderBy('name').execute();
    expect(views.map((v) => [v.name, v.userId, v.kind, Boolean(v.isDefault)])).toEqual([
      ['Big', null, 'filters', true],
      ['Mine', null, 'filters', false],
    ]);
    expect(JSON.parse(String(views[0]!.config))).toEqual({ v: 1, sort: { column: 'total', dir: 'desc' }, filters: [{ column: 'total', op: 'gt', value: 100 }, { column: 'customer_id', op: 'eq', value: 1 }], pageSize: 25 });
    expect(await t.meta.db.selectFrom('adminium_views').select('id').where('pageId', '=', overview.id).execute()).toEqual([]);
  });

  it.skipIf(!available)('writes an untouched generated page in the short form', async () => {
    const s = await sourceDatabase(dialect);
    const { manifest } = await convertToApp(saveSource(s, dialect), choices({ shareViews: [s.personalViewId] }));
    const customers = pageOf(manifest, 'customers');
    expect(customers).toEqual({ ref: 'customers', template: 'page-crud', title: { key: 'nav.customers', fallback: 'Customers' }, nav: expect.objectContaining({ group: 'people' }) as unknown, bindings: { rows: 'customers' } });
    const calendar = pageOf(manifest, 'orders-calendar');
    expect(calendar.envelope).toBeUndefined();
    expect(calendar.bindings).toEqual({ rows: 'orders' });
    // A generated dashboard reads no one table, so the target cannot compose it again: it travels whole.
    const dashboard = pageOf(manifest, 'dashboard');
    expect(dashboard.bindings).toBeUndefined();
    expect((dashboard.envelope!.config['layout'] as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const t = await harness(dialect);
    const reply = await t.install({ ...manifest, requiredSchema: REQUIRED_SCHEMA } as unknown as Doc);
    expect(reply.statusCode, reply.body).toBe(200);
    const made = await pageAt(t, 'customers');
    expect(made.origin).toBe('manifest');
    expect(isUntouched(made.config)).toBe(true);
    expect((body(made)['columns'] as Doc[]).map((c) => c['name'])).toEqual(expect.arrayContaining(['name', 'email']));
    expect((await pageAt(t, 'dashboard')).type).toBe('page-dashboard');
  });

  it.skipIf(!available)('writes no connection, no page id and no id of the source install', async () => {
    const s = await sourceDatabase(dialect);
    const { manifest } = await convertToApp(saveSource(s, dialect), choices({ shareViews: [s.personalViewId] }));
    expect(findInstanceIds(manifest.pages)).toEqual([]);
    const text = JSON.stringify(manifest.pages);
    expect(text).not.toContain('connectionId');
    expect(text).not.toContain(s.h.connectionId);
    expect(text).not.toMatch(/page_[0-9a-f]{8}_/);
    expect(text).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);
    expect(text).not.toContain(s.ownerId);
    // A query's schema never travels: the install gives the target's.
    expect(text).not.toMatch(/"schema"/);
    // Nor does a table's real id.
    for (const table of s.model.tables) expect(text).not.toContain(`"${table.id}"`);
  });

  it.skipIf(!available)('asks about a page whose table does not travel, and leaves it out once answered', async () => {
    const s = await sourceDatabase(dialect);
    const customers = s.model.tables.find((t) => t.name === 'customers')!.id;
    const orders = s.model.tables.find((t) => t.name === 'orders')!.id;
    const narrowed = await convertToApp(saveSource(s, dialect), choices({ tables: [orders], shareViews: [s.personalViewId] }));
    const asked = narrowed.check.filter((item) => item.code === 'PAGE_TABLE_LEFT_OUT');
    expect(asked.map((item) => item.item).sort()).toEqual(['Customers', 'Customers and orders']);
    expect(narrowed.manifest.pages.map((p) => p.ref)).not.toContain('customers');
    // The overview's card on customers is left out and said; its card on orders stays.
    const overview = pageOf(narrowed.manifest, 'overview');
    expect((overview.envelope!.config['layout'] as { items: { i: string }[] }).items.map((item) => item.i)).toEqual(['count']);
    expect(narrowed.check).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'WIDGET_TABLE_LEFT_OUT', item: 'Overview' }), expect.objectContaining({ code: 'PAGE_LINK_LEFT_OUT' })]));
    for (const page of narrowed.manifest.pages) expect(JSON.stringify(page.bindings ?? {})).not.toContain('customers');

    const pageIds = (await pagesRepo(s.h.meta).listForConnection(s.h.connectionId)).filter((p) => (p.config as { source?: { table?: string } }).source?.table === customers).map((p) => `page:${p.id}`);
    const answered = await convertToApp(saveSource(s, dialect), choices({ tables: [orders], shareViews: [s.personalViewId], leaveOut: pageIds }));
    expect(answered.check.filter((item) => item.group === 'choice')).toEqual([]);
  });

  it.skipIf(!available)('shows no table left out of Adminium here, though the app carries it', async () => {
    const s = await sourceDatabase(dialect);
    const customers = s.model.tables.find((t) => t.name === 'customers')!.id;
    await overridesRepo(s.h.meta).create({ connectionId: s.h.connectionId, op: 'table.exclude', tableName: customers, columnName: null, value: { excluded: true }, origin: 'user' } as never);
    const saved = await convertToApp(saveSource(s, dialect), choices({ shareViews: [s.personalViewId] }));
    const asked = saved.check.filter((item) => item.code === 'PAGE_TABLE_LEFT_OUT');
    expect(asked.map((item) => item.item).sort()).toEqual(['Customers', 'Customers and orders']);
    expect(asked[0]!.message).toContain('left out of Adminium here');
    const overview = pageOf(saved.manifest, 'overview');
    expect((overview.envelope!.config['layout'] as { items: { i: string }[] }).items.map((item) => item.i)).toEqual(['count']);
    expect(overview.envelope!.config['domain']).toEqual({ key: 'shop', label: 'Shop', tables: ['orders'] });
  });
});
