// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Every `withhold` declared on one connection's tables, wherever it was
 * declared: an endpoint (every app's public access became one), a key scope
 * written by hand, and an app's own entries — even one whose public access was
 * declined at install, since its rows still change hands the same way.
 *
 * Read by the doors that show a row's columns to someone who is not reading
 * it through the entry that declared the rule: a retry of a create, an email,
 * a document (see `withhold.ts`).
 */
import type { AppManifest } from '@adminium/manifest';
import { appTablesRepo, publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { parseDefinition } from './endpoint.js';
import { collectWithholds, type TableWithholds, type WithholdRule } from './withhold.js';

/** Just what a stored scope says about its resources' withholds. */
const scopeSchema = z.object({
  resources: z
    .array(z.object({ table: z.string(), withhold: z.object({ columns: z.array(z.string()), unlessHolder: z.string() }).optional() }).passthrough())
    .default([]),
});

export async function withholdsOn(
  meta: MetaDb,
  connectionId: string,
  /** An app whose own entries count too, by the tables its install made or took. */
  app?: { key: string; manifest: AppManifest | null } | undefined,
): Promise<TableWithholds> {
  const declared: { table: string; withhold: WithholdRule | undefined }[] = [];
  for (const row of await publicEndpointsRepo(meta).listByConnection(connectionId)) {
    const parsed = parseDefinition(row.definition);
    const rule = parsed.ok ? parsed.definition.withhold : undefined;
    if (parsed.ok && rule !== undefined) declared.push({ table: parsed.definition.source, withhold: { columns: rule.columns, unlessHolder: rule.unless_holder } });
  }
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = scopeSchema.safeParse(document);
    if (parsed.success) for (const resource of parsed.data.resources) declared.push({ table: resource.table, withhold: resource.withhold });
  }
  const entries = app?.manifest?.publicAccess ?? [];
  if (app !== undefined && entries.some((entry) => entry.withhold !== undefined)) {
    for (const record of await appTablesRepo(meta).forInstall(connectionId, app.key)) {
      for (const entry of entries) if (entry.table === record.ref && entry.withhold !== undefined) declared.push({ table: record.tableName, withhold: entry.withhold });
    }
  }
  return collectWithholds(declared);
}

/** A few seconds of what a connection declares, for the reads that ask on every request. */
const RECENT_MS = 5_000;
const recentByMeta = new WeakMap<MetaDb, Map<string, { at: number; withholds: Promise<TableWithholds> }>>();

/** {@link withholdsOn} for a read door: the connection's entries as they stood a moment ago at most. */
export function recentWithholdsOn(meta: MetaDb, connectionId: string, now = Date.now()): Promise<TableWithholds> {
  let recent = recentByMeta.get(meta);
  if (recent === undefined) recentByMeta.set(meta, (recent = new Map()));
  const hit = recent.get(connectionId);
  if (hit !== undefined && now - hit.at < RECENT_MS) return hit.withholds;
  const withholds = withholdsOn(meta, connectionId);
  recent.set(connectionId, { at: now, withholds });
  withholds.catch(() => recent.delete(connectionId));
  return withholds;
}
