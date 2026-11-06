// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the saves of roles, rules and mails share in their tests: a source
 * database with two tables a person made (customers, orders) and a page on
 * each, the converter run over it, and the file it writes installed on a
 * fresh database.
 *
 * The tables and pages parts are built in other branches. Until they land,
 * `standIns` writes those blocks by hand for the two tables and their pages,
 * so the roles, rules and mails a test saves have something to name.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest } from '@adminium/manifest';
import { appAfterInstallRepo, filesRepo, pagesRepo, snapshotsRepo, type MetaDb } from '@adminium/meta';
import { expect } from 'vitest';

import { runIntrospection } from '../src/connections/introspect.js';
import { convertToApp, type ConvertResult } from '../src/apps/save/convert.js';
import type { SaveChoices, SaveDialect } from '../src/apps/save/types.js';
import type { FileStore } from '../src/files/store.js';
import { installHarness, type Dialect, type Harness } from './app-install-harness.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
export type Doc = Record<string, any>;

export const APP_KEY = 'corner';

/** A library that keeps the bytes in memory, and reads them back. */
export function memoryLibrary(): FileStore & { kept: Map<string, Buffer> } {
  const kept = new Map<string, Buffer>();
  return {
    kept,
    write: async (input: { id: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes);
      kept.set(input.id, bytes);
      return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'memory' };
    },
    read: async (file: { storageKey: string }) => Readable.from([kept.get(file.storageKey) ?? Buffer.alloc(0)]),
  } as unknown as FileStore & { kept: Map<string, Buffer> };
}

const TABLES: Record<Dialect, string[]> = {
  sqlite: [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(200))',
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, status VARCHAR(40), total DECIMAL(10,2), FOREIGN KEY (customer_id) REFERENCES customers(id))',
  ],
  postgres: [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(200))',
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, status VARCHAR(40), total DECIMAL(10,2), FOREIGN KEY (customer_id) REFERENCES customers(id))',
  ],
  mysql: [
    'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(200))',
    'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, status VARCHAR(40), total DECIMAL(10,2), FOREIGN KEY (customer_id) REFERENCES customers(id))',
  ],
};

export interface Source {
  h: Harness;
  dialect: Dialect;
  library: FileStore & { kept: Map<string, Buffer> };
  /** Model id of each table, by its name. */
  tableId: (name: string) => string;
  /** The two pages a person made, by slug. */
  pageId: (slug: string) => string;
}

/** A database with customers and orders, a page on each, and a Files library. */
export async function sourceDatabase(dialect: Dialect): Promise<Source> {
  const library = memoryLibrary();
  const h = await installHarness(dialect, { library, full: true });
  for (const statement of TABLES[dialect]) await h.run(statement);
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
  const model = await modelOf(h.meta, h.connectionId);
  const tableId = (name: string) => {
    const found = model.tables.find((table) => table.name === name);
    if (found === undefined) throw new Error(`no table ${name}`);
    return found.id;
  };
  const pages = new Map<string, string>();
  for (const [slug, title] of [
    ['customer-list', 'Customers'],
    ['order-list', 'Orders'],
  ] as const) {
    const page = await pagesRepo(h.meta).create({ connectionId: h.connectionId, slug, type: 'table', title, config: {} });
    pages.set(slug, page.id);
  }
  return {
    h,
    dialect,
    library,
    tableId,
    pageId: (slug) => {
      const id = pages.get(slug);
      if (id === undefined) throw new Error(`no page ${slug}`);
      return id;
    },
  };
}

export async function modelOf(meta: MetaDb, connectionId: string) {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) throw new Error('no snapshot');
  return parseDatabaseModel(snapshot.schema);
}

