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
import { CUSTOMER_KEY_PURPOSE, appTablesRepo, publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { parseDefinition } from './endpoint.js';
import { collectWithholds, type TableWithholds, type WithholdRule } from './withhold.js';

/** Just what a stored scope says about its resources' withholds. */
const scopeSchema = z.object({
  resources: z
    .array(
      z
        .object({
          table: z.string(),
          withhold: z
            .object({ columns: z.array(z.string()), unlessHolder: z.string().optional(), when: z.object({}).passthrough().optional() })
            .refine((w) => w.unlessHolder !== undefined || w.when !== undefined)
            .optional(),
        })
        .passthrough(),
    )
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
    if (parsed.ok && rule !== undefined) {
      declared.push({
        table: parsed.definition.source,
        withhold: {
          columns: rule.columns,
          ...(rule.unless_holder === undefined ? {} : { unlessHolder: rule.unless_holder }),
          ...(rule.when === undefined ? {} : { when: rule.when }),
          ...(rule.key === undefined ? {} : { key: rule.key }),
        },
      });
    }
  }
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = scopeSchema.safeParse(document);
    if (parsed.success) for (const resource of parsed.data.resources) declared.push({ table: resource.table, withhold: resource.withhold as WithholdRule | undefined });
  }
  for (const { tableName, entry } of await appEntriesOn(meta, connectionId, app)) {
    if (entry.withhold !== undefined) declared.push({ table: tableName, withhold: { ...entry.withhold, ...(entry.withhold.when === undefined ? {} : { key: entry.key ?? CUSTOMER_KEY_PURPOSE }) } });
  }
  return collectWithholds(declared);
}

/**
 * The public entries apps declare on this connection's tables, with the real
 * table each is on — the one app given, or (none given) every app installed
 * on the connection, read from its manifest: a rule an app declared is kept on
 * every read of its table, whether or not its public access was taken up.
 */
export async function appEntriesOn(
  meta: MetaDb,
  connectionId: string,
  app?: { key: string; manifest: AppManifest | null } | undefined,
): Promise<{ tableName: string; entry: NonNullable<AppManifest['publicAccess']>[number] }[]> {
  const out: { tableName: string; entry: NonNullable<AppManifest['publicAccess']>[number] }[] = [];
  if (app !== undefined) {
    const entries = app.manifest?.publicAccess ?? [];
    if (entries.length === 0) return out;
    for (const record of await appTablesRepo(meta).forInstall(connectionId, app.key)) {
      for (const entry of entries) if (entry.table === record.ref) out.push({ tableName: record.tableName, entry });
    }
    return out;
  }
  const records = await appTablesRepo(meta).forConnection(connectionId);
  const ids = [...new Set(records.flatMap((record) => (record.manifestId === null ? [] : [record.manifestId])))];
  if (ids.length === 0) return out;
  const manifests = new Map<string, AppManifest>();
  for (const row of await meta.db.selectFrom('adminium_manifests').select(['id', 'manifest', 'status']).where('id', 'in', ids).execute()) {
    if (row.status !== 'installed') continue;
    try {
      const parsed = (typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest) as AppManifest;
      if (parsed?.kind === 'app') manifests.set(row.id, parsed);
    } catch {
      continue;
    }
  }
  for (const record of records) {
    const manifest = record.manifestId === null ? undefined : manifests.get(record.manifestId);
    for (const entry of manifest?.publicAccess ?? []) if (entry.table === record.ref) out.push({ tableName: record.tableName, entry });
  }
  return out;
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
