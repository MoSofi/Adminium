// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A REMOVAL TAKES AND KEEPS, AND WHAT RECORD HISTORY NEVER SHOWS.
 *
 * ─── A removal's reason (`table.removal.reason`) ───────────────────────────
 * A table that asks for one takes a reason on every door a person removes a
 * row through: the delete route, a bulk delete, the add-on kit's `remove`
 * (which calls the delete route). `"required"` refuses a removal without one.
 * The reason is written into the removal's audit entry (`changes.reason`);
 * every other removal of such a table (an undo, a row taken off under its
 * parent's save, a rule's or a move's delete, a public door's) is written
 * with `reason: null`, "no reason". A table that asks for none refuses one:
 * a reason sent where nothing keeps it would be a sentence nobody reads.
 *
 * ─── A removed row's history (`table.removal.history`) ─────────────────────
 * Every removal of such a table, by whichever door, keeps the row under each
 * row it linked to (`adminium_removed_rows`): when, by whom, why, and the row
 * as it was, masked as the audit log keeps it (no personal data, no code).
 * It is read only through a row it linked to that the reader reads NOW, and
 * only by a reader the table's own grants let read it — row limits judged on
 * the row as it was — with the columns their role does not read left out, as
 * a live read leaves them out. Never for a private table. An undo that brings
 * the row back takes it off the list.
 *
 * ─── A column's earlier values (`column.history: "audit"`) ─────────────────
 * Such a column's earlier values are the audit log's alone (its page is the
 * install's owner's): record history, a removed row's history, a rule's
 * `{{was.<column>}}` and the row a delete's live frame carries leave them
 * out. The value a row holds now is read as any other column is.
 */
import type { FastifyRequest } from 'fastify';
import { REMOVAL_REASON_MAX } from '@adminium/manifest';
import { removedRowsRepo, type ActorKind, type MetaDb, type RemovedRow, type RemovedRowLink } from '@adminium/meta';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { ValidationFailedError } from '../errors.js';
import { getPrincipal } from '../rbac/principal.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { keptCodeColumnsOf, keptRow, type Row } from './mask.js';
import { pkLabel } from './records.js';
import { rowLimitFor, type RowLimitContext } from './row-limit.js';

type TableLike = Pick<ResolvedTable, 'id' | 'table'>;

/** Who removed a row, as the audit log names who wrote an entry. */
export interface RemovalActor {
  kind: ActorKind;
  id: string | null;
  label: string;
}

/** The person (or key) a request is, as `rbac.audit` names them. */
export function actorOfRequest(request: FastifyRequest | null | undefined): RemovalActor {
  const principal = request === null || request === undefined ? null : getPrincipal(request);
  return principal === null ? { kind: 'system', id: null, label: 'Adminium' } : { kind: principal.kind, id: principal.id, label: principal.label };
}

// ─── column.history ─────────────────────────────────────────────────────────

/** The columns of a table whose earlier values only the audit log keeps. */
export function auditOnlyColumnsOf(table: TableLike | undefined | null): ReadonlySet<string> {
  const columns = table?.table?.columns ?? [];
  return new Set(columns.filter((column) => column.history === 'audit').map((column) => column.name));
}

/** The masked-column marker names columns too: only the ones still shown, and no marker for none. */
function markedOnly(image: Row, shown: (name: string) => boolean): void {
  if (!Array.isArray(image['_masked'])) return;
  const kept = (image['_masked'] as unknown[]).filter((name) => typeof name !== 'string' || shown(name));
  if (kept.length === 0) delete image['_masked'];
  else image['_masked'] = kept;
}

/** A row image without the columns whose earlier values only the audit log keeps; the same image when there are none. */
export function withoutEarlierValues<T extends Row | null | undefined>(table: TableLike | undefined | null, image: T): T {
  if (image === null || image === undefined) return image;
  const hidden = auditOnlyColumnsOf(table);
  if (hidden.size === 0) return image;
  const out: Row = {};
  for (const [key, value] of Object.entries(image)) {
    if (hidden.has(key)) continue;
    out[key] = value;
  }
  // The masked-column marker names a column too.
  markedOnly(out, (name) => !hidden.has(name));
  return out as T;
}

