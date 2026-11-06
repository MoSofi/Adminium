// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A SELF-MADE APP'S TABLE IN A SCHEMA OF ITS OWN, BESIDE A TWIN OF THE SAME
 * NAME.
 *
 * On Postgres a self-made app keeps `orders`, `jobs` and `extras` in the
 * schema `sales`, while the owner's own `public.orders`, `public.jobs` and
 * `public.extras` stand beside them. Everything the install, the app's page,
 * its roles, rules, public entry and sample rows do is done to the `sales`
 * table and never to its twin; a column the app no longer fills is made
 * optional, and dropped, on `sales.orders` alone; an empty table the app
 * gives up is dropped in `sales`; the uninstall drops `sales` and leaves the
 * owner's tables and their rows. A table read only in part has no row count
 * on the app's pages. A record with no schema means the DEFAULT schema, never
 * "any schema": that is the reading every lookup shares.
 *
 * The same flow runs bare on SQLite and MySQL (no schema, no twin): nothing a
 * default-schema table does changes. And on every engine, a private table an
 * uninstall leaves behind keeps its private mark (its rules were compared by
 * a bare name against the snapshot's id, and never matched).
 *
 * SQLite always; Postgres with TEST_POSTGRES_URL, MySQL with TEST_MYSQL_URL.
 */
import { validateManifest, type Manifest } from '@adminium/manifest';
import { appTablesRepo, manifestsRepo, overridesRepo, pagesRepo, permissionsRepo, publicEndpointsRepo, rolesRepo } from '@adminium/meta';
import { afterEach, describe, expect, it } from 'vitest';

import { roleSlugFor } from '../src/apps/manifest-roles.js';
import { createRemovals } from '../src/apps/removal.js';
import { findSampleApp, sampleKeysOf } from '../src/apps/sample-data.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

const SCHEMA = 'sales';
const id = { ref: 'id', type: 'int', role: 'pk' };
const identity = { encrypt: (v: string) => v, decrypt: (v: string) => v };
const SAMPLE = { 'seeds/shop.sample.json': JSON.stringify({ format: 'adminium.sample/1', app: 'shop', tables: [{ ref: 'orders', rows: [{ code: 'S-1', note: 'one' }, { code: 'S-2', note: 'two' }] }] }) };

/** Orders (with a note that must be filled) and private jobs, both of a part; an empty table of extras: in `schema` where given. */
function shop(version: string, schema: string | undefined, opts: { note?: boolean; extras?: boolean } = {}): Doc {
  const where = schema === undefined ? {} : { schema };
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
    modules: [{ id: 'desk', label: { 'en-US': 'Desk' }, default: 'always' }],
    requiredSchema: {
      tables: [
        {
          ref: 'orders',
          ...where,
          module: 'desk',
          label: { 'en-US': 'Order' },
          columns: [
            id,
            { ref: 'code', type: 'text', maxLength: 12, nullable: true },
            { ref: 'state', type: 'enum', enum: ['open', 'done'], default: 'open' },
            ...(opts.note === false ? [] : [{ ref: 'note', type: 'text', maxLength: 80 }]),
          ],
          states: { column: 'state', initial: 'open', moves: { open: ['done'], done: [] } },
        },
        {
          ref: 'jobs',
          ...where,
          module: 'desk',
          private: true,
          belongs: [{ column: 'owner_id' }],
          indexes: [['owner_id']],
          columns: [id, { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } }, { ref: 'state', type: 'enum', enum: ['open', 'done'], default: 'open' }],
          states: { column: 'state', initial: 'open', moves: { open: ['done'], done: [] } },
        },
        ...(opts.extras === false ? [] : [{ ref: 'extras', ...where, columns: [id] }]),
      ],
    },
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@orders:read', 'table:@orders:create'] }],
    pages: [{ ref: 'orders', template: 'page-crud', title: { key: 't', fallback: 'Orders' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: 'orders' } }],
    publicAccess: [{ table: 'orders', methods: ['GET'], select: ['id', 'code'] }],
    sampleData: { file: 'seeds/shop.sample.json' },
    frontends: [{ side: 'staff', kind: 'none' }],
  };
}

const parsed = (doc: Doc): Manifest => {
  const read = validateManifest(doc, { allowLocalPublisher: true });
  if (!read.ok) throw new Error(JSON.stringify(read));
  return read.manifest;
};

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.close();
  harness = null;
});

