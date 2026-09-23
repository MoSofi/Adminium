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
import { connectionsRepo, pagesRepo, permissionsRepo, publicApiStateRepo } from '@adminium/meta';

import { isUntouched, stamped } from '../pages/generated-stamp.js';

export interface RenameRepairInput {
  meta: MetaDb;
  connectionId: string;
  /** Qualified ids: what the table was called, and what it is called now. */
  renames: readonly { from: string; to: string }[];
  /**
   * Column renames that succeeded. `table` is the table's id AFTER any table
   * rename in the same edit — the id the planner's `rename-column` step
   * carries — which is also what the override rows say once the table half
   * above has run.
   */
  columnRenames?: readonly { table: string; from: string; to: string }[];
  crypto: Parameters<typeof connectionsRepo>[1];
}

export interface RenameRepairResult {
  includedTables: number;
  overrides: number;
  grants: number;
  pages: number;
  diagramLayout: number;
  /** Public endpoints whose `source` named the table. */
  endpoints: number;
  /** Public scope documents (hand-written or derived) with a resource on it. */
  scopes: number;
  /** An installed app's table records naming it. */
  appTables: number;
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
  /*
   * ONE TRANSACTION, as the header has always said and the code never did:
   * each rewrite below was its own statement, so a failure part way left some
   * of Adminium's references on the new name and some on the old.
   */
  return input.meta.db.transaction().execute((trx) => repairIn({ ...input, meta: { ...input.meta, db: trx } as MetaDb }));
}

async function repairIn(input: RenameRepairInput): Promise<RenameRepairResult> {
  const { meta, connectionId, renames } = input;
  const result: RenameRepairResult = {
    includedTables: 0,
    overrides: 0,
    grants: 0,
    pages: 0,
    diagramLayout: 0,
    endpoints: 0,
    scopes: 0,
    appTables: 0,
  };
  const columnRenames = input.columnRenames ?? [];
  if (renames.length === 0 && columnRenames.length === 0) return result;

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

  // --- override rows keyed by a COLUMN ---------------------------------------
  // A label, a mask, a meaning (`column.semanticType`), an answer list — each
  // row names its column. Left alone, a column rename orphans every one: the
  // Column Inspector shows the column bare, and a calendar whose date column
  // was TAGGED as its event date stops composing, because the tag no longer
  // reaches the column it describes. Runs after the table half, so a table
  // renamed in the same edit is already under its new id here.
  //
  // NOT rewritten: page bodies that name the column (a crud `columns[]`, a
  // calendar's `startColumn`, a binding's `select`). Their shapes differ per
  // template and per widget, and the review says so rather than promising it.
  for (const rename of columnRenames) {
    const updated = await meta.db
      .updateTable('adminium_schema_overrides')
      .set({ columnName: rename.to } as never)
      .where('connectionId', '=', connectionId)
      .where('tableName', '=', rename.table)
      .where('columnName', '=', rename.from)
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
    const config = page.config as ({ source?: { table?: unknown } } & Record<string, unknown>) | null;
    if (config === null) continue;
    const table = config.source?.table;
    const renamed =
      typeof table !== 'string'
        ? undefined
        : (byOldId.get(table) ?? (byOldName.has(table) ? byOldName.get(table) : undefined));
    let next: Record<string, unknown> =
      renamed === undefined ? config : { ...config, source: { ...config.source, table: renamed } };
    /*
     * A form's relation fields name their relation by id —
     * `fk:public.orders(customer_id)->public.customers(id)` — and both ends
     * carry a table id. Rewritten as text between the two delimiters an id can
     * sit in, so a table whose name merely CONTAINS the old one is untouched.
     */
    const text = JSON.stringify(next);
    let relinked = text;
    for (const [from, to] of byOldId) {
      relinked = relinked.split(`fk:${from}(`).join(`fk:${to}(`).split(`->${from}(`).join(`->${to}(`);
    }
    if (relinked !== text) next = JSON.parse(relinked) as Record<string, unknown>;
    if (next === config) continue;
    // A generated page nobody edited stays "untouched": the repair is not an edit.
    if (isUntouched(config)) next = stamped(next);
    await meta.db
      .updateTable('adminium_pages')
      .set({ config: JSON.stringify(next) } as never)
      .where('id', '=', summary.id)
      .execute();
    result.pages += 1;
  }

  // --- public endpoints and scopes ------------------------------------------
  // An endpoint's `source` and a scope resource's `table` name the table; left
  // alone, every key granted them stops answering. The endpoint's `ref` — its
  // public URL segment — is NOT changed: that is a contract with callers.
  // Rewritten as a targeted text replacement, because a definition is stored
  // (and shown back) byte for byte.
  const quoteKey = (key: string, value: string) => new RegExp(`("${key}"\\s*:\\s*)"${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  const endpoints = await meta.db
    .selectFrom('adminium_public_endpoints')
    .select(['id', 'definition'])
    .where('connectionId', '=', connectionId)
    .execute();
  for (const row of endpoints) {
    let text = row.definition;
    for (const [from, to] of [...byOldId, ...byOldName]) text = text.replace(quoteKey('source', from), `$1"${to}"`);
    if (text === row.definition) continue;
    await meta.db.updateTable('adminium_public_endpoints').set({ definition: text }).where('id', '=', row.id).execute();
    result.endpoints += 1;
  }
  const scopes = await meta.db
    .selectFrom('adminium_public_scopes')
    .select(['id', 'document'])
    .where('connectionId', '=', connectionId)
    .execute();
  for (const row of scopes) {
    const before = typeof row.document === 'string' ? row.document : JSON.stringify(row.document);
    let text = before;
    for (const [from, to] of [...byOldId, ...byOldName]) text = text.replace(quoteKey('table', from), `$1"${to}"`);
    if (text === before) continue;
    await meta.db.updateTable('adminium_public_scopes').set({ document: text } as never).where('id', '=', row.id).execute();
    result.scopes += 1;
  }
  if (result.endpoints + result.scopes > 0) await publicApiStateRepo(meta).bump();

  // --- an installed app's table record ----------------------------------------
  for (const [from, to] of byOldName) {
    const updated = await meta.db
      .updateTable('adminium_app_tables')
      .set({ tableName: to, updatedAt: Date.now() })
      .where('connectionId', '=', connectionId)
      .where('tableName', '=', from)
      .executeTakeFirst();
    result.appTables += Number(updated.numUpdatedRows ?? 0n);
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
