/**
 * Field-level PII read masking (08-server-api.md §5.3): callers without the
 * unmask permission receive masked columns as `null` plus a `_masked`
 * sibling marker so the UI renders the masked-cell treatment. Secret
 * columns (05 §7.1 rule 1) never appear at all.
 *
 * PERMISSION MAPPING NOTE: 08 §5.1 names a `table:<t>:read_pii` action and
 * 05 §7.2 a `data.unmask_pii` grant; the v1 grammar shipped in M2
 * (rbac/permissions.ts + meta's closed SYSTEM_ACTION_KEYS) has neither.
 * Until the grammar grows the action (M5 remap/roles work), unmasking is
 * granted by `system:connections:manage` — admins and super-admins see PII,
 * editors/viewers do not. Centralized here so the swap is one line.
 */

import type { FastifyRequest } from 'fastify';

import type { ResolvedTable } from './identifiers.js';

export const UNMASK_PERMISSION = 'system:connections:manage';

/** Resolve the caller's unmask capability once per request. */
export async function canReadPii(request: FastifyRequest): Promise<boolean> {
  return request.can(UNMASK_PERMISSION);
}

export type Row = Record<string, unknown>;

/** Strip secret columns and mask PII columns on one row (§5.3 rules 1–3). */
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
