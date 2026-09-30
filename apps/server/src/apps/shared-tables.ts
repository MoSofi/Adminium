// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's tables another app installed on the same database uses too (a
 * menu the till and the online shop share), for the staff screens' config:
 * a kitchen's menu shared with the till says so ("switching a dish off hides
 * it there too").
 */
import { appTablesRepo, type MetaDb } from '@adminium/meta';

/** By the app's own name for each table, the other apps' keys; null when none is shared. */
export async function sharedTablesOf(meta: MetaDb, connectionId: string, appKey: string, tables: Readonly<Record<string, string>>): Promise<Record<string, string[]> | null> {
  const live = (state: string) => state === 'created' || state === 'adopted' || state === 'shared';
  const others = (await appTablesRepo(meta).forConnection(connectionId)).filter((r) => r.appKey !== appKey && r.role === 'app' && live(r.state));
  const out: Record<string, string[]> = {};
  for (const [ref, real] of Object.entries(tables)) {
    const keys = [...new Set(others.filter((r) => r.tableName === real).map((r) => r.appKey))].sort();
    if (keys.length > 0) out[ref] = keys;
  }
  return Object.keys(out).length === 0 ? null : out;
}
