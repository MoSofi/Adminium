// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Field-level PII read masking: callers without the unmask permission
 * receive masked columns as `null` plus a `_masked` sibling marker so the
 * UI renders the masked-cell treatment. Secret columns never appear at all.
 *
 * WHO SEES PERSONAL COLUMNS, PER TABLE. `table:<connectionId>:<table>:read_pii`
 * shows one table's personal columns in clear: a clinic's reception rings
 * patients, so its role holds it on the patients table and nowhere else.
 * `system:connections:manage` still shows every table's, which is how admins
 * and Super Admin have always seen them. The question is always asked of the
 * table the value lives in: a lookup from appointments to a patient's mobile
 * needs the grant on patients, not on appointments.
 *
 * Not everything asks. Live-stream frames go out on channels shared by every
 * subscriber and stay masked for all of them (widget-data/stream-publisher.ts);
 * the public API decides for itself and never reads these grants.
 */

import type { FastifyRequest } from 'fastify';

import { SnapshotView, type ResolvedTable } from './identifiers.js';

export const UNMASK_PERMISSION = 'system:connections:manage';

/** Whether the caller sees one table's personal columns in clear. */
export async function canReadPii(request: FastifyRequest, connectionId: string, tableId: string): Promise<boolean> {
  return (await request.can(UNMASK_PERMISSION)) || request.can(`table:${connectionId}:${tableId}:read_pii`);
}

/**
 * The same question for any table a read reaches (a lookup's target, a
 * measure's child table), by the table's snapshot id.
 */
export type PiiCheck = (tableId: string) => Promise<boolean>;

/** {@link canReadPii} for every table of one connection. */
export function piiCheckFor(request: FastifyRequest, connectionId: string): PiiCheck {
  return (tableId) => canReadPii(request, connectionId, tableId);
}

/**
 * The tables among `tableIds` whose personal columns the caller sees, for a
 * job that runs later without the request (an export): the answer is taken
 * when it is asked for, as the export's own `unmasked` always has been.
 */
export async function piiTablesOf(request: FastifyRequest, connectionId: string, tableIds: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const tableId of tableIds) if (await canReadPii(request, connectionId, tableId)) out.push(tableId);
  return out;
}

/**
 * What the readers that reach other tables take: one answer for every table
 * (`true` for a system reader, `false` for a shared one such as search or the
 * assistant), or the per-table check a person's read passes.
 */
export type PiiAccess = boolean | PiiCheck;

/** Whether `access` shows the personal columns of one table. */
export async function piiAllows(access: PiiAccess, tableId: string): Promise<boolean> {
  return typeof access === 'boolean' ? access : access(tableId);
}

export type Row = Record<string, unknown>;

/** Strip secret columns and mask PII columns on one row (rules 1–3). */
export function maskRow(row: Row, table: ResolvedTable, unmasked: boolean): Row {
  const out: Row = {};
  const maskedHere: string[] = [];
  for (const [key, value] of Object.entries(row)) {
    const column = table.columns.get(key);
    if (column?.secret === true) continue; // hard-excluded, even for admins
    if (column?.masked === true && !unmasked) {
      out[key] = null;
      maskedHere.push(key);
      continue;
    }
    out[key] = value;
  }
  if (maskedHere.length > 0) out._masked = maskedHere;
  return out;
}

export function maskRows(rows: Row[], table: ResolvedTable, unmasked: boolean): Row[] {
  return rows.map((row) => maskRow(row, table, unmasked));
}

/*
 * ─── Codes in what is kept ────────────────────────────────────────────────
 *
 * A code Adminium makes (`code` rule) is the key to something: the page a
 * shared link opens, a booking a guest looks up. The staff who read its
 * table see it, but a copy kept elsewhere is read by people who may not read
 * the table — the audit log by anyone who holds `system:audit:read`, an
 * automation's trigger and log in Workflow Logs — and what the assistant
 * hands a third-party model leaves the instance. So every such copy says
 * only that a code is there, and whether a write changed it: never the code.
 */

/** What a kept copy of a row shows in place of a code. */
export const CODE_KEPT = '[code]';
/** …and in place of the code a write made new. */
export const CODE_CHANGED = '[new code]';

/** The columns of a table whose values Adminium makes as codes. */
export function codeColumnsOf(table: ResolvedTable): Set<string> {
  return new Set(table.table.columns.filter((column) => column.code !== undefined).map((column) => column.name));
}

const filled = (value: unknown) => value !== null && value !== undefined && value !== '';

/** A row as a kept copy shows it: masked as for a reader without the PII grant, and no code in it. */
export function keptRow(row: Row, table: ResolvedTable): Row {
  const out = maskRow(row, table, false);
  for (const column of codeColumnsOf(table)) {
    if (Object.hasOwn(out, column) && filled(out[column])) out[column] = CODE_KEPT;
  }
  return out;
}

/**
 * The before and after images of one write as the audit log keeps them: no
 * code in either, and a code the write changed shown changed, so the diff
 * still says a new link was made.
 */
export function keptImages(table: ResolvedTable, before: Row | null, after: Row | null): { before: Row | null; after: Row | null } {
  const kept = { before: before === null ? null : keptRow(before, table), after: after === null ? null : keptRow(after, table) };
  if (before === null || after === null || kept.after === null) return kept;
  for (const column of codeColumnsOf(table)) {
    if (kept.after[column] === CODE_KEPT && Object.hasOwn(before, column) && String(before[column] ?? '') !== String(after[column] ?? '')) {
      kept.after[column] = CODE_CHANGED;
    }
  }
  return kept;
}

/**
 * The connection as a reader that must never see a code reads it (the
 * assistant, whose answers go to a third-party model): each code column
 * masked, so a read that already gives no personal data (`canReadPii:
 * false`) returns it empty, and a filter, a search, an order or a sum over it
 * is refused, as for personal data.
 */
export function codesMaskedView(view: SnapshotView): SnapshotView {
  if (!view.model.tables.some((table) => table.columns.some((column) => column.code !== undefined))) return view;
  const model = structuredClone(view.model);
  for (const table of model.tables) {
    for (const column of table.columns) if (column.code !== undefined) column.masked = true;
  }
  return new SnapshotView(view.connectionId, model, view.optionLists);
}
