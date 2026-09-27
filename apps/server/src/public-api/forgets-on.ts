// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every `forget` declared on one connection's tables, wherever it was
 * declared: an endpoint, a key scope written by hand, and an app's own
 * entries — even one whose public access was declined at install, since its
 * people may still have been forgotten before.
 *
 * Read by the outbox: a message about a person who deleted their details goes
 * nowhere, whatever address was written on it before they did.
 */
import type { AppManifest } from '@adminium/manifest';
import { appTablesRepo, publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { parseDefinition } from './endpoint.js';

/** What a table's people forget: the columns emptied, and the stamp that says when. */
export interface ForgetRule {
  columns: readonly string[];
  stamp?: string | undefined;
}

/** Every table's `forget`, by table name (schema left off, as withholds are kept). */
export type TableForgets = ReadonlyMap<string, ForgetRule>;

const scopeSchema = z.object({
  resources: z
    .array(z.object({ table: z.string(), forget: z.object({ columns: z.array(z.string()), stamp: z.string().optional() }).nullable().optional() }).passthrough())
    .default([]),
});

const bare = (table: string) => table.slice(table.lastIndexOf('.') + 1);

export async function forgetsOn(meta: MetaDb, connectionId: string, app?: { key: string; manifest: AppManifest | null } | undefined): Promise<TableForgets> {
  const out = new Map<string, ForgetRule>();
  const add = (table: string, rule: ForgetRule | null | undefined) => {
    if (rule === null || rule === undefined) return;
    const name = bare(table);
    const had = out.get(name);
    out.set(name, { columns: [...new Set([...(had?.columns ?? []), ...rule.columns])], stamp: had?.stamp ?? rule.stamp });
  };
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    if (parsed.ok) add(parsed.definition.source, parsed.definition.forget);
  }
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = scopeSchema.safeParse(document);
    if (parsed.success) for (const resource of parsed.data.resources) add(resource.table, resource.forget);
  }
  const entries = app?.manifest?.publicAccess ?? [];
  if (app !== undefined && entries.some((entry) => entry.forget !== undefined)) {
    for (const record of await appTablesRepo(meta).forInstall(connectionId, app.key)) {
      for (const entry of entries) if (entry.table === record.ref) add(record.tableName, entry.forget);
    }
  }
  return out;
}

/** The forget a table declares, by its id or name. */
export function forgetOf(forgets: TableForgets, table: string): ForgetRule | undefined {
  return forgets.get(bare(table));
}

/**
 * Whether a person deleted their details: the forget's stamp is filled, or —
 * with no stamp declared — the address the outbox reads is one of the columns
 * a forget empties, and it is empty.
 */
export function isForgotten(rule: ForgetRule | undefined, person: Readonly<Record<string, unknown>>, email: string): boolean {
  if (rule === undefined) return false;
  const filled = (value: unknown) => value !== null && value !== undefined && value !== '';
  if (rule.stamp !== undefined) return filled(person[rule.stamp]);
  return rule.columns.includes(email) && !filled(person[email]);
}
