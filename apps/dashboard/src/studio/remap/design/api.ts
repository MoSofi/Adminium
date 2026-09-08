// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design-mode API client — 35-schema-authoring.md §3.5.
 *
 *   POST /connections/:id/schema/plan   → the plan and its SQL (runs nothing)
 *   POST /connections/:id/schema/apply  → run it
 *   POST /connections/:id/schema/adopt  → include new tables and regenerate (D11)
 *   GET  /connections/:id/schema/changes → the ledger
 *
 * `plan` is safe to call on every keystroke-settled edit: it executes no
 * statement against the customer's database. That is what makes a live review
 * pane honest rather than a mock — the SQL on screen is compiled by the same
 * function that will run it (D2).
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../../app/api.js';
import type { AdoptResult, ApplyResult, SchemaEdit, SchemaPlan } from './types.js';

const base = (connectionId: string): string =>
  `/api/v1/connections/${encodeURIComponent(connectionId)}`;

/**
 * `acknowledgeCeiling` names the tables the operator authorised past D18's row
 * ceiling, and the PLAN takes it as well as the apply.
 *
 * Both, deliberately. The plan an operator authorises has to be the plan that
 * runs (D2), and a refused step compiles to no SQL — so a door opened only at
 * apply produced a different plan, and the checksum compare rejected it with
 * SCHEMA_DRIFT before the door was ever consulted. So the flow is two round
 * trips: plan (refused, showing what to type) → plan again WITH the
 * acknowledgement (open, with the checksum that will be applied) → apply.
 */
export function planSchemaEdit(
  connectionId: string,
  edit: SchemaEdit,
  acknowledgeCeiling: readonly string[] = [],
): Promise<SchemaPlan> {
  return api.post<SchemaPlan>(`${base(connectionId)}/schema/plan`, {
    ...edit,
    acknowledgeCeiling,
  });
}

export function applySchemaEdit(
  connectionId: string,
  edit: SchemaEdit,
  checksum: string,
  acknowledgeRows: boolean,
  acknowledgeCeiling: readonly string[] = [],
): Promise<ApplyResult> {
  return api.post<ApplyResult>(`${base(connectionId)}/schema/apply`, {
    ...edit,
    checksum,
    acknowledgeRows,
    acknowledgeCeiling,
  });
}

/**
 * D11's last beat: put the tables this apply created into the app.
 *
 * Behind `connections.manage`, not the DDL grant — it regenerates pages. A
 * caller without it gets a 403 the caller is expected to render as a sentence,
 * not as a broken button (D12: new tables receive no grants automatically).
 */
export function adoptTables(connectionId: string, tables: readonly string[]): Promise<AdoptResult> {
  return api.post<AdoptResult>(`${base(connectionId)}/schema/adopt`, { tables });
}

export interface SchemaChangeRow {
  id: string;
  planChecksum: string;
  status: string;
  hazard: string;
  error: string | null;
  createdBy: string | null;
  startedAt: number;
  finishedAt: number | null;
  stepCount: number;
  succeeded: number;
}

export function schemaChangesQuery(connectionId: string) {
  return queryOptions({
    queryKey: ['studio', 'design', 'changes', connectionId] as const,
    queryFn: () => api.get<{ changes: SchemaChangeRow[] }>(`${base(connectionId)}/schema/changes`),
  });
}
