// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The first-boot source seed (28-T31) end to end, unmocked, against a real
 * database — the boot a `docker compose up` performs, minus the container.
 *
 * `source-seed.test.ts` owns the state machine with the chain mocked, which is
 * the right seam for the four answers but would pass just as happily if
 * `runIntrospection` and `runGeneration` were never wired to anything real.
 * This one asserts the product of the chain: a SQLite file with two related
 * tables goes in, and persisted `adminium_pages` rows come out.
 *
 * SQLite because it needs no service — the adapter is a real one (introspect,
 * query engine, type map), so nothing here is a stand-in for the Postgres path
 * except the dialect.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { createSqliteMetaDb, firstRun, pagesRepo, settingsRepo, type MetaDb } from '@adminium/meta';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { seedSourceConnection } from '../src/connections/seed.js';

let dir: string;
let dbPath: string;
let meta: MetaDb;
let manager: ConnectionManager;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adminium-seed-e2e-'));
  dbPath = join(dir, 'shop.db');

  // The operator's own database, the way their compose file would have left it.
  const source = new BetterSqlite3(dbPath);
  source.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      total REAL NOT NULL,
      placed_at TEXT
    );
    INSERT INTO customers (id, name, email) VALUES (1, 'Ada', 'ada@example.test');
    INSERT INTO orders (id, customer_id, total) VALUES (1, 1, 42.5);
  `);
  source.close();

  meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  manager = new ConnectionManager({
    meta,
    crypto: dsnCryptoFromSecret('seed-e2e-secret'),
    registry,
    metaDsn: null,
    blockLoopback: false,
  });
});

afterEach(async () => {
  await manager.disposeAll().catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

describe('the seed against a real database', () => {
  it('connects, introspects, and generates pages nobody authored', async () => {
    const out: string[] = [];
    const err: string[] = [];

    const result = await seedSourceConnection({
      manager,
      meta,
      sourceUrl: `sqlite:${dbPath}`,
      log: (message) => out.push(message),
      warn: (message) => err.push(message),
    });

    expect(result.kind).toBe('seeded');
    const seeded = result as { kind: 'seeded'; connectionId: string; tables: number | null; pages: number };
    expect(seeded.tables).toBe(2);
    expect(seeded.pages).toBeGreaterThan(0);

    // The rows, not the return value: this is what the dashboard serves.
    const pages = await pagesRepo(meta).listForConnection(seeded.connectionId);
    expect(pages.length).toBe(seeded.pages);
    const titles = pages.map((page) => page.title?.toLowerCase() ?? '');
    expect(titles.some((title) => title.includes('customer'))).toBe(true);
    expect(titles.some((title) => title.includes('order'))).toBe(true);

    // Connected, claimed, and one snapshot on record.
    const connection = await manager.mustFind(seeded.connectionId);
    expect(connection.status).toBe('connected');
    // Named for the file, not "Source database" — SQLite has no database name.
    expect(connection.name).toBe('shop');
    expect(await settingsRepo(meta).get('system.sourceSeededAt')).not.toBeNull();

    // Nothing the operator has to act on — but the generator's own warnings do
    // reach them, which is the point of forwarding them rather than swallowing
    // them into a return value nobody reads. This schema earns exactly one
    // ("customers has no timestamp column"), and it is the generator's voice.
    expect(err.join('\n')).not.toMatch(/Could not connect|started anyway|could not generate/);
    expect(err.some((line) => line.includes('no timestamp column'))).toBe(true);
    expect(out.join('\n')).toContain('2 table(s)');
  });

  it('is a no-op on the restart that follows', async () => {
    const sourceUrl = `sqlite:${dbPath}`;
    const first = await seedSourceConnection({
      manager,
      meta,
      sourceUrl,
      log: () => undefined,
      warn: () => undefined,
    });
    const pagesAfterFirst = await pagesRepo(meta).listForConnection(
      (first as { connectionId: string }).connectionId,
    );

    const again = await seedSourceConnection({
      manager,
      meta,
      sourceUrl,
      log: () => undefined,
      warn: () => undefined,
    });

    expect(again).toEqual({ kind: 'skipped', reason: 'already-seeded' });
    expect(await manager.connections.list()).toHaveLength(1);
    // No second set of pages layered over the first.
    expect(
      await pagesRepo(meta).listForConnection((first as { connectionId: string }).connectionId),
    ).toHaveLength(pagesAfterFirst.length);
  });
});