/** Runs the converter over the source, with the two pages and two tables chosen. */
export async function save(source: Source, over: Partial<SaveChoices> = {}): Promise<ConvertResult> {
  return convertToApp(
    {
      meta: source.h.meta,
      connectionId: source.h.connectionId,
      dialect: source.dialect as SaveDialect,
      model: await modelOf(source.h.meta, source.h.connectionId),
      adminiumVersion: '0.3.49',
      readFile: async (fileId: string) => {
        const file = await filesRepo(source.h.meta).findById(fileId);
        const bytes = file === null ? undefined : source.library.kept.get(file.storageKey);
        return bytes === undefined ? null : new Uint8Array(bytes);
      },
    },
    {
      key: APP_KEY,
      name: 'Corner shop',
      version: '1.0.0',
      label: 'Corner shop, Leith',
      lineage: 'lin-test-0001',
      savedAt: '2026-11-06T09:00:00Z',
      pages: [source.pageId('customer-list'), source.pageId('order-list')],
      ...over,
    },
  );
}

/**
 * The blocks the tables and pages parts write, by hand for the two tables
 * and their two pages, where the converter left them empty.
 */
export function standIns(manifest: Doc, over: Doc = {}): Doc {
  const doc = structuredClone(manifest);
  if ((doc['requiredSchema']?.tables ?? []).length === 0) {
    doc['requiredSchema'] = {
      tables: [
        {
          ref: 'customers',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 100 },
            { ref: 'email', type: 'text', maxLength: 200, nullable: true },
          ],
        },
        {
          ref: 'orders',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'customer_id', type: 'fk', references: 'customers', nullable: true },
            { ref: 'status', type: 'text', maxLength: 40, nullable: true },
            { ref: 'total', type: 'decimal', precision: 10, scale: 2, nullable: true },
          ],
        },
      ],
    };
  }
  if ((doc['pages'] ?? []).length === 0) {
    doc['pages'] = [
      { ref: 'customer-list', template: 'page-crud', title: { key: `${APP_KEY}.customers`, fallback: 'Customers' }, nav: { group: `manifest:${APP_KEY}`, icon: 'list', order: 1 }, bindings: { main: 'customers' } },
      { ref: 'order-list', template: 'page-crud', title: { key: `${APP_KEY}.orders`, fallback: 'Orders' }, nav: { group: `manifest:${APP_KEY}`, icon: 'list', order: 2 }, bindings: { main: 'orders' } },
    ];
  }
  doc['compatibility'] = { ...doc['compatibility'], engines: ['postgres', 'mysql', 'sqlite'] };
  return { ...doc, ...over };
}

/** The file validates as an upload of a file made on an Adminium does. */
export function expectValid(doc: Doc): void {
  const result = validateManifest(doc, { allowLocalPublisher: true });
  expect(result.ok ? [] : result.issues, JSON.stringify(result.ok ? [] : result.issues)).toEqual([]);
}

/** A fresh database on the same engine, with a library, to install the file on. */
export async function target(dialect: Dialect): Promise<Harness & { library: FileStore & { kept: Map<string, Buffer> } }> {
  const library = memoryLibrary();
  const h = await installHarness(dialect, { library, full: true });
  return Object.assign(h, { library });
}

/** Installs the file with its package files. */
export async function installFile(h: Harness, doc: Doc, files: Map<string, Uint8Array> = new Map()): Promise<void> {
  const packaged = Object.fromEntries([...files].map(([path, bytes]) => [path, Buffer.from(bytes).toString('latin1')]));
  const reply = await h.install(doc, {}, packaged);
  expect(reply.statusCode, reply.body).toBe(200);
}

/** The install's "after you install" list, as `[kind, item, field]`. */
export async function afterInstallOf(h: Harness): Promise<string[][]> {
  const row = await h.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', APP_KEY).executeTakeFirstOrThrow();
  return (await appAfterInstallRepo(h.meta).list(row.id)).map((item) => [item.kind, item.item, item.field]).sort();
}

/** Whether any of the values appears anywhere in the file. */
export function leaked(doc: unknown, values: readonly string[]): string[] {
  const text = JSON.stringify(doc);
  return values.filter((value) => value !== '' && text.includes(value));
}
