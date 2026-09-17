// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rename repair.
 *
 * ─── Why a rename needs a second act ───────────────────────────────────────
 *
 * The DDL statement renames the table in the customer's database. Everything
 * Adminium stores that NAMES that table still says the old thing: the page
 * envelope's `source.table`, the override rows, the `table:<conn>:<name>:*`
 * grant strings, `settings.includedTables`, the diagram layout's keys. None
 * of them errors. The page simply stops resolving, the grant stops matching,
 * and the table quietly disappears from the app the rename was supposed to
 * improve.
 *
 * So this runs in ONE meta-store transaction after the DDL succeeds. It is
 * deliberately not part of the apply's step list: those steps touch the
 * customer's database and are re-runnable; this touches Adminium's own store
 * and is transactional, and mixing the two would give one operation two
 * failure models.
 *
 * ─── What is deliberately NOT repaired, and why it is said out loud ────────
 *
 * D33 draws the line at "a record of what happened":
 *
 *   • **audit `entity_table`** — a denormalised, indexed column recording the
 *     table a past write touched. Rewriting it would falsify history: the row
 *     says what the table was called when the edit happened, and that is the
 *     point of an audit log.
 *   • **import history** — same reason.
 *   • **notification and file `RecordRef`s** — soft references into rows that
 *     may no longer exist; a rewrite would be a guess.
 *   • **saved-view FILTERS** — opaque JSON naming columns. A column rename
 *     leaves a filter pointing at a dead name, and there is no schema for the
 *     document that would let this rewrite it safely.
 *
 * Every one of those is reported to the operator in the confirm dialog
 * (`not-repaired` consequence) rather than silently left.
 */
import type { MetaDb } from '@adminium/meta';
import { connectionsRepo, pagesRepo, permissionsRepo } from '@adminium/meta';

export interface RenameRepairInput {
  meta: MetaDb;
  connectionId: string;
  /** Qualified ids: what the table was called, and what it is called now. */
  renames: readonly { from: string; to: string }[];
  crypto: Parameters<typeof connectionsRepo>[1];
}

export interface RenameRepairResult {
  includedTables: number;
  overrides: number;
  grants: number;
  pages: number;
  diagramLayout: number;
}

/** The bare table name a grant string and `includedTables` use. */
const bare = (id: string): string => id.slice(id.lastIndexOf('.') + 1);

/**
 * Rewrite Adminium's own references after a successful rename.
 *
 * Returns what it touched, so the apply summary can say so — an operator who
 * renames a table should be told their pages and grants followed, not left to
 * discover it.
 */
export async function repairAfterRename(input: RenameRepairInput): Promise<RenameRepairResult> {
  const { meta, connectionId, renames } = input;
  const result: RenameRepairResult = {
    includedTables: 0,
    overrides: 0,
    grants: 0,
    pages: 0,
    diagramLayout: 0,
  };
  if (renames.length === 0) return result;

  const byOldId = new Map(renames.map((r) => [r.from, r.to]));
  const byOldName = new Map(renames.map((r) => [bare(r.from), bare(r.to)]));

  const connections = connectionsRepo(meta, input.crypto);
  const connection = await connections.findById(connectionId);
  if (connection === null) return result;

  // --- settings.includedTables ---------------------------------------------
  const included = connection.settings.includedTables;
  if (included !== undefined && included.length > 0) {
    const next = included.map((entry) => byOldId.get(entry) ?? entry);
    const changed = next.some((value, i) => value !== included[i]);
    if (changed) {
      await connections.update(connectionId, {
        settings: { ...connection.settings, includedTables: next },
      });
      result.includedTables = next.filter((value, i) => value !== included[i]).length;
    }
  }

  // --- the diagram layout's keys (D21) --------------------------------------
  const layout = connection.diagramLayout;
  if (layout !== null && typeof layout === 'object') {
    const positions = layout as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let moved = 0;
    for (const [key, value] of Object.entries(positions)) {
      const renamed = byOldId.get(key);
      if (renamed === undefined) next[key] = value;
      else {
        next[renamed] = value;
        moved += 1;
      }
    }
    if (moved > 0) {
      await connections.setDiagramLayout(
        connectionId,
        next as Record<string, { x: number; y: number }>,
      );
      result.diagramLayout = moved;
    }
  }

  // --- override rows --------------------------------------------------------
  // `table_name` on `adminium_schema_overrides` is the qualified id the remap
  // editor wrote; a rename leaves every label, mask and virtual relation on the
  // table orphaned, which is the most visible loss of the set.
  for (const [from, to] of byOldId) {
    const updated = await meta.db
      .updateTable('adminium_schema_overrides')
      .set({ tableName: to } as never)
      .where('connectionId', '=', connectionId)
      .where('tableName', '=', from)
      .executeTakeFirst();
    result.overrides += Number(updated.numUpdatedRows ?? 0n);
  }

  // --- page bindings --------------------------------------------------------
  // The envelope's `source.table`. Pages are stored as opaque JSON documents,
  // so this reads, rewrites and writes back rather than patching in SQL —
  // the same discipline `mergeEnvelopeMeta` follows.
  const pages = pagesRepo(meta);
  const all = await pages.listAll();
  for (const summary of all) {
    if (summary.connectionId !== connectionId) continue;
    const page = await pages.findById(summary.id);
    if (page === null) continue;
    const config = page.config as { source?: { table?: unknown } } | null;
    const table = config?.source?.table;
    if (typeof table !== 'string') continue;
    const renamed = byOldId.get(table) ?? (byOldName.has(table) ? byOldName.get(table) : undefined);
    if (renamed === undefined) continue;
    await meta.db
      .updateTable('adminium_pages')
      .set({
        config: JSON.stringify({ ...config, source: { ...config?.source, table: renamed } }),
      } as never)
      .where('id', '=', summary.id)
      .execute();
    result.pages += 1;
  }

  // --- grant strings --------------------------------------------------------
  // `table:<connectionId>/<table>` is the stored `resource_ref`; a rename makes
  // every grant on it match nothing, which reads to an operator as "my role
  // lost access" with no cause they can see.
  const permissions = permissionsRepo(meta);
  for (const [from, to] of byOldName) {
    const rows = await permissions.listForResource('table', `${connectionId}/${from}`);
    for (const row of rows) {
      await meta.db
        .updateTable('adminium_role_permissions')
        .set({ resourceRef: `${connectionId}/${to}` } as never)
        .where('id', '=', row.id)
        .execute();
      result.grants += 1;
    }
  }

  return result;
}
