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

import type { ResolvedTable } from './identifiers.js';

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
