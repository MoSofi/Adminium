// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PAGE SAVED FROM A DASHBOARD, INSTALLED; AND A PAGE ADDRESS ALREADY TAKEN.
 *
 * A self-made app's list page carries the body a person arranged — its
 * columns moved, hidden and renamed, its filters and its order — and its
 * dashboard's cards read two of its tables. Installed, each page is the
 * target's own: bound to the target's tables, every column's facts read from
 * the target, a valid page, stamped as untouched. An update replaces the page
 * nobody edited and keeps the one somebody did; the shared views land as
 * shared views and are written again by name, never a person's own. A table
 * the app does not declare, and a page saved by a newer Adminium, refuse.
 *
 * A page already at one of the app's addresses is the operator's choice:
 * replaced only when nobody edited it, renamed out of the way, or the app's
 * page left out — and an install nobody answered is refused.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { pageEnvelopeSchema } from '@adminium/engine/config';
import { pagesRepo, snapshotsRepo, viewsRepo, type Page } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { isUntouched, stamped } from '../src/pages/generated-stamp.js';
import { buildUserPageEnvelope } from '../src/routes/pages/envelope.js';
import { ENGINES, installHarness, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

/** The list page as the person arranged it: total first and renamed, a note hidden, a filter and an order of their own. */
function ordersEnvelope(label = 'Amount'): Doc {
  return {
    v: 1,
    kind: 'page',
    template: 'page-crud',
    config: {
      templateVersion: 1,
      columns: [
        // What the source said a column IS travels nowhere: these two facts are wrong on purpose.
        { name: 'total', label, logicalType: 'text', nullable: false, width: '9rem' },
        { name: 'customer_id', label: 'Buyer', fk: { table: 'customers', column: 'id' } },
        { name: 'id', label: 'No.' },
        { name: 'note', label: 'Note', hidden: true },
      ],
      defaultSort: [{ column: 'total', dir: 'desc' }],
      pageSize: 25,
      filters: [{ column: 'total', control: 'number-range', label: 'Amount' }],
      keyField: 'id',
      detail: { template: 'page-record', tabsFromInboundFks: false, tabs: [] },
    },
  };
}

/** The overview: one card counts orders, one lists customers, and its domain names both tables. */
function overviewEnvelope(title = 'Orders'): Doc {
  return {
    v: 1,
    kind: 'dashboard',
    template: 'page-dashboard',
    config: {
      templateVersion: 1,
      toolbar: [],
      overlays: [],
      domain: { key: 'shop', label: 'Shop', tables: ['orders', 'customers'] },
      layout: {
        version: 1,
        items: [
          { i: 'count', widget: 'kpi-stat-card', x: 0, y: 0, w: 3, h: 3, config: { title, binding: { kind: 'table-query', source: { name: 'orders', type: 'table' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] } } },
          // A schema a file should not carry: kept only where the target is Postgres, and then the target's own.
          { i: 'buyers', widget: 'kpi-stat-card', x: 3, y: 0, w: 3, h: 3, config: { title: 'Buyers', binding: { kind: 'table-query', source: { name: 'customers', schema: 'elsewhere', type: 'table' }, shape: 'single-metric', aggregations: [{ fn: 'count', alias: 'value' }] } } },
        ],
      },
    },
  };
}

const VIEWS = [
  { v: 1, kind: 'filters', name: 'Big', isDefault: true, config: { v: 1, sort: { column: 'total', dir: 'desc' }, filters: [{ column: 'total', op: 'gt', value: 100 }], pageSize: 25 } },
  { v: 1, kind: 'filters', name: 'Small', config: { v: 1, filters: [{ column: 'total', op: 'lt', value: 10 }] } },
];

function shop(version = '1.0.0', pages?: Doc[]): Doc {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'shop',
    name: 'Shop',
    version,
    publisher: { id: 'local', name: 'Made here' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A shop.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: '0.3.49' },
    requiredSchema: {
      tables: [
        { ref: 'customers', columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'name', type: 'text', maxLength: 80 }] },
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'total', type: 'decimal', scale: 2, precision: 10, nullable: true },
            { ref: 'note', type: 'text', nullable: true },
          ],
        },
      ],
    },
    pages: pages ?? [
      { ref: 'orders', template: 'page-crud', title: { key: 't.orders', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' }, envelope: ordersEnvelope(), views: VIEWS },
      { ref: 'overview', template: 'page-dashboard', title: { key: 't.overview', fallback: 'Overview' }, nav: { group: 'manage', icon: 'layout-dashboard', order: 0 }, envelope: overviewEnvelope() },
    ],
    frontends: [{ side: 'staff', kind: 'spa' }],
  };
}

