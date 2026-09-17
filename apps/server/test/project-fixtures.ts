// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An install with a project database and its generated pages: a real SQLite
 * shop, a real meta store and the real adapters, the way a project boot makes
 * them. Two of these stand for two installs of the same project.
 */
import { mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { createSqliteMetaDb, firstRun, type MetaDb } from '@adminium/meta';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { syncProjectDatabases } from '../src/project/databases.js';

/** Tables that give the generator something to build dashboards, boards and calendars from. */
export function makeShopDatabase(file: string): void {
  const source = new BetterSqlite3(file);
  source.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL,
      email VARCHAR(160) NOT NULL UNIQUE,
      plan VARCHAR(16) NOT NULL CHECK (plan IN ('free', 'pro', 'business')),
      lifecycle_stage VARCHAR(16) NOT NULL CHECK (lifecycle_stage IN ('lead', 'trial', 'customer', 'churned')),
      mrr_amount DECIMAL(10,2) NOT NULL,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'refunded')),
      total_amount DECIMAL(10,2) NOT NULL,
      placed_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL
    );
    CREATE TABLE order_items (
      id INTEGER PRIMARY KEY,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      status VARCHAR(16) NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'review', 'done')),
      priority VARCHAR(8) NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      customer_id INTEGER REFERENCES customers(id),
      due_date DATE,
      created_at TIMESTAMP NOT NULL,
      updated_at TIMESTAMP NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      customer_id INTEGER REFERENCES customers(id),
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP NOT NULL
    );
  `);
  const plans = ['free', 'pro', 'business'];
  const stages = ['lead', 'trial', 'customer', 'churned'];
  const orderStatuses = ['pending', 'paid', 'shipped', 'refunded'];
  const taskStatuses = ['backlog', 'todo', 'in_progress', 'review', 'done'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  const at = (i: number): string => new Date(Date.UTC(2026, i % 9, (i % 27) + 1, 9)).toISOString();
  for (let i = 1; i <= 40; i += 1) {
    source
      .prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(i, `Customer ${String(i)}`, `c${String(i)}@example.com`, plans[i % 3], stages[i % 4], (i * 7.5).toFixed(2), at(i), at(i + 1));
    source
      .prepare('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?)')
      .run(i, i, orderStatuses[i % 4], (i * 12.25).toFixed(2), at(i), at(i));
    source.prepare('INSERT INTO order_items VALUES (?, ?, ?, ?, ?)').run(i, i, `Product ${String(i % 6)}`, (i % 4) + 1, '9.99');
    source
      .prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(i, `Task ${String(i)}`, taskStatuses[i % 5], priorities[i % 4], i, at(i).slice(0, 10), at(i), at(i + 2));
    source
      .prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?)')
      .run(i, `Visit ${String(i)}`, i, at(i), new Date(Date.parse(at(i)) + 3_600_000).toISOString());
  }
  source.close();
}

export interface Install {
  dir: string;
  meta: MetaDb;
  manager: ConnectionManager;
  /** The connection id of the `main` project database. */
  mainId: string;
  close(): Promise<void>;
}

/** The secret every fixture install encrypts its connection strings with. */
export const INSTALL_SECRET = 'project-files-test-secret';

export interface MakeInstallOptions {
  shop?: string;
  /** Keep the meta store in this SQLite file instead of in memory. */
  metaFile?: string;
  /** Leave the connection outside any project, as an instance made with `try` has it. */
  unkeyed?: boolean;
}

/** A fresh install whose project database `main` is connected and generated. */
export async function makeInstall(opts: MakeInstallOptions = {}): Promise<Install> {
  const dir = await mkdtemp(join(tmpdir(), 'adminium-project-install-'));
  const shop = opts.shop ?? join(dir, 'shop.db');
  if (opts.shop === undefined) makeShopDatabase(shop);
  if (opts.metaFile !== undefined) mkdirSync(dirname(opts.metaFile), { recursive: true });
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(opts.metaFile ?? ':memory:') });
  await firstRun(meta);
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret(INSTALL_SECRET),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });
  await syncProjectDatabases({
    manager,
    meta,
    root: dir,
    databases: new Map([['main', `sqlite:${shop}`]]),
    missing: [],
    log: () => undefined,
    warn: () => undefined,
  });
  const main = await manager.connections.findByProjectKey('main');
  if (main === null) throw new Error('the project database was not connected');
  if (opts.unkeyed === true) await manager.connections.setProjectKey(main.id, null);
  return {
    dir,
    meta,
    manager,
    mainId: main.id,
    async close() {
      await manager.disposeAll().catch(() => undefined);
      await meta.db.destroy().catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}
