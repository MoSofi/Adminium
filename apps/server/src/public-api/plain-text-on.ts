// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The columns a stranger's create holds to plain text (`anonymous.plainText`),
 * on each table of one connection, wherever the create was declared: an
 * endpoint (every app's public access became one) or a key scope written by
 * hand.
 *
 * Read by the doors that CHANGE a row: a column a create judges is judged on
 * every change that writes it too — through the row's own link, a signed-in
 * person's rows or a batch — whichever key or entry the change comes through,
 * so a buyer's name refused on the order is not written in by a change after.
 */
import { publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { linkFreeText } from './anonymous-caps.js';
import { parseDefinition } from './endpoint.js';

/** Plain-text columns by table, under the table's own name (a schema before it or not). */
export type PlainTextOn = ReadonlyMap<string, ReadonlySet<string>>;

const bareName = (table: string): string => table.slice(table.lastIndexOf('.') + 1);

/** Just what a stored scope says about its resources' plain-text columns. */
const scopeSchema = z.object({
  resources: z
    .array(z.object({ table: z.string(), anonymous: z.object({ plainText: z.array(z.string()).optional() }).passthrough().optional() }).passthrough())
    .default([]),
});

export async function plainTextOn(meta: MetaDb, connectionId: string): Promise<PlainTextOn> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, columns: readonly string[] | undefined) => {
    if (columns === undefined || columns.length === 0) return;
    const name = bareName(table);
    const set = out.get(name) ?? new Set<string>();
    for (const column of columns) set.add(column);
    out.set(name, set);
  };
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    if (parsed.ok) add(parsed.definition.source, parsed.definition.anonymous?.plain_text);
  }
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = scopeSchema.safeParse(document);
    if (parsed.success) for (const resource of parsed.data.resources) add(resource.table, resource.anonymous?.plainText);
  }
  return out;
}

/** A few seconds of what a connection declares, for the doors that ask on every change. */
const RECENT_MS = 5_000;
const recentByMeta = new WeakMap<MetaDb, Map<string, { at: number; columns: Promise<PlainTextOn> }>>();

/** {@link plainTextOn} as it stood a moment ago at most. */
export function recentPlainTextOn(meta: MetaDb, connectionId: string, now = Date.now()): Promise<PlainTextOn> {
  let recent = recentByMeta.get(meta);
  if (recent === undefined) recentByMeta.set(meta, (recent = new Map()));
  const hit = recent.get(connectionId);
  if (hit !== undefined && now - hit.at < RECENT_MS) return hit.columns;
  const columns = plainTextOn(meta, connectionId);
  recent.set(connectionId, { at: now, columns });
  columns.catch(() => recent.delete(connectionId));
  return columns;
}

/** The first column a change writes that a create on its table holds to plain text, and that is not; or null. */
export function notPlainOn(declared: PlainTextOn, table: string, values: Readonly<Record<string, unknown>>): string | null {
  const columns = declared.get(bareName(table));
  if (columns === undefined) return null;
  for (const column of columns) {
    if (Object.prototype.hasOwnProperty.call(values, column) && !linkFreeText(values[column])) return column;
  }
  return null;
}
