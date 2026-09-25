// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The codes shared links open rows with on one connection, wherever a link is
 * declared: an endpoint's `identity: { strategy: 'token' }` (every app's
 * public access that said `claim: { by: 'token' }` became one), a key scope's
 * token claim written by hand, and an app's own `claim: { by: 'token' }`
 * entries — even one whose public access was declined at install, since the
 * code is still the one its link is made to open with.
 *
 * A code a `code` rule makes and no link opens anything with (a booking's
 * reference, a ticket number) is not here: it is printed, read out and typed
 * back, and holds nothing back by itself.
 *
 * By table NAME, schema left off: two tables of one name in two schemas both
 * count, which errs on the side of holding a code back.
 */
import type { AppManifest } from '@adminium/manifest';
import { shareCodeColumns } from '@adminium/manifest';
import { appTablesRepo, publicEndpointsRepo, publicScopesRepo, type MetaDb } from '@adminium/meta';
import { z } from 'zod';

import { parseDefinition, shareCodesOf } from './endpoint.js';

/** Share-code columns by bare table name. */
export type ShareCodes = ReadonlyMap<string, ReadonlySet<string>>;

const bare = (table: string): string => table.slice(table.lastIndexOf('.') + 1);

/** Just what a stored scope says about a token claim; the rest of the document is not needed here. */
const tokenScopeSchema = z.object({
  claim: z.object({ strategy: z.string(), match: z.array(z.string()), ref: z.string() }).optional(),
  resources: z.array(z.object({ ref: z.string(), table: z.string() })).default([]),
});

export async function shareCodesOn(
  meta: MetaDb,
  connectionId: string,
  /** An app whose own `claim: { by: 'token' }` entries count too, by the tables its install made or took. */
  app?: { key: string; manifest: AppManifest | null } | undefined,
): Promise<ShareCodes> {
  const out = new Map<string, Set<string>>();
  const add = (table: string, column: string): void => {
    const set = out.get(bare(table)) ?? new Set<string>();
    set.add(column);
    out.set(bare(table), set);
  };
  const endpoints = (await publicEndpointsRepo(meta).listByConnection(connectionId)).flatMap((row) => {
    const parsed = parseDefinition(row.definition);
    return parsed.ok ? [parsed.definition] : [];
  });
  for (const [table, columns] of shareCodesOf(endpoints)) for (const column of columns) add(table, column);
  for (const scope of await publicScopesRepo(meta).listByConnection(connectionId)) {
    let document: unknown;
    try {
      document = typeof scope.document === 'string' ? JSON.parse(scope.document) : scope.document;
    } catch {
      continue;
    }
    const parsed = tokenScopeSchema.safeParse(document);
    if (!parsed.success) continue;
    const claim = parsed.data.claim;
    if (claim === undefined || claim.strategy !== 'token') continue;
    const target = parsed.data.resources.find((resource) => resource.ref === claim.ref);
    if (target !== undefined) for (const column of claim.match) add(target.table, column);
  }
  const entries = app?.manifest?.publicAccess ?? [];
  if (app !== undefined && entries.length > 0) {
    for (const record of await appTablesRepo(meta).forInstall(connectionId, app.key)) {
      for (const column of shareCodeColumns(entries, record.ref)) add(record.tableName, column);
    }
  }
  return out;
}
