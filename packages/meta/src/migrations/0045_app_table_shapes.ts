// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wave 0045 — an installed app's table records learn the shape their table is
 * declared with.
 *
 * A table an app declares with a shape (`"shape": "menu@1"`) is one another
 * app may share, and the installer finds it by the shape its record keeps.
 * Until now an install recorded the shape only on a table it SHARED, never on
 * one it made, so no app could ever find a menu an earlier install had made.
 * The installer records it now; this wave fills it in for the installs made
 * before, from each app's stored manifest.
 *
 * Only records with no shape yet, of an app's own tables, still attached to an
 * installed manifest, are touched: a record whose app was uninstalled has no
 * manifest to read, and is recorded again with the shape when it is
 * reinstalled. A manifest that no longer parses is skipped. Running it again
 * changes nothing.
 *
 * Self-contained on purpose: its text is its checksum once released, so it
 * reads the stored manifest itself rather than through a package whose
 * behaviour may change.
 */
import type { Kysely } from 'kysely';

import { metaTable } from '../prefix.js';

interface RecordRow {
  id: string;
  ref: string;
  manifestId: string | null;
}

interface ManifestRow {
  id: string;
  kind: string;
  manifest: unknown;
}

type ShapeDb = Kysely<{
  [key: string]: {
    id: string;
    ref: string;
    manifestId: string | null;
    shape: string | null;
    role: string;
    state: string;
    kind: string;
    manifest: unknown;
  };
}>;

/** A shape as a manifest writes it: `<name>@<version>`, as the column holds (48). */
const SHAPE = /^[a-z][a-z0-9-]*@\d+$/;

/** Each declared table's shape, by its short name, from one stored manifest; empty when it does not parse. */
function shapesOf(stored: unknown): Map<string, string> {
  const out = new Map<string, string>();
  let doc: unknown = stored;
  try {
    if (typeof stored === 'string') doc = JSON.parse(stored) as unknown;
  } catch {
    return out;
  }
  if (typeof doc !== 'object' || doc === null) return out;
  const tables = (doc as { requiredSchema?: { tables?: unknown } }).requiredSchema?.tables;
  if (!Array.isArray(tables)) return out;
  for (const table of tables) {
    if (typeof table !== 'object' || table === null) continue;
    const { ref, shape } = table as { ref?: unknown; shape?: unknown };
    if (typeof ref !== 'string' || typeof shape !== 'string' || shape.length > 48 || !SHAPE.test(shape)) continue;
    out.set(ref, shape);
  }
  return out;
}

// No column-helpers parameter: this wave moves data, not shape.
export async function up(db: Kysely<unknown>): Promise<void> {
  const shapes = db as unknown as ShapeDb;
  const records = (await shapes
    .selectFrom(metaTable('app_tables'))
    .select(['id', 'ref', 'manifestId'])
    .where('shape', 'is', null)
    .where('role', '=', 'app')
    .where('manifestId', 'is not', null)
    .where('state', 'in', ['created', 'adopted', 'shared', 'pending'])
    .execute()) as RecordRow[];
  if (records.length === 0) return;

  const ids = [...new Set(records.map((record) => record.manifestId!))];
  const byManifest = new Map<string, Map<string, string>>();
  for (const id of ids) {
    const row = (await shapes
      .selectFrom(metaTable('manifests'))
      .select(['id', 'kind', 'manifest'])
      .where('id', '=', id)
      .executeTakeFirst()) as ManifestRow | undefined;
    if (row === undefined || row.kind !== 'app') continue;
    byManifest.set(id, shapesOf(row.manifest));
  }

  for (const record of records) {
    const shape = byManifest.get(record.manifestId!)?.get(record.ref);
    if (shape === undefined) continue;
    await shapes
      .updateTable(metaTable('app_tables'))
      .set({ shape } as never)
      .where('id', '=', record.id)
      .where('shape', 'is', null)
      .execute();
  }
}
