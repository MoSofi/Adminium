// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project's databases on a real instance: a real SQLite source, a real
 * meta store and the real adapters, as a project boot runs them.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, pagesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { projectDsn, syncProjectDatabases } from '../src/project/databases.js';

let dir: string;
let meta: MetaDb;
let manager: ConnectionManager;
let out: string[];
let err: string[];

function makeShop(file: string): void {
  const source = new BetterSqlite3(file);
  source.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), total REAL NOT NULL);
    INSERT INTO customers (id, name) VALUES (1, 'Ada');
  `);
  source.close();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-project-db-'));
  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret('project-db-test-secret'),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });
  out = [];
  err = [];
});

afterEach(async () => {
  await manager.disposeAll().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const sync = (databases: Record<string, string>, missing: string[] = [], hasPageFiles?: (key: string) => boolean) =>
  syncProjectDatabases({
    manager,
    meta,
    root: dir,
    databases: new Map(Object.entries(databases)),
    missing,
    ...(hasPageFiles === undefined ? {} : { hasPageFiles }),
    log: (message) => out.push(message),
    warn: (message) => err.push(message),
  });

describe('a relative SQLite path', () => {
  it('means relative to the project, not to wherever the server started', () => {
    expect(projectDsn('/srv/app', 'sqlite:./data/sample.sqlite')).toBe(`sqlite:${join('/srv/app', 'data', 'sample.sqlite')}`);
    expect(projectDsn('/srv/app', 'sqlite:/abs/x.db')).toBe('sqlite:/abs/x.db');
    expect(projectDsn('/srv/app', 'sqlite::memory:')).toBe('sqlite::memory:');
    expect(projectDsn('/srv/app', 'postgres://u@h/db')).toBe('postgres://u@h/db');
  });
});

describe('syncing the configured databases', () => {
  it('adds a new key, marks it with the key and generates its pages', async () => {
    makeShop(join(dir, 'shop.db'));
    const [outcome] = await sync({ main: 'sqlite:./shop.db' });
    expect(outcome).toMatchObject({ key: 'main', kind: 'created', ok: true });
    const connection = await manager.connections.findByProjectKey('main');
    expect(connection?.name).toBe('main');
    expect(connection?.status).toBe('connected');
    expect((await manager.connections.getDsns(connection!.id))?.introspectDsn).toBe(`sqlite:${join(dir, 'shop.db')}`);
    const pages = await pagesRepo(meta).listForConnection(connection!.id);
    expect(pages.length).toBeGreaterThan(0);
    // The generator's own advice may be passed on; nothing went wrong.
    expect(err.join('\n')).not.toMatch(/could not|not usable/);
    expect(out.join('\n')).toContain('Database "main": generated');
  });

  it('does nothing on the next start when nothing changed', async () => {
    makeShop(join(dir, 'shop.db'));
    await sync({ main: 'sqlite:./shop.db' });
    const [again] = await sync({ main: 'sqlite:./shop.db' });
    expect(again).toMatchObject({ kind: 'unchanged', ok: true });
    expect(await manager.connections.list()).toHaveLength(1);
  });

  it('stores a failing database in error, keeps going, and connects it once it works', async () => {
    const [failed] = await sync({ main: 'sqlite:./later.db' });
    expect(failed).toMatchObject({ kind: 'created', ok: false });
    expect(err.join('\n')).toContain('could not connect');
    expect((await manager.connections.findByProjectKey('main'))?.status).toBe('error');

    makeShop(join(dir, 'later.db'));
    const [retried] = await sync({ main: 'sqlite:./later.db' });
    expect(retried).toMatchObject({ kind: 'retried', ok: true });
    const connection = await manager.connections.findByProjectKey('main');
    expect(connection?.status).toBe('connected');
    // It had never been introspected, so this start generated its pages.
    expect((await pagesRepo(meta).listForConnection(connection!.id)).length).toBeGreaterThan(0);
  });

  it('replaces the stored URL when the config changes it', async () => {
    makeShop(join(dir, 'a.db'));
    makeShop(join(dir, 'b.db'));
    await sync({ main: 'sqlite:./a.db' });
    const [updated] = await sync({ main: 'sqlite:./b.db' });
    expect(updated).toMatchObject({ kind: 'updated', ok: true });
    const connection = await manager.connections.findByProjectKey('main');
    expect((await manager.connections.getDsns(connection!.id))?.introspectDsn).toBe(`sqlite:${join(dir, 'b.db')}`);
    expect(out.join('\n')).toContain('the URL changed');
  });

  it('refuses an unusable URL without stopping the others', async () => {
    makeShop(join(dir, 'shop.db'));
    const outcomes = await sync({ broken: 'mongodb://nope', main: 'sqlite:./shop.db' });
    expect(outcomes.map((o) => [o.key, o.kind])).toEqual([
      ['broken', 'refused'],
      ['main', 'created'],
    ]);
    expect(await manager.connections.findByProjectKey('broken')).toBeNull();
  });

  it('says which keys still need a URL, and keeps a connection whose key was removed', async () => {
    makeShop(join(dir, 'shop.db'));
    await sync({ old: 'sqlite:./shop.db' });
    out = [];
    await sync({}, ['main']);
    expect(out.join('\n')).toContain('Database "main" has no URL yet');
    expect(out.join('\n')).toContain('Database "old" is no longer in the project config');
    expect(await manager.connections.findByProjectKey('old')).not.toBeNull();
  });

  it('only reads the schema of a database whose pages are already in the project files', async () => {
    makeShop(join(dir, 'shop.db'));
    const [outcome] = await sync({ main: 'sqlite:./shop.db' }, [], (key) => key === 'main');
    expect(outcome).toMatchObject({ key: 'main', kind: 'created', ok: true, pages: 0 });
    const connection = await manager.connections.findByProjectKey('main');
    expect(await snapshotsRepo(meta).latest(connection!.id)).not.toBeNull();
    expect(await pagesRepo(meta).listForConnection(connection!.id)).toEqual([]);
    expect(out.join('\n')).toContain('Database "main": read its schema; its pages come from the project\'s files.');
  });

  it('counts a connection test that throws as a failed one', async () => {
    makeShop(join(dir, 'shop.db'));
    vi.spyOn(manager, 'testDsn').mockRejectedValueOnce(new Error('the driver crashed'));
    const [outcome] = await sync({ main: 'sqlite:./shop.db' });
    expect(outcome).toMatchObject({ key: 'main', kind: 'created', ok: false });
    expect(err.join('\n')).toMatch(/Database "main": could not connect to .+: the driver crashed\. Adminium started anyway/);
    expect((await manager.connections.findByProjectKey('main'))?.status).toBe('error');
  });

  it('reports a database it could not store, and still syncs the next one', async () => {
    makeShop(join(dir, 'shop.db'));
    const find = manager.connections.findByProjectKey.bind(manager.connections);
    vi.spyOn(manager.connections, 'findByProjectKey').mockImplementation(async (key) => {
      if (key === 'archive') throw new Error('the meta store is read-only');
      return find(key);
    });
    const outcomes = await sync({ archive: 'sqlite:./shop.db', main: 'sqlite:./shop.db' });
    expect(outcomes).toEqual([
      { key: 'archive', kind: 'refused', message: 'the meta store is read-only' },
      expect.objectContaining({ key: 'main', kind: 'created', ok: true }),
    ]);
    expect(err).toContain('Database "archive": the meta store is read-only');
  });
});