/** A page of the app without an envelope, for the address tests. */
const plainOrders = { ref: 'orders', template: 'page-crud', title: { key: 't.orders', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } };

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

async function model(h: Harness): Promise<DatabaseModel> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return parseDatabaseModel(snapshot!.schema);
}

async function page(h: Harness, slug: string): Promise<Page> {
  const found = await pagesRepo(h.meta).findBySlug(h.connectionId, slug);
  expect(found, `no page at /p/${slug}`).not.toBeNull();
  return found!;
}

const body = (p: Page) => (p.config as { config: Doc }).config;

describe.each(ENGINES)('a page saved from a dashboard, installed on %s', (dialect, available) => {
  it.skipIf(!available)('is bound to the target, its column facts the target\'s, valid and untouched, with its shared views', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    const reply = await h.install(shop());
    expect(reply.statusCode, reply.body).toBe(200);
    const target = await model(h);
    const orders = target.tables.find((t) => t.name === 'orders')!;
    const customers = target.tables.find((t) => t.name === 'customers')!;

    const list = await page(h, 'orders');
    expect(list.origin).toBe('manifest');
    expect(pageEnvelopeSchema.safeParse(list.config).success).toBe(true);
    expect(isUntouched(list.config)).toBe(true);
    const doc = list.config as Doc;
    expect(doc['source']).toEqual({ connectionId: h.connectionId, table: orders.id });
    expect((doc['access'] as { permissions: string[] }).permissions).toEqual([`table:${orders.id}:read`]);
    expect((doc['nav'] as { slug: string }).slug).toBe('orders');
    expect(doc['id']).toBe(list.id);
    const columns = body(list)['columns'] as Doc[];
    // The person's order, labels, width and hidden column.
    expect(columns.map((c) => c['name'])).toEqual(['total', 'customer_id', 'id', 'note']);
    expect(columns.map((c) => c['label'])).toEqual(['Amount', 'Buyer', 'No.', 'Note']);
    expect(columns[0]!['width']).toBe('9rem');
    expect(columns[3]!['hidden']).toBe(true);
    // What each column IS comes from the target, not the file.
    const total = orders.columns.find((c) => c.name === 'total')!;
    expect(columns[0]!['logicalType']).toBe(total.logicalType);
    expect(columns[0]!['logicalType']).not.toBe('text');
    expect(columns[0]!['nullable']).not.toBe(false);
    expect((columns[1]!['fk'] as { table: string }).table).toBe(customers.id);
    expect(body(list)['defaultSort']).toEqual([{ column: 'total', dir: 'desc' }]);
    expect(body(list)['pageSize']).toBe(25);
    expect(body(list)['filters']).toEqual([{ column: 'total', control: 'number-range', label: 'Amount' }]);

    const overview = await page(h, 'overview');
    expect(pageEnvelopeSchema.safeParse(overview.config).success).toBe(true);
    expect(isUntouched(overview.config)).toBe(true);
    expect((body(overview)['domain'] as { tables: string[] }).tables).toEqual([orders.id, customers.id]);
    const items = (body(overview)['layout'] as { items: { config: { binding: Doc } }[] }).items;
    for (const item of items) expect(item.config.binding['connectionId']).toBe(h.connectionId);
    const schemaOf = (table: typeof orders) => (dialect === 'postgres' ? { schema: table.schema } : {});
    expect(items[0]!.config.binding['source']).toEqual({ name: 'orders', type: 'table', ...schemaOf(orders) });
    expect(items[1]!.config.binding['source']).toEqual({ name: 'customers', type: 'table', ...schemaOf(customers) });

    const views = await h.meta.db.selectFrom('adminium_views').selectAll().where('pageId', '=', list.id).orderBy('name').execute();
    expect(views.map((v) => [v.name, v.userId, v.kind, Boolean(v.isDefault)])).toEqual([
      ['Big', null, 'filters', true],
      ['Small', null, 'filters', false],
    ]);
  });

  it.skipIf(!available)('is replaced by an update while untouched and kept once edited, its views written again by name', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    expect((await h.install(shop())).statusCode).toBe(200);
    const overview = await page(h, 'overview');
    // Somebody moves a card: the overview is theirs now.
    const layout = body(overview)['layout'] as { version: 1; items: Doc[] };
    await pagesRepo(h.meta).setLayout(overview.id, { ...layout, items: [...layout.items].reverse() });
    // And somebody keeps a view of their own named as the app's.
    const list = await page(h, 'orders');
    const owner = (await h.meta.db.selectFrom('adminium_users').select('id').executeTakeFirstOrThrow()).id;
    await viewsRepo(h.meta).create({ pageId: list.id, userId: owner, name: 'Big', config: { v: 1, pageSize: 10 } });

    const next = shop('1.1.0', [
      { ...plainOrders, envelope: ordersEnvelope('Order total'), views: [{ ...VIEWS[0]!, isDefault: false, config: { v: 1, filters: [{ column: 'total', op: 'gt', value: 500 }] } }, { v: 1, kind: 'filters', name: 'Open', isDefault: true, config: { v: 1, filters: [] } }] },
      { ref: 'overview', template: 'page-dashboard', title: { key: 't.overview', fallback: 'Overview' }, nav: { group: 'manage', icon: 'layout-dashboard', order: 0 }, envelope: overviewEnvelope('All orders') },
    ]);
    await h.stage(next);
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);

    const after = await page(h, 'orders');
    expect(after.id).toBe(list.id);
    expect(((body(after)['columns'] as Doc[])[0]!)['label']).toBe('Order total');
    expect(isUntouched(after.config)).toBe(true);
    const kept = await page(h, 'overview');
    expect(((body(kept)['layout'] as { items: { i: string; config: Doc }[] }).items.map((item) => item.i))).toEqual(['buyers', 'count']);
    expect(JSON.stringify(body(kept))).not.toContain('All orders');

    const views = await h.meta.db.selectFrom('adminium_views').selectAll().where('pageId', '=', list.id).orderBy('name').orderBy('userId').execute();
    const shared = views.filter((v) => v.userId === null);
    expect(shared.map((v) => [v.name, Boolean(v.isDefault)])).toEqual([['Big', false], ['Open', true], ['Small', false]]);
    expect(JSON.parse(String(shared[0]!.config))).toEqual({ v: 1, filters: [{ column: 'total', op: 'gt', value: 500 }] });
    const mine = views.find((v) => v.userId === owner)!;
    expect(JSON.parse(String(mine.config))).toEqual({ v: 1, pageSize: 10 });
  });

  it.skipIf(!available)('refuses a table the app does not declare, and a page a newer Adminium saved, before anything is made', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    const refused = async (pages: Doc[], words: string) => {
      const m = shop('1.0.0', pages);
      await h.stage(m);
      const plan = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
      expect(plan.statusCode, plan.body).toBe(200);
      const problems = (JSON.parse(plan.body) as { plan: { installable: boolean; problems: { code: string; message: string }[] } }).plan;
      expect(problems.installable).toBe(false);
      expect(problems.problems.find((p) => p.code === 'PAGE_ENVELOPE_INVALID')?.message).toContain(words);
      const install = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
      expect(install.statusCode, install.body).toBe(422);
      expect(JSON.parse(install.body)).toMatchObject({ error: { details: { reason: 'PLAN_REFUSED' } } });
      expect((await model(h)).tables.map((t) => t.name)).not.toContain('orders');
    };
    const ghost = overviewEnvelope();
    ((ghost['config'] as { layout: { items: { config: { binding: { source: Doc } } }[] } }).layout.items[0]!.config.binding.source)['name'] = 'ghosts';
    await refused([{ ref: 'overview', template: 'page-dashboard', title: { key: 't', fallback: 'Overview' }, nav: { group: 'manage', icon: 'x', order: 0 }, envelope: ghost }], 'names "ghosts", which is not a table of this app');
    await refused([{ ...plainOrders, envelope: { ...ordersEnvelope(), v: 2 } }], 'newer than the latest supported version');
  });
});

