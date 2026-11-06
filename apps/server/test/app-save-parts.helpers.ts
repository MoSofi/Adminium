// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Round trips of the saved parts: a database a person built by hand (tables
 * made with plain SQL, parts made the way their screens make them), saved as
 * an app, validated, and installed on a fresh database of the same engine.
 *
 * The tables and pages parts belong to other parts of the save. Until they
 * write their blocks, `withOtherParts` splices in the tables and pages these
 * tests' parts name, by the refs the save gave them.
 */
import { parseDatabaseModel } from '@adminium/engine';
import { validateManifest, type AppManifest } from '@adminium/manifest';
import { snapshotsRepo } from '@adminium/meta';
import { expect } from 'vitest';

import { convertToApp, type ConvertResult } from '../src/apps/save/convert.js';
import type { SaveChoices, SaveSource } from '../src/apps/save/types.js';
import { addOnHarness, type Dialect, type Harness } from './app-add-ons.helpers.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a manifest read and changed freely
export type Doc = Record<string, any>;

/** The shop's tables, as a person makes them by hand: the same SQL on every engine. */
export const SHOP_SQL = [
  'CREATE TABLE clients (id INTEGER PRIMARY KEY, email VARCHAR(200) NOT NULL, name VARCHAR(120))',
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES clients(id), number VARCHAR(40) NOT NULL, email VARCHAR(200), status VARCHAR(20) NOT NULL, total DECIMAL(10,2) NOT NULL, note VARCHAR(200))',
  'CREATE TABLE order_lines (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), position INTEGER NOT NULL, description VARCHAR(200), amount DECIMAL(10,2) NOT NULL)',
];

/** The same tables as the tables part will declare them. */
export const SHOP_TABLES: Doc[] = [
  {
    ref: 'clients',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'email', type: 'text', maxLength: 200 },
      { ref: 'name', type: 'text', maxLength: 120, nullable: true },
    ],
  },
  {
    ref: 'orders',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'client_id', type: 'fk', references: 'clients', nullable: true },
      { ref: 'number', type: 'text', maxLength: 40 },
      { ref: 'email', type: 'text', maxLength: 200, nullable: true },
      { ref: 'status', type: 'text', maxLength: 20 },
      { ref: 'total', type: 'decimal', scale: 2 },
      { ref: 'note', type: 'text', maxLength: 200, nullable: true },
    ],
  },
  {
    ref: 'order_lines',
    columns: [
      { ref: 'id', type: 'int', role: 'pk' },
      { ref: 'order_id', type: 'fk', references: 'orders' },
      { ref: 'position', type: 'int' },
      { ref: 'description', type: 'text', maxLength: 200, nullable: true },
      { ref: 'amount', type: 'decimal', scale: 2 },
    ],
  },
];

/** A database with the shop's tables made by hand, and read. */
export async function handMadeShop(dialect: Dialect, opts: Parameters<typeof addOnHarness>[1] = {}): Promise<Harness> {
  const h = await addOnHarness(dialect, { unbuiltWords: {}, ...opts });
  for (const statement of SHOP_SQL) await h.rows(statement);
  await h.introspect();
  return h;
}

export async function sourceOf(h: Harness): Promise<SaveSource> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return { meta: h.meta, connectionId: h.connectionId, dialect: h.dialect, model: parseDatabaseModel(snapshot!.schema as never), adminiumVersion: '0.3.49' };
}

export function choices(over: Partial<SaveChoices> = {}): SaveChoices {
  return { key: 'corner-shop', name: 'Corner shop', version: '1.0.0', label: 'The test bench', lineage: 'lineage_test_0001', savedAt: '2026-11-06T10:00:00.000Z', ...over };
}

/** What the tables and pages parts will write, spliced in: the shop's tables, and a page per ref asked for. */
export function withOtherParts(result: ConvertResult, pages: readonly string[] = []): Doc {
  const doc = structuredClone(result.manifest) as unknown as Doc;
  doc['requiredSchema'] = { tables: SHOP_TABLES };
  const own = (doc['pages'] as Doc[]) ?? [];
  doc['pages'] = [
    ...own,
    ...(pages.length === 0 && own.length === 0 ? ['orders'] : pages).map((ref, n) => ({
      ref,
      template: 'page-crud',
      title: { key: `shop.${ref}`, fallback: ref },
      nav: { group: 'manifest:corner-shop', icon: 'list', order: n + 1 },
      bindings: { main: 'orders' },
    })),
  ];
  return doc;
}

/** Validated as an upload is: a file made here. */
export function expectValid(doc: Doc): AppManifest {
  const result = validateManifest(doc, { allowLocalPublisher: true });
  expect(result.ok ? [] : result.issues).toEqual([]);
  return (result as { manifest: AppManifest }).manifest;
}

/** Installed on a fresh database of the same engine, through the real upload path. */
export async function installSaved(target: Harness, doc: Doc, files: ReadonlyMap<string, Uint8Array> = new Map(), extra: Doc = {}): Promise<Doc> {
  await target.stageApp(doc, Object.fromEntries(files));
  const reply = await target.install(String(doc['key']), String(doc['version']), extra);
  expect(reply.statusCode, reply.body).toBe(200);
  return reply.json() as Doc;
}

/** Nothing of the source's own ids, and none of the values given. */
export function expectNoneOf(doc: unknown, values: readonly string[]): void {
  const text = JSON.stringify(doc);
  for (const value of values) expect(text, `the file holds "${value}"`).not.toContain(value);
}

export { addOnHarness, type Dialect, type Harness };