// ─── table.removal.reason ───────────────────────────────────────────────────

/** Whether a table asks for a removal's reason (and so writes "no reason" when a door has none). */
export function takesReason(table: TableLike): boolean {
  return table.table?.removal?.reason !== undefined;
}

/**
 * The reason a person's removal carries, trimmed; null for none. Refused (422)
 * where the table asks for none, where it requires one and none is given,
 * and past {@link REMOVAL_REASON_MAX} characters.
 */
export function personReason(table: TableLike, given: string | null | undefined): string | null {
  const reason = typeof given === 'string' ? given.trim() : '';
  const rule = table.table?.removal?.reason;
  if (rule === undefined) {
    if (reason !== '') throw new ValidationFailedError('This table takes no reason for a removal.', { fields: { reason: { code: 'not-allowed' } } });
    return null;
  }
  if (reason === '') {
    if (rule === 'required') throw new ValidationFailedError('Say why the row is removed.', { fields: { reason: { code: 'required' } } });
    return null;
  }
  if ([...reason].length > REMOVAL_REASON_MAX) throw new ValidationFailedError(`A reason is at most ${String(REMOVAL_REASON_MAX)} characters.`, { fields: { reason: { code: 'too-long', max: REMOVAL_REASON_MAX } } });
  return reason;
}

/** What a removal's audit entry carries of its reason: the reason, `null` for none, nothing for a table that asks for none. */
export function reasonEntry(table: TableLike, reason: string | null | undefined): { reason?: string | null } {
  return takesReason(table) ? { reason: reason ?? null } : {};
}

// ─── table.removal.history: keeping ─────────────────────────────────────────

/** Whether a table keeps its removed rows: asked for, and never a private table. */
export function keepsRemoved(table: TableLike | undefined | null): boolean {
  return table?.table?.removal?.history === true && table.table.private !== true;
}

const filled = (value: unknown): boolean => value !== null && value !== undefined && value !== '';

