// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SELF-MADE APP'S TABLES UNDER THE NAMES A PERSON GAVE THEM.
 *
 * Saved from a hand-built dashboard, a table keeps its real name beside its
 * ref (`Our "Customers"`, `Order Lines`), and on Postgres the schema it is in
 * (`sales`). The install makes each table under that name, in that schema,
 * links across schemas both ways, and records both; rows are written and read
 * through the snapshot's own id for the table; an update and a reinstall find
 * the tables again and make nothing (the link that closes a cycle is looked
 * for in its table's own schema, and never made twice); an uninstall that drops tables drops
 * these and nothing else. Off Postgres a schema is a plan problem, never a
 * failed create.
 *
 * SQLite always runs; Postgres runs with TEST_POSTGRES_URL, MySQL with
 * TEST_MYSQL_URL (`./app-install-harness.ts`).
 */
import { appTablesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const CUSTOMERS = 'Our "Customers"';
const ORDERS = 'Order Lines';
const REFUNDS = 'Refunds';

/** Customers under a name with a quote and a space; their orders (in `sales` where a schema is given); refunds linking back. */
function shop(version: string, schema?: string): Doc {
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
        {
          ref: 'customers',
          name: CUSTOMERS,
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            // A cycle with orders: one of the two links is added once both tables are there, and looked for in its own schema after.
            { ref: 'last_order_id', type: 'fk', references: 'orders', nullable: true },
          ],
        },
        {
          ref: 'orders',
          name: ORDERS,
          ...(schema === undefined ? {} : { schema }),
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers' },
            { ref: 'code', type: 'text', maxLength: 12, unique: true, nullable: true },
            { ref: 'status', type: 'enum', enum: ['open', "it's done"], nullable: true },
          ],
        },
        { ref: 'refunds', name: REFUNDS, columns: [{ ref: 'id', type: 'int', role: 'pk' }, { ref: 'order_id', type: 'fk', references: 'orders' }] },
      ],
    },
    pages: [{ ref: 'customers', template: 'page-crud', title: { key: 't', fallback: 'Customers' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** Every table on the database, as `<schema>.<name>` (Postgres) or the bare name. */
async function tablesOn(h: Harness, dialect: Dialect): Promise<string[]> {
  if (dialect === 'sqlite') return (await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((row) => String(row['name']));
  if (dialect === 'mysql') return (await h.rows('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')).map((row) => String(row['name']));
  return (await h.rows(`SELECT table_schema AS s, table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`)).map(
    (row) => `${String(row['s'])}.${String(row['name'])}`,
  );
}

/** The app's table records, ref → [schema, name, state]. */
async function records(h: Harness): Promise<Record<string, [string | null, string, string]>> {
  const rows = await appTablesRepo(h.meta).forInstall(h.connectionId, 'shop');
  return Object.fromEntries(rows.map((row) => [row.ref, [row.schemaName, row.tableName, row.state]]));
}

/** Writes a customer, an order and a refund through the snapshot's id of each table, and reads them back. */
async function writeAndRead(h: Harness, names: Record<string, string>): Promise<void> {
  const view = await loadSnapshotView(h.meta, h.connectionId);
  const { db } = await h.manager.data(h.connectionId);
  const id = (ref: string) => view.table(names[ref]!).id;
  const any = db as unknown as {
    insertInto: (t: string) => { values: (v: Doc) => { execute: () => Promise<unknown> } };
    selectFrom: (t: string) => { selectAll: () => { execute: () => Promise<Doc[]> } };
  };
  await any.insertInto(id('customers')).values({ id: 1, name: 'Ada' }).execute();
  await any.insertInto(id('orders')).values({ id: 7, customer_id: 1, code: 'A-1', status: "it's done" }).execute();
  await any.insertInto(id('refunds')).values({ id: 3, order_id: 7 }).execute();
  expect((await any.selectFrom(id('customers')).selectAll().execute()).map((row) => row['name'])).toEqual(['Ada']);
  expect((await any.selectFrom(id('orders')).selectAll().execute()).map((row) => [Number(row['customer_id']), row['status']])).toEqual([[1, "it's done"]]);
  // The CHECK keeps the enum, and the unique keeps the code.
  await expect(any.insertInto(id('orders')).values({ id: 8, customer_id: 1, status: 'gone' }).execute()).rejects.toThrow();
  await expect(any.insertInto(id('orders')).values({ id: 9, customer_id: 1, code: 'A-1' }).execute()).rejects.toThrow();
}

describe.each(ENGINES)('a self-made app\'s tables under their own names, on %s', (dialect, available) => {
  it.skipIf(!available)('are made, written, found again by an update and a reinstall, and dropped alone', async () => {
    harness = await installHarness(dialect, { superAdmin: true });
    const h = harness;
    // A table of the operator's own, which an uninstall that drops tables never touches.
    await h.run('CREATE TABLE bystander (id INTEGER PRIMARY KEY)');
    const schema = dialect === 'postgres' ? 'sales' : undefined;
    const ordersReal = schema === undefined ? ORDERS : `${schema}.${ORDERS}`;
    const names = { customers: CUSTOMERS, orders: ordersReal, refunds: REFUNDS };
    const here = (name: string) => (dialect === 'postgres' && !name.includes('.') ? `public.${name}` : name);

    const installed = await h.install(shop('1.0.0', schema));
    expect(installed.statusCode, installed.body).toBe(200);
    const made = await tablesOn(h, dialect);
    for (const name of [CUSTOMERS, ordersReal, REFUNDS]) expect(made).toContain(here(name));
    expect(await records(h)).toEqual({
      customers: [null, CUSTOMERS, 'created'],
      orders: [schema ?? null, ORDERS, 'created'],
      refunds: [null, REFUNDS, 'created'],
    });
    expect(await appTablesRepo(h.meta).realNames(h.connectionId, 'shop')).toEqual(names);
    await writeAndRead(h, names);
    if (dialect !== 'sqlite') {
      // The links hold, from `sales` into `public` and back.
      const view = await loadSnapshotView(h.meta, h.connectionId);
      const { db } = await h.manager.data(h.connectionId);
      const insert = db as unknown as { insertInto: (t: string) => { values: (v: Doc) => { execute: () => Promise<unknown> } } };
      await expect(insert.insertInto(view.table(ordersReal).id).values({ id: 10, customer_id: 99 }).execute()).rejects.toThrow();
      await expect(insert.insertInto(view.table(REFUNDS).id).values({ id: 11, order_id: 99 }).execute()).rejects.toThrow();
    }

    // An update finds every table again and makes none.
    await h.stage(shop('1.1.0', schema));
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.1.0', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    expect(planned.json()).toMatchObject({ plan: { installable: true, create: [] } });
    const updated = await h.inject({ method: 'POST', url: '/apps/shop/update', payload: {} });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(await tablesOn(h, dialect)).toEqual(made);

    // Uninstalled with the tables kept, and installed again: the same tables, rows and all.
    const kept = await h.inject({ method: 'DELETE', url: '/apps/shop', payload: { dropTables: false } });
    expect(kept.statusCode, kept.body).toBe(200);
    const again = await h.install(shop('1.1.0', schema));
    expect(again.statusCode, again.body).toBe(200);
    expect(await tablesOn(h, dialect)).toEqual(made);
    expect(Object.values(await records(h)).map((record) => record[2])).toEqual(['created', 'created', 'created']);
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const { db } = await h.manager.data(h.connectionId);
    const read = db as unknown as { selectFrom: (t: string) => { selectAll: () => { execute: () => Promise<Doc[]> } } };
    expect((await read.selectFrom(view.table(ordersReal).id).selectAll().execute()).length).toBe(1);

    // Dropped with its tables: these three go, the operator's table stays.
    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop', payload: { dropTables: true, confirmKey: 'shop' } });
    expect(gone.statusCode, gone.body).toBe(200);
    const left = await tablesOn(h, dialect);
    for (const name of [CUSTOMERS, ordersReal, REFUNDS]) expect(left).not.toContain(here(name));
    expect(left).toContain(here('bystander'));
    expect(Object.values(await records(h)).map((record) => record[2])).toEqual(['dropped', 'dropped', 'dropped']);
  });

  it.skipIf(!available || dialect === 'postgres')('refuse a schema at the plan, before anything is made', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await h.stage(shop('1.0.0', 'sales'));
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(planned.statusCode, planned.body).toBe(200);
    const plan = (planned.json() as unknown as { plan: { installable: boolean; problems: { code: string; table: string; message: string }[] } }).plan;
    expect(plan.installable).toBe(false);
    expect(plan.problems).toEqual([expect.objectContaining({ code: 'TABLE_NAME_REFUSED', table: 'orders' })]);
    expect(plan.problems[0]!.message).toContain('only Postgres keeps tables in schemas');
    const refused = await h.inject({ method: 'POST', url: '/apps/install', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    expect(refused.statusCode).not.toBe(200);
    expect(await tablesOn(h, dialect)).toEqual([]);
  });

  it.skipIf(!available || dialect === 'postgres')('refuse a name a table already there is taken for, where case is ignored', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    await h.run('CREATE TABLE refunds (id INTEGER PRIMARY KEY)');
    await h.stage(shop('1.0.0'));
    const planned = await h.inject({ method: 'POST', url: '/apps/plan', payload: { key: 'shop', version: '1.0.0', connectionId: h.connectionId } });
    const plan = (planned.json() as unknown as { plan: { problems: { code: string; table: string }[] } }).plan;
    expect(plan.problems).toContainEqual(expect.objectContaining({ code: 'TABLE_NAME_REFUSED', table: 'refunds' }));
  });

  it.skipIf(!available)('refuse the database\'s own schemas and Adminium\'s when the file is read', async () => {
    harness = await installHarness(dialect);
    const h = harness;
    for (const [schema, words] of [['pg_catalog', "the database's own schema"], ['information_schema', "the database's own schema"], ['pg_temp_1', "the database's own schema"], ['adminium_demo', "Adminium's own namespace"]] as const) {
      await expect(h.stage(shop('1.0.0', schema)), schema).rejects.toThrow(words);
    }
  });
});