describe.each(ENGINES)('a page address already taken, on %s', (dialect, available) => {
  /** A page of the operator's at `/p/orders`, edited (never stamped) or as generated (stamped). */
  const operatorsPage = async (h: Harness, untouched: boolean): Promise<string> => {
    const frame = buildUserPageEnvelope({ id: 'page_mine', slug: 'orders', title: 'My orders', template: 'page-crud', navGroup: 'library', navOrder: 3, connectionId: h.connectionId });
    const made = await pagesRepo(h.meta).create({ id: 'page_mine', connectionId: h.connectionId, slug: 'orders', type: 'page-crud', title: 'My orders', config: untouched ? stamped(frame) : frame, origin: untouched ? 'generated' : 'user' });
    return made.id;
  };
  const plan = async (h: Harness, pages?: Doc) => {
    const reply = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId, ...(pages === undefined ? {} : { pages }) } });
    expect(reply.statusCode, reply.body).toBe(200);
    return (JSON.parse(reply.body) as { plan: { installable: boolean; problems: { code: string; table: string }[]; pageClashes?: Doc[] } }).plan;
  };
  const app = () => shop('1.0.0', [plainOrders]);

  it.skipIf(!available)('is offered on the check, and an install nobody answered is refused', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await operatorsPage(h, false);
    await h.stage(app());
    const checked = await plan(h);
    expect(checked.installable).toBe(false);
    expect(checked.pageClashes).toEqual([{ page: 'orders', title: 'My orders', holder: 'yours', untouched: false, offers: ['rename-existing', 'skip'], action: 'undecided' }]);
    expect(checked.problems.map((p) => p.code)).toContain('PAGE_SLUG_UNANSWERED');
    const install = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(install.statusCode, install.body).toBe(422);
    expect(install.body).toContain('PAGE_SLUG_UNANSWERED');
    expect((await page(h, 'orders')).id).toBe('page_mine');
  });

  it.skipIf(!available)('replaces a page nobody edited, and refuses to replace one somebody did', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await operatorsPage(h, false);
    await h.stage(app());
    const edited = await plan(h, { orders: { action: 'replace' } });
    expect(edited.problems.map((p) => p.code)).toContain('PAGE_SLUG_ANSWER_INVALID');
    const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId, pages: { orders: { action: 'replace' } } } });
    expect(refused.statusCode, refused.body).toBe(422);
    expect((await page(h, 'orders')).id).toBe('page_mine');
    await pagesRepo(h.meta).delete('page_mine');

    await operatorsPage(h, true);
    const offered = await plan(h);
    expect(offered.pageClashes).toEqual([{ page: 'orders', title: 'My orders', holder: 'generated', untouched: true, offers: ['replace', 'rename-existing', 'skip'], action: 'undecided' }]);
    expect((await plan(h, { orders: { action: 'replace' } })).pageClashes?.[0]).toMatchObject({ action: 'replace' });
    const replaced = await h.install(app(), { pages: { orders: { action: 'replace' } } });
    expect(replaced.statusCode, replaced.body).toBe(200);
    const now = await page(h, 'orders');
    expect(now.id).not.toBe('page_mine');
    expect(now.origin).toBe('manifest');
    expect(await pagesRepo(h.meta).findById('page_mine')).toBeNull();
  });

  it.skipIf(!available)('renames the page there to a free address the operator gives, and refuses a taken one', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await operatorsPage(h, false);
    await pagesRepo(h.meta).create({ connectionId: h.connectionId, slug: 'taken', type: 'page-crud', title: 'Taken', config: {}, origin: 'user' });
    await h.stage(app());
    for (const to of ['taken', 'Not A Slug', 'orders']) {
      expect((await plan(h, { orders: { action: 'rename-existing', to } })).problems.map((p) => p.code), to).toContain('PAGE_SLUG_ANSWER_INVALID');
    }
    expect((await plan(h, { orders: { action: 'rename-existing', to: 'my-orders' } })).pageClashes?.[0]).toMatchObject({ action: 'rename-existing', renameTo: 'my-orders' });
    const reply = await h.install(app(), { pages: { orders: { action: 'rename-existing', to: 'my-orders' } } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().pages.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ page: 'orders', reason: 'PAGE_MOVED' })]));
    const moved = await page(h, 'my-orders');
    expect(moved.id).toBe('page_mine');
    expect((moved.config as { nav: { slug: string } }).nav.slug).toBe('my-orders');
    expect((await page(h, 'orders')).origin).toBe('manifest');
  });

  it.skipIf(!available)('is answered on an update too: refused without an answer, the page left out with one', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    expect((await h.install(shop('1.0.0', [plainOrders]))).statusCode).toBe(200);
    await pagesRepo(h.meta).create({ id: 'page_report', connectionId: h.connectionId, slug: 'report', type: 'page-dashboard', title: 'My report', config: buildUserPageEnvelope({ id: 'page_report', slug: 'report', title: 'My report', template: 'page-dashboard', navGroup: 'workspace', navOrder: 1, connectionId: h.connectionId }), origin: 'user' });
    await h.stage(shop('1.1.0', [plainOrders, { ref: 'report', template: 'page-dashboard', title: { key: 't.report', fallback: 'Report' }, nav: { group: 'manage', icon: 'x', order: 2 } }]));
    const refused = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.body).toContain('PAGE_SLUG_UNANSWERED');
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: { pages: { report: { action: 'skip' } } } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect((await page(h, 'report')).id).toBe('page_report');
  });

  it.skipIf(!available)('leaves the app\'s page out when the operator skips it', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await operatorsPage(h, false);
    const reply = await h.install(app(), { pages: { orders: { action: 'skip' } } });
    expect(reply.statusCode, reply.body).toBe(200);
    expect(reply.json().pages.warnings).toEqual([expect.objectContaining({ page: 'orders', reason: 'PAGE_SKIPPED' })]);
    expect((await page(h, 'orders')).id).toBe('page_mine');
    expect((await pagesRepo(h.meta).listAll()).filter((p) => p.origin === 'manifest')).toEqual([]);
  });
});