/** The single-column links of a table, each with the table it points at and the column of it it names. */
function linksOf(view: Pick<SnapshotView, 'model'>, tableId: string): { via: string; parentTable: string; parentColumn: string }[] {
  const out: { via: string; parentTable: string; parentColumn: string }[] = [];
  const seen = new Set<string>();
  for (const relation of view.model.relations) {
    if (relation.through !== null || relation.from.tableId !== tableId || relation.from.columns.length !== 1 || relation.to.columns.length !== 1) continue;
    const key = `${relation.from.columns[0]!}|${relation.to.tableId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ via: relation.from.columns[0]!, parentTable: relation.to.tableId, parentColumn: relation.to.columns[0]! });
  }
  return out;
}

export interface RemovedInput {
  connectionId: string;
  table: ResolvedTable;
  /** Each row as it was, with its key. */
  rows: readonly { pk: Row; before: Row | null }[];
  reason: string | null;
  actor: RemovalActor;
  at?: number | undefined;
  /** The connection's view, when the caller has it; read from the store otherwise. */
  view?: Pick<SnapshotView, 'model'> | undefined;
}

/**
 * Keep removed rows of a table that keeps them, under each row they linked
 * to. Nothing for any other table. Never throws: the removal is done, and a
 * list that could not be written is not the removal's failure (it is logged
 * by the caller's `warn`).
 */
export async function keepRemoved(meta: MetaDb, input: RemovedInput, warn?: (error: unknown) => void): Promise<void> {
  if (!keepsRemoved(input.table)) return;
  const rows = input.rows.filter((row): row is { pk: Row; before: Row } => row.before !== null);
  if (rows.length === 0) return;
  try {
    const view = input.view ?? (await loadSnapshotView(meta, input.connectionId));
    const links = linksOf(view, input.table.id);
    const repo = removedRowsRepo(meta);
    const at = input.at ?? Date.now();
    for (const { pk, before } of rows) {
      const named: RemovedRowLink[] = links.filter((link) => filled(before[link.via])).map((link) => ({ via: link.via, parentTable: link.parentTable, parentValue: String(before[link.via]) }));
      await repo.add({
        connectionId: input.connectionId,
        entityTable: input.table.id,
        entityId: pkLabel(input.table, pk),
        pk,
        links: named,
        removedAt: at,
        actorKind: input.actor.kind,
        actorId: input.actor.id,
        actorLabel: input.actor.label,
        reason: input.reason,
        image: withoutEarlierValues(input.table, keptRow(before, input.table)),
      });
    }
  } catch (error) {
    warn?.(error);
  }
}

/** Rows an undo brought back: off the list, under every row they linked to. */
export async function forgetRemoved(meta: MetaDb, connectionId: string, table: ResolvedTable, pks: readonly Row[]): Promise<void> {
  if (table.table?.removal?.history !== true || pks.length === 0) return;
  await removedRowsRepo(meta).forget(connectionId, table.id, pks.map((pk) => pkLabel(table, pk)));
}

// ─── table.removal.history: reading ─────────────────────────────────────────

/** The pairs (link column of the child, the parent's value) that name one parent row: the links a removed child is kept under. */
export function linksNaming(view: Pick<SnapshotView, 'model'>, child: TableLike, parent: TableLike, parentRow: Row): { via: string; parentValue: string }[] {
  return linksOf(view, child.id)
    .filter((link) => link.parentTable === parent.id && filled(parentRow[link.parentColumn]))
    .map((link) => ({ via: link.via, parentValue: String(parentRow[link.parentColumn]) }));
}

/**
 * Whether a person's read of a table reaches a row as it was, judged by the
 * row limit their read is held to — the same test a live read carries,
 * asked of the row as it was rather than of a stored one. True where nothing
 * limits them. A row the test cannot be asked of answers false: it errs on
 * showing less.
 */
export async function reachesRemoved(rows: RowLimitContext | null, db: Kysely<SourceDatabase>, table: ResolvedTable, image: Row): Promise<boolean> {
  if (rows === null) return true;
  const test = rowLimitFor(rows, table.id, 'read');
  if (test === null) return true;
  const dialect = rows.model.dialect;
  const codes = keptCodeColumnsOf(table);
  const columns = table.table.columns.map((column) => column.name);
  const value = (name: string): unknown => {
    const held = image[name];
    // A code is kept as a mark, never as itself: it is nothing to judge by.
    if (held === undefined || held === null || codes.has(name)) return null;
    if (typeof held === 'boolean') return dialect === 'postgres' ? held : held ? 1 : 0;
    if (typeof held === 'object') return JSON.stringify(held);
    return held;
  };
  /*
   * The row as it was, as a table of one row with the table's own columns:
   * a select of none of its rows, joined by one of the values, takes each
   * column's own kind (so a value compares with the column it was read
   * from, on every engine), and the test reads it by the alias a live read
   * gives the table.
   */
  const alias = 'adm_removed';
  const named = sql.join(columns.map((name) => sql.ref(name)));
  const given = sql.join(columns.map((name) => sql`${value(name)}`));
  const one = sql`(select ${named} from ${sql.table(table.id)} where 1 = 0 union all select ${given})`;
  try {
    const found = await sql<{ one: number }>`select 1 as one from ${one} as ${sql.id(alias)} where ${test(db, alias)}`.execute(db);
    return found.rows.length > 0;
  } catch {
    return false;
  }
}

/** What a removed row shows a reader: their view of the table's columns, without the earlier values only the audit log keeps. */
export function shownRemoved(readView: SnapshotView, table: ResolvedTable, image: Row): Row {
  const cut = withoutEarlierValues(table, image);
  if (!readView.readLimited) return cut;
  const limited = readView.linkTable(table.id);
  if (limited === null) return cut;
  const out: Row = {};
  for (const [key, held] of Object.entries(cut)) {
    if (limited.columns.get(key)?.unreadable === true) continue;
    out[key] = held;
  }
  markedOnly(out, (name) => limited.columns.get(name)?.unreadable !== true);
  return out;
}

export type { RemovedRow };