/** Every table on the database, as `<schema>.<name>` on Postgres, the bare name elsewhere. */
async function tablesOn(h: Harness, dialect: Dialect): Promise<string[]> {
  if (dialect === 'sqlite') return (await h.rows(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((row) => String(row['name']));
  if (dialect === 'mysql') return (await h.rows('SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()')).map((row) => String(row['name']));
  return (await h.rows(`SELECT table_schema AS s, table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`)).map(
    (row) => `${String(row['s'])}.${String(row['name'])}`,
  );
}

/** Whether `<schema>.<table>.<column>` may be empty, or that it is not there (null). */
async function nullable(h: Harness, dialect: Dialect, table: string, column: string, schema = 'public'): Promise<boolean | null> {
  if (dialect === 'sqlite') {
    const found = (await h.rows(`PRAGMA table_info("${table}")`)).find((row) => row['name'] === column);
    return found === undefined ? null : Number(found['notnull']) === 0;
  }
  const where = dialect === 'mysql' ? 'table_schema = DATABASE()' : `table_schema = '${schema}'`;
  const found = await h.rows(`SELECT is_nullable AS n FROM information_schema.columns WHERE ${where} AND table_name = '${table}' AND column_name = '${column}'`);
  return found.length === 0 ? null : String(found[0]!['n']) === 'YES';
}

describe.each(ENGINES)('a self-made app\'s tables in a schema of their own, beside same-named twins, on %s', (dialect, available) => {
  it.skipIf(!available)('are the only tables its pages, roles, rules, public entry, samples, counts and removals touch', async () => {
    harness = await installHarness(dialect, { superAdmin: true, full: true });
    const h = harness;
    const pg = dialect === 'postgres';
    const schema = pg ? SCHEMA : undefined;
    const real = (name: string) => (schema === undefined ? name : `${schema}.${name}`);
    if (pg) {
      // The owner's own tables, of the same names, in the default schema: one with a row of theirs.
      await h.run('CREATE TABLE orders (id INTEGER PRIMARY KEY, code TEXT, note TEXT NOT NULL)');
      await h.run("INSERT INTO orders (id, code, note) VALUES (1, 'MINE', 'mine')");
      await h.run('CREATE TABLE jobs (id INTEGER PRIMARY KEY)');
      await h.run('CREATE TABLE extras (id INTEGER PRIMARY KEY)');
    }

    const installed = await h.install(shop('1.0.0', schema), {}, SAMPLE);
    expect(installed.statusCode, installed.body).toBe(200);
    const records = await appTablesRepo(h.meta).forInstall(h.connectionId, 'shop');
    expect(Object.fromEntries(records.filter((record) => record.role === 'app').map((record) => [record.ref, [record.schemaName, record.tableName]]))).toEqual({
      orders: [schema ?? null, 'orders'],
      jobs: [schema ?? null, 'jobs'],
      extras: [schema ?? null, 'extras'],
    });
    const view = await loadSnapshotView(h.meta, h.connectionId);
    const ordersId = view.table(real('orders')).id;
    const jobsId = view.table(real('jobs')).id;
    if (pg) {
      expect([ordersId, jobsId]).toEqual(['sales.orders', 'sales.jobs']);
      expect(view.table('orders').id).toBe('public.orders');
    }
    const row = (await manifestsRepo(h.meta, identity).findInScope('shop', h.connectionId))!;

    // The page reads the app's table.
    const page = (await pagesRepo(h.meta).listByManifest(row.row.id)).find((one) => one.slug === 'orders');
    expect((page?.config as { source?: { table?: unknown } } | undefined)?.source?.table).toBe(ordersId);

    // The role is given the app's table, and nothing of the twin.
    const clerk = (await rolesRepo(h.meta).findBySlug(roleSlugFor('shop', 'clerk')))!;
    const grant = await permissionsRepo(h.meta).find(clerk.id, 'table', `${h.connectionId}/${ordersId}`);
    expect(grant?.actions).toMatchObject({ read: true, create: true });
    if (pg) expect(await permissionsRepo(h.meta).find(clerk.id, 'table', `${h.connectionId}/public.orders`)).toBeNull();

    // The rules are on the app's tables.
    const rules = await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' });
    expect(rules.find((rule) => rule.op === 'table.label')?.tableName).toBe(ordersId);
    expect(rules.find((rule) => rule.op === 'table.private')?.tableName).toBe(jobsId);
    if (pg) expect(rules.filter((rule) => rule.tableName.startsWith('public.'))).toEqual([]);

    // The public entry serves the app's table, under a ref an address can carry.
    const endpoints = (await publicEndpointsRepo(h.meta).listByConnection(h.connectionId)).filter((endpoint) => endpoint.managedBy === 'shop');
    expect(endpoints.map((endpoint) => [endpoint.ref, (JSON.parse(endpoint.definition) as { source: string }).source])).toEqual([[pg ? 'sales_orders' : 'orders', ordersId]]);

    // Its sample rows are the app's table's, and never the twin's that happen to share a key.
    await h.samples!.add((await findSampleApp(h.meta, 'shop'))!, { locale: 'en-US', userId: null, userLabel: 'test' });
    const { db } = await h.manager.data(h.connectionId);
    const fresh = await loadSnapshotView(h.meta, h.connectionId);
    expect((await sampleKeysOf(h.meta, db, h.connectionId, fresh.table(ordersId))).size).toBe(2);
    if (pg) expect((await sampleKeysOf(h.meta, db, h.connectionId, fresh.table('public.orders'))).size).toBe(0);

    // What is open in the part is counted in the app's own table; a private table is read only in part, and how many rows it holds is said on no page.
    await h.run(`INSERT INTO ${pg ? 'sales.jobs' : 'jobs'} (id, state) VALUES (1, 'open')`);
    const open = await h.inject({ method: 'GET', url: '/apps/shop/parts/desk/open' });
    expect(open.statusCode, open.body).toBe(200);
    expect((open.json() as unknown as { open: unknown[] }).open).toEqual([expect.objectContaining({ table: 'orders', rows: 2 })]);
    const overview = await h.inject({ method: 'GET', url: '/apps/shop/overview' });
    expect(overview.statusCode, overview.body).toBe(200);
    const counted = (overview.json() as unknown as { tables: { ref: string; table: string; rows: number | null }[] }).tables;
    expect(counted.find((table) => table.ref === 'jobs')).toMatchObject({ table: real('jobs'), rows: null });
    expect(counted.find((table) => table.ref === 'orders')).toMatchObject({ table: real('orders'), rows: 2 });

    /*
     * The app gives up its note and its extras (as a project folder's apply
     * asks): the empty table goes, in its own schema; the note, which holds
     * values, is asked about and made optional meanwhile — on the app's table.
     */
    const removals = createRemovals({ meta: h.meta, credentialCrypto: identity, schemaTarget: h.deps.schemaTarget });
    const actor = { id: null, label: 'test', superAdmin: async () => true };
    const next = parsed(shop('1.1.0', schema, { note: false, extras: false }));
    const log: string[] = [];
    const outcome = await removals.afterApply({
      key: 'shop',
      rowId: row.row.id,
      connectionId: h.connectionId,
      previous: parsed(shop('1.0.0', schema)),
      manifest: next,
      hash: 'h-1.1.0',
      drops: 'ask',
      actor,
      log: (line) => log.push(line),
    });
    expect(outcome.dropped.tables).toEqual([real('extras')]);
    expect(outcome.pending?.changes).toEqual([{ kind: 'column', table: 'orders', tableName: real('orders'), column: 'note', rows: 2 }]);
    expect(await nullable(h, dialect, 'orders', 'note', schema)).toBe(true);
    const afterDrop = await tablesOn(h, dialect);
    expect(afterDrop).not.toContain(pg ? 'sales.extras' : 'extras');
    if (pg) {
      expect(afterDrop).toContain('public.extras');
      expect(await nullable(h, dialect, 'orders', 'note', 'public')).toBe(false);
    }
    // Accepted: the note goes from the app's table, and the twin keeps its own.
    const answered = await removals.answer({ key: 'shop', connectionId: h.connectionId, accept: true, actor, manifest: next });
    expect(answered.dropped.columns).toEqual([`${real('orders')}.note`]);
    expect(await nullable(h, dialect, 'orders', 'note', schema)).toBeNull();
    if (pg) expect(await nullable(h, dialect, 'orders', 'note', 'public')).toBe(false);

    // Dropped with its tables: the app's go, the owner's stay with their row.
    const gone = await h.inject({ method: 'DELETE', url: '/apps/shop', payload: { dropTables: true, confirmKey: 'shop' } });
    expect(gone.statusCode, gone.body).toBe(200);
    const left = await tablesOn(h, dialect);
    for (const name of ['orders', 'jobs']) expect(left).not.toContain(pg ? `sales.${name}` : name);
    if (pg) {
      expect(left).toEqual(expect.arrayContaining(['public.orders', 'public.jobs', 'public.extras']));
      expect(await h.rows('SELECT id, code FROM public.orders')).toEqual([{ id: 1, code: 'MINE' }]);
    }
  }, 240_000);

  it.skipIf(!available)('keep a private table private when the app leaves it behind', async () => {
    harness = await installHarness(dialect, { superAdmin: true });
    const h = harness;
    const schema = dialect === 'postgres' ? SCHEMA : undefined;
    const installed = await h.install(shop('1.0.0', schema));
    expect(installed.statusCode, installed.body).toBe(200);
    const jobsId = (await loadSnapshotView(h.meta, h.connectionId)).table(schema === undefined ? 'jobs' : `${schema}.jobs`).id;
    const whose = async () =>
      (await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' }))
        .filter((rule) => rule.tableName === jobsId && ['table.private', 'table.belongs', 'column.staff'].includes(rule.op))
        .map((rule) => rule.op)
        .sort();
    const before = await whose();
    expect(before).toContain('table.private');

    const kept = await h.inject({ method: 'DELETE', url: '/apps/shop', payload: { dropTables: false } });
    expect(kept.statusCode, kept.body).toBe(200);
    // Its rows are still read only by the people each belongs to: the mark, and the ways they belong, stay.
    expect(await whose()).toEqual(before);
    // The rest of the app's rules went with it.
    expect((await overridesRepo(h.meta).listForConnection(h.connectionId, { status: 'active' })).some((rule) => rule.op === 'table.label')).toBe(false);
  }, 240_000);
});
