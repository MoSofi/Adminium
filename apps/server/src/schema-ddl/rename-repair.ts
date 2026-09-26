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
import { parseDatabaseModel } from '@adminium/engine';
import type { MetaDb } from '@adminium/meta';
import { connectionsRepo, overridesRepo, pagesRepo, permissionsRepo, publicApiStateRepo, snapshotsRepo } from '@adminium/meta';

import { mapTableRefs } from '../apps/real-refs.js';
import { applyOverrides, columnPolicyFor } from '../connections/effective-schema.js';
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

/**
 * The renamed columns that are secrets now and would not be by their new
 * name alone: a secret by its name, which no `column.secret` row declares.
 * Asked of the model as it stands before the rename (the latest snapshot and
 * the rows as they are); `table` is the table's id after the edit.
 */
async function undeclaredSecrets(
  meta: MetaDb,
  connectionId: string,
  columnRenames: readonly { table: string; from: string; to: string }[],
  renames: readonly { from: string; to: string }[],
): Promise<{ table: string; from: string; to: string }[]> {
  const snapshot = await snapshotsRepo(meta).latest(connectionId);
  if (snapshot === null) return [];
  // The table half has already moved the rows to a renamed table's new id; the snapshot may still name it as it was.
  const asWas = (id: string) => renames.find((r) => r.to === id)?.from ?? id;
  const rows = (await overridesRepo(meta).listForConnection(connectionId, { status: 'active' })).map((row) => ({ ...row, tableName: asWas(row.tableName) }));
  const effective = applyOverrides(parseDatabaseModel(snapshot.schema), rows);
  return columnRenames.filter((rename) => {
    const ids = [rename.table, asWas(rename.table)];
    const table = effective.tables.find((candidate) => ids.includes(candidate.id));
    if (table === undefined || !columnPolicyFor(table).secret.has(rename.from)) return false;
    // Declared either way already: the row follows the column, and says it.
    return !rows.some((row) => row.op === 'column.secret' && ids.includes(row.tableName) && row.columnName === rename.from);
  });
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
/** A formula with one column renamed; a literal an `eq` compares with is not a column, and is left alone. */
function renamedInFormula(node: unknown, from: string, to: string): unknown {
  if (typeof node === 'string') return node === from ? to : node;
  if (typeof node !== 'object' || node === null) return node;
  const [op, args] = Object.entries(node)[0] as [string, unknown];
  const again = (child: unknown) => renamedInFormula(child, from, to);
  if (op === 'eq' || op === 'neq') {
    const [column, literal] = args as [unknown, unknown];
    return { [op]: [again(column), literal] };
  }
  // `round`'s places is a number, which `again` leaves as it is.
  return { [op]: Array.isArray(args) ? args.map(again) : again(args) };
}

/**
 * A rule's value with a column of its own table renamed, or the same object
 * when it names no such column. Only the names that are this table's columns
 * are touched: a `copy`'s `from` and a `notBefore` read through a link are
 * columns of another table.
 */
export function renamedInRule(op: string, value: unknown, from: string, to: string): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const rule = value as Record<string, unknown>;
  const same = (name: unknown) => name === from;
  switch (op) {
    case 'column.requiredWhen':
      return same(rule['column']) ? { ...rule, column: to } : value;
    case 'column.copy':
      return same(rule['via']) ? { ...rule, via: to } : value;
    case 'column.bounds': {
      const before = rule['notBefore'] as Record<string, unknown> | undefined;
      if (before === undefined) return value;
      if (before['via'] !== undefined) return same(before['via']) ? { ...rule, notBefore: { ...before, via: to } } : value;
      return same(before['column']) ? { ...rule, notBefore: { ...before, column: to } } : value;
    }
    case 'column.formula': {
      const next = renamedInFormula(rule['formula'], from, to);
      return JSON.stringify(next) === JSON.stringify(rule['formula']) ? value : { ...rule, formula: next };
    }
    default:
      return value;
  }
}

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
  //
  // A SECRET STAYS ONE. A column the classifier took for a secret by its name
  // (`api_token`) is one by that name alone: renamed `reference`, nothing
  // would say so any more, and every reader of the table would see it. So a
  // secret nobody declared outright is declared now, under its new name — the
  // operator's word, which only a Super Admin takes back in Studio.
  const secretsNow = columnRenames.length === 0 ? [] : await undeclaredSecrets(meta, connectionId, columnRenames, renames);
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
  for (const rename of secretsNow) {
    await overridesRepo(meta).create({ connectionId, op: 'column.secret', tableName: rename.table, columnName: rename.to, value: { secret: true }, origin: 'user' });
    result.overrides += 1;
  }

  // --- rules that NAME a renamed column in what they say ---------------------
  // A rule on another column of the same table may read this one: the column
  // a `requiredWhen` watches, the key a `copy` follows, the date a `notBefore`
  // is held to, a formula's inputs. Left alone, the rule reads a column that
  // no longer exists — a requirement that never asks, a formula that is
  // always empty — and nothing says so.
  if (columnRenames.length > 0) {
    const overrides = overridesRepo(meta);
    for (const row of await overrides.listForConnection(connectionId)) {
      let value: unknown = row.value;
      for (const rename of columnRenames) {
        if (rename.table === row.tableName) value = renamedInRule(row.op, value, rename.from, rename.to);
      }
      if (value === row.value) continue;
      await meta.db
        .updateTable('adminium_schema_overrides')
        .set({ value: JSON.stringify(value) } as never)
        .where('id', '=', row.id)
        .execute();
      result.overrides += 1;
    }
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

  // --- an installed app's outbox ----------------------------------------------
  // Stored with its tables' real ids (`apps/manifest-outbox.ts`), at any depth:
  // the outbox table, its recipient's, a setting's row, a producer's. Left
  // alone, what reads it (the greeting on a sign-in link's page among them)
  // names a table that is not there any more.
  const outboxes = await meta.db
    .selectFrom('adminium_app_outboxes')
    .select(['id', 'definition'])
    .where('connectionId', '=', connectionId)
    .execute();
  for (const row of outboxes) {
    let definition: unknown;
    try {
      definition = JSON.parse(row.definition);
    } catch {
      continue;
    }
    const text = JSON.stringify(mapTableRefs(definition, (id) => byOldId.get(id) ?? id).value);
    if (text === JSON.stringify(definition)) continue;
    await meta.db.updateTable('adminium_app_outboxes').set({ definition: text, updatedAt: Date.now() }).where('id', '=', row.id).execute();
  }

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
