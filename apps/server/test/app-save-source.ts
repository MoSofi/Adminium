// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the save tests share: a database's tables made by hand on the install
 * harness, the source a save reads, and the file it writes as the harness
 * stages it.
 */
import { parseDatabaseModel, type DatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';
import { expect } from 'vitest';

import { convertToApp, type ConvertResult } from '../src/apps/save/convert.js';
import type { RowsSource } from '../src/apps/save/rows.js';
import type { SaveChoices } from '../src/apps/save/types.js';
import { runIntrospection } from '../src/connections/introspect.js';
import type { Dialect, Harness } from './app-install-harness.js';

type Doc = Record<string, unknown>;

/** Run each statement, then read the database again, as a refresh in Studio does. */
export async function made(h: Harness, statements: readonly string[]): Promise<void> {
  for (const statement of statements) await h.run(statement);
  await runIntrospection({ manager: h.manager, meta: h.meta, connectionId: h.connectionId });
}

export async function latestModel(h: Harness): Promise<DatabaseModel> {
  const snapshot = await snapshotsRepo(h.meta).latest(h.connectionId);
  return parseDatabaseModel(snapshot!.schema);
}

/** The model's id of a table by its name (`public.orders`, `main.orders`, `<db>.orders`). */
export async function tableId(h: Harness, name: string): Promise<string> {
  const table = (await latestModel(h)).tables.find((one) => one.name === name);
  expect(table, name).toBeDefined();
  return table!.id;
}

/** An override a person would write, on a table by its name. */
export async function override(h: Harness, table: string, op: string, value: Doc, column: string | null = null, origin: 'user' | 'auto' = 'user'): Promise<void> {
  await overridesRepo(h.meta).create({ connectionId: h.connectionId, op, tableName: await tableId(h, table), columnName: column, value, origin });
}

/** The quick save's choices, for an app called `shop`, with no page, role or other part of its own. */
export function choicesFor(extra: Partial<SaveChoices> = {}): SaveChoices {
  return {
    key: 'shop',
    name: 'Shop',
    version: '1.0.0',
    label: 'Made here',
    lineage: 'lin-test-0001',
    savedAt: '2026-11-06T10:00:00.000Z',
    pages: [],
    roles: [],
    automations: [],
    emailTemplates: [],
    documents: [],
    reports: [],
    invoiceLayouts: [],
    scheduledReports: [],
    publicEndpoints: [],
    payments: false,
    ...extra,
  };
}

export async function sourceOf(h: Harness, dialect: Dialect, rows = false): Promise<RowsSource> {
  const source: RowsSource = { meta: h.meta, connectionId: h.connectionId, dialect, model: await latestModel(h), adminiumVersion: '0.3.49' };
  if (rows) source.rows = { db: (await h.manager.data(h.connectionId)).db };
  return source;
}

export async function save(h: Harness, dialect: Dialect, extra: Partial<SaveChoices> = {}, rows = false): Promise<ConvertResult> {
  return convertToApp(await sourceOf(h, dialect, rows), choicesFor(extra));
}

/**
 * The file as an upload carries it. The other parts of the converter write
 * the pages; until they run here a list page of the first table is given, as
 * the wizard requires one.
 */
export function asFile(result: ConvertResult): { manifest: Doc; files: Record<string, string> } {
  const manifest = structuredClone(result.manifest) as unknown as Doc;
  const tables = (manifest['requiredSchema'] as { tables: { ref: string }[] }).tables;
  if ((manifest['pages'] as unknown[]).length === 0) {
    manifest['pages'] = [{ ref: 'shop-list', template: 'page-crud', title: { key: 'shop.list', fallback: 'List' }, nav: { group: 'records', icon: 'list', order: 1 }, bindings: { rows: tables[0]!.ref } }];
  }
  const files = Object.fromEntries([...result.files].map(([path, bytes]) => [path, Buffer.from(bytes).toString('utf8')]));
  return { manifest, files };
}

/**
 * The tables of a model as introspection reads them, by what an app keeps:
 * columns, nulls, keys, links. On SQLite the installer makes a yes/no an
 * `integer` and a decimal a `real` (the four storage classes; a rule keeps
 * what they are), so those read as one there.
 */
export function shapeOf(model: DatabaseModel, names: readonly string[]): Doc {
  const sqlite: Record<string, string> = model.dialect === 'sqlite' ? { boolean: 'integer', decimal: 'float' } : {};
  const family = (type: string): string => sqlite[type] ?? (type === 'varchar' ? 'text' : type === 'timestamp' ? 'timestamptz' : type);
  const out: Doc = {};
  for (const name of names) {
    const table = model.tables.find((one) => one.name === name);
    if (table === undefined) {
      out[name] = null;
      continue;
    }
    out[name] = {
      key: table.primaryKey,
      columns: table.columns.map((column) => [column.name, family(column.logicalType), column.nullable]).sort(),
      links: model.relations
        .filter((rel) => rel.kind === 'declared-fk' && rel.from.tableId === table.id)
        .map((rel) => `${rel.from.columns.join(',')}->${model.tables.find((one) => one.id === rel.to.tableId)?.name ?? '?'}.${rel.to.columns.join(',')}`)
        .sort(),
    };
  }
  return out;
}
