// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SAVE AS APP, END TO END: a database built by hand, saved through the service
 * into a real `.tgz`, read back the way an upload reads it, and installed on a
 * fresh database of the same engine.
 *
 * What it proves together, where each part's own suite proves one kind: the
 * file the service writes is one the installer takes; the target gets the
 * same tables (by introspection), the pages, the role and the starting rows;
 * and installing the file back onto the database it came from is refused.
 */
import { pagesRepo, permissionsRepo, rolesRepo, snapshotsRepo } from '@adminium/meta';
import { parseDatabaseModel } from '@adminium/engine';
import { afterEach, describe, expect, it } from 'vitest';

import { readAddOnTarball } from '../src/add-ons/archive.js';
import { createSaveService, type SaveRights } from '../src/apps/save/service.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { runGeneration } from '../src/generate/run.js';
import { ENGINES, installHarness, type Dialect, type Harness } from './app-install-harness.js';
import { memoryLibrary } from './app-save-rules.helpers.js';

const HOST: SaveRights = { userId: null, can: async () => true, readsWhole: async () => true };
const NONE = { read: false, create: false, update: false, delete: false, export: false, import: false };

const TABLES: Record<Dialect, readonly string[]> = {
  sqlite: [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, city VARCHAR(80))',
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status VARCHAR(40), total DECIMAL(10,2))',
  ],
  postgres: [
    'CREATE TABLE customers (id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL, city VARCHAR(80))',
    'CREATE TABLE orders (id SERIAL PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), status VARCHAR(40), total DECIMAL(10,2))',
  ],
  mysql: [
    'CREATE TABLE customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, city VARCHAR(80))',
    'CREATE TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, customer_id INT, status VARCHAR(40), total DECIMAL(10,2), FOREIGN KEY (customer_id) REFERENCES customers(id))',
  ],
};

async function modelOf(h: Harness) {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  if (snapshot === null) throw new Error('no snapshot');
  return parseDatabaseModel(snapshot.schema);
}

/** The columns of a table as `name:type:nullable`, by introspection. */
async function shapeOf(h: Harness, name: string): Promise<string[]> {
  const table = (await modelOf(h)).tables.find((one) => one.name === name);
  if (table === undefined) return [];
  // SQLite keeps a decimal as a real number: the installer makes it so there.
  const type = (logical: string) => (h.dsn.startsWith('sqlite') && logical === 'decimal' ? 'float' : logical);
  return table.columns.map((column) => `${column.name}:${type(column.logicalType)}:${String(column.nullable)}`).sort();
}

describe.each(ENGINES)('save as app, end to end, on %s', (dialect, available) => {
  const open: Harness[] = [];
  afterEach(async () => {
    for (const h of open.splice(0)) await h.close();
  });

  it.runIf(available)('installs the saved file on a fresh database with the same tables, pages, role and starting rows', async () => {
    const library = memoryLibrary();
    const source = await installHarness(dialect, { library, full: true });
    open.push(source);
    for (const statement of TABLES[dialect]) await source.run(statement);
    await source.run("INSERT INTO customers (id, name, city) VALUES (1, 'Ada', 'Leith'), (2, 'Bo', 'Fife')");
    await runIntrospection({ manager: source.manager, meta: source.meta, connectionId: source.connectionId });
    await runGeneration({ manager: source.manager, meta: source.meta, connectionId: source.connectionId, createdBy: null });

    const model = await modelOf(source);
    const idOf = (name: string) => model.tables.find((table) => table.name === name)!.id;
    const pages = await pagesRepo(source.meta).listForConnection(source.connectionId);
    expect(pages.length).toBeGreaterThan(0);
    const clerk = await rolesRepo(source.meta).create({ slug: 'clerk', name: 'Clerk' });
    await permissionsRepo(source.meta).grant(clerk.id, 'table', `${source.connectionId}/${idOf('orders')}`, { ...NONE, read: true, update: true });
    await permissionsRepo(source.meta).grant(clerk.id, 'table', `${source.connectionId}/${idOf('customers')}`, { ...NONE, read: true });

    const service = createSaveService({
      meta: source.meta,
      storage: library,
      masterSecret: 'a-test-master-secret-of-enough-length',
      adminiumVersion: '0.3.49',
      dialectOf: async () => dialect,
      displayName: async () => 'Corner shop, Leith',
      dataDb: async (connectionId) => (await source.manager.data(connectionId)).db,
    });
    // `city` reads as personal: its values travel only when ticked (the rows suite proves the rule itself).
    const request = { connectionId: source.connectionId, key: 'corner', name: 'Corner shop', rows: { [idOf('customers')]: { mode: 'starting' as const } }, answers: { personalColumns: [`${idOf('customers')}.city`] } };
    const plan = await service.plan(request, HOST);
    expect(plan.problems, JSON.stringify(plan.problems)).toEqual([]);
    expect(plan.check.filter((item) => item.group === 'choice'), JSON.stringify(plan.check)).toEqual([]);
    expect(plan.counts).toMatchObject({ tables: 2, roles: 1, seeds: 1 });

    const saved = await service.save(request, HOST);
    const entries = readAddOnTarball(saved.tarball);
    const manifest = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.path === 'manifest.json')!.bytes)) as Record<string, unknown>;
    const files = Object.fromEntries(entries.filter((entry) => entry.path !== 'manifest.json').map((entry) => [entry.path, Buffer.from(entry.bytes).toString('latin1')]));
    // Nothing of this install travels: no connection id, no row id of the meta store.
    expect(JSON.stringify(manifest)).not.toContain(source.connectionId);
    expect(JSON.stringify(manifest)).not.toMatch(/"(?:role|page|conn)_[0-9A-HJKMNP-TV-Z]{26}"/);

    // Back onto the database it came from: refused, it would double everything.
    const back = await source.install(manifest, {}, files);
    expect(back.statusCode).not.toBe(200);
    expect(back.body).toContain('SAVED_FROM_HERE');

    const target = await installHarness(dialect, { library: memoryLibrary(), full: true });
    open.push(target);
    const installed = await target.install(manifest, {}, files);
    expect(installed.statusCode, installed.body).toBe(200);
    await runIntrospection({ manager: target.manager, meta: target.meta, connectionId: target.connectionId });

    for (const name of ['customers', 'orders']) expect(await shapeOf(target, name), name).toEqual(await shapeOf(source, name));
    const targetPages = await pagesRepo(target.meta).listForConnection(target.connectionId);
    expect(targetPages.length).toBe((manifest['pages'] as unknown[]).length);
    expect((await rolesRepo(target.meta).list()).map((role) => role.slug)).toContain('corner-clerk');
    expect((await target.rows('SELECT id, name, city FROM customers ORDER BY id')).map((row) => [Number(row['id']), row['name'], row['city']])).toEqual([
      [1, 'Ada', 'Leith'],
      [2, 'Bo', 'Fife'],
    ]);
  });
});
