// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Template-fit client: what a template needs from a table, and the writes that
 * record what the operator's columns MEAN.
 *
 * Shapes mirror the server Zod reply in `apps/server/src/routes/pages/schema.ts`
 * (`pageFitReply`) — the copied-mirror convention this folder already follows.
 *
 * NONE OF THIS IS A NEW WRITE PATH. `column.semanticType` and `column.options`
 * are the same overrides the Studio Column Inspector has always staged, saved
 * through the same full-document PUT, built by the same `buildPutDocument`.
 * That matters for one specific reason: `PUT /connections/:id/overrides`
 * REPLACES the connection's entire override set. Sending a document containing
 * only the new rows would silently delete every label, mask and rule the
 * operator has ever written. So the baseline is read first and the new rows are
 * staged onto it, exactly as the remap editor does.
 */

import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { api } from '../../app/api.js';
import { putOverrides, type OverridesReply } from '../remap/api.js';
import { baselineFromRows, buildPutDocument, stageEntry } from '../remap/overrides.js';

/** Mirrors the engine's `FitRole`. */
export type FitRole = 'event-date' | 'title' | 'status-workflow' | 'person-fk' | 'shift-type';

export interface FitRequirementDto {
  role: string;
  satisfiedBy: string | null;
  taggable: { column: string; logicalType: string }[];
  wants: {
    logicalTypes: string[];
    semantic: string;
    /** Names the classifier tags unaided, best first — the first FREE one wins. */
    suggestedNames: string[];
    maxLength?: number;
    enumValues?: string[];
    /** A foreign key: it cannot be added without choosing a target table. */
    needsReference?: true;
  };
  optional: boolean;
}

export interface FittingTableDto {
  tableId: string;
  label: string | null;
  score: number;
  reasons: string[];
  roles: { role: string; column: string | null }[];
}

/**
 * Remedy 2 — a table one FK hop away that can carry the page, titled through
 * the key. Mirrors the engine's `RelatedTable`.
 */
export interface RelatedTableDto {
  /** The table the page would be bound to. */
  tableId: string;
  label: string | null;
  /** Its FK column pointing at the picked table — sent as `titleThrough`. */
  via: string;
  /** The picked table's column each row would be titled with. */
  titleColumn: string;
  dateColumn: string | null;
}

export interface TemplateFitDto {
  template: string;
  tableId: string;
  bindable: boolean;
  satisfied: boolean;
  unfilled: { slot: string; accepts: { widgets: string[]; shapes: string[] } }[];
  requirements: FitRequirementDto[];
  reason: string;
  /** Present only when `alternatives=true` was asked for. */
  alternatives?: FittingTableDto[];
  /** Present only when `alternatives=true` was asked for. */
  related?: RelatedTableDto[];
}

function fitPath(input: {
  connectionId: string;
  table: string;
  template: string;
  alternatives?: boolean;
}): string {
  const query = new URLSearchParams({
    connectionId: input.connectionId,
    table: input.table,
    template: input.template,
    ...(input.alternatives === true ? { alternatives: 'true' } : {}),
  });
  return `/api/v1/pages/fit?${query.toString()}`;
}

export function templateFitQuery(input: {
  connectionId: string;
  table: string;
  template: string;
}) {
  return queryOptions({
    queryKey: ['studio', 'pages', 'fit', input.connectionId, input.table, input.template] as const,
    queryFn: async () => (await api.get<{ data: TemplateFitDto }>(fitPath(input))).data,
    retry: false,
  });
}

/**
 * Remedy 0's list, as a SEPARATE query enabled only once the fit is known to
 * have failed.
 *
 * Folding it into the call above would rank every table of the connection on
 * every table the operator clicks through, including the ones that already fit
 * — work whose answer is never shown. The extra round trip lands exactly where
 * the operator has been stopped and is reading, which is the one moment it is
 * worth its own request.
 */
export function fittingTablesQuery(input: {
  connectionId: string;
  table: string;
  template: string;
  enabled: boolean;
}) {
  return queryOptions({
    queryKey: [
      'studio',
      'pages',
      'fit-alternatives',
      input.connectionId,
      input.table,
      input.template,
    ] as const,
    // Remedies 0 and 2 ride the same reply: both answer "which OTHER table
    // could carry this page", and both are only worth asking once it cannot.
    queryFn: async () => {
      const data = (await api.get<{ data: TemplateFitDto }>(fitPath({ ...input, alternatives: true })))
        .data;
      return { alternatives: data.alternatives ?? [], related: data.related ?? [] };
    },
    enabled: input.enabled,
    retry: false,
  });
}

/** Mirrors the engine's `TableDraft` (`packages/engine/src/generate/fit-draft.ts`). */
export interface DraftColumnDto {
  name: string;
  logicalType: string;
  maxLength: number | null;
  primaryKey: boolean;
  semantic: string | null;
  enumValues: string[] | null;
  /** `table` is a table id, or the NAME of another table in the same draft. */
  references: { table: string; column: string } | null;
  role: string | null;
}

export interface TableDraftDto {
  template: string;
  schema: string;
  /** Dependency order: a people table the draft creates comes first. */
  tables: { name: string; columns: DraftColumnDto[] }[];
  bindTableId: string;
  nameProblem: 'invalid' | 'taken' | null;
  composes: boolean;
  peopleTargets: { tableId: string; label: string | null }[];
  peopleTarget: string | null;
}

/**
 * Remedy 4's draft: a new table shaped for `template`, with the engine's
 * verdict on the operator's name. `null` data means the template has no repair
 * descriptors — the caller offers nothing rather than a table that would not
 * back the page.
 *
 * Keyed on the name, so every settled keystroke is its own cached answer and
 * going back to an earlier name costs nothing.
 */
export function newTableDraftQuery(input: {
  connectionId: string;
  template: string;
  name: string | null;
  people: string | null;
  enabled: boolean;
}) {
  return queryOptions({
    queryKey: [
      'studio',
      'pages',
      'fit-new-table',
      input.connectionId,
      input.template,
      input.name,
      input.people,
    ] as const,
    queryFn: async () => {
      const query = new URLSearchParams({
        connectionId: input.connectionId,
        template: input.template,
        ...(input.name === null ? {} : { name: input.name }),
        ...(input.people === null ? {} : { people: input.people }),
      });
      return (
        await api.get<{ data: { draft: TableDraftDto | null } }>(
          `/api/v1/pages/fit/new-table?${query.toString()}`,
        )
      ).data.draft;
    },
    enabled: input.enabled,
    retry: false,
    // A name already answered does not need asking again while typing.
    placeholderData: (previous) => previous,
  });
}

/**
 * Remedy 1 — record that a column the operator already has means what the
 * template needs it to mean.
 *
 * No DDL, no hazard, no row touched: one override row, reversible from the
 * Column Inspector. It is offered above everything that writes to the
 * operator's database for exactly that reason.
 */
export async function tagColumnSemantic(input: {
  connectionId: string;
  table: string;
  column: string;
  semanticType: string;
}): Promise<void> {
  await writeRepairOverrides({
    connectionId: input.connectionId,
    table: input.table,
    columns: [{ column: input.column, semanticType: input.semanticType }],
  });
}

/**
 * Record what one or more columns MEAN, in a single full-document PUT.
 *
 * Two ops per column, and the second is not decoration. A calendar's
 * `event_date` earns its semantic from its NAME, so its override is insurance
 * against a later rename. A board's `status` does not: `r07-status-workflow`
 * reaches into the enum's VALUES, and `addColumns` cannot carry them
 * (`AddColumn` holds a `DesiredColumn`; only `DesiredTable` has an
 * `enumValues` map), so `column.options` is the ONLY channel a repair has for
 * the values the rule requires.
 *
 * One PUT for all of them, because the endpoint REPLACES the connection's
 * whole override set: two sequential writes would each be built from a baseline
 * the other had already moved, and the second would drop the first.
 */
export async function writeRepairOverrides(input: {
  connectionId: string;
  table: string;
  /**
   * `semanticType` absent ⇒ no meaning is claimed, only the answer list — what
   * an app update's enum column needs: the installer's own CHECK would have let
   * the classifier read the values, and nothing more is known about them.
   */
  columns: readonly { column: string; semanticType?: string; values?: readonly string[] }[];
}): Promise<void> {
  const current = await api.get<OverridesReply>(
    `/api/v1/connections/${encodeURIComponent(input.connectionId)}/overrides`,
  );
  const baseline = baselineFromRows(current.overrides);
  let overlay: ReturnType<typeof stageEntry> = new Map();
  for (const entry of input.columns) {
    if (entry.semanticType !== undefined) {
      overlay = stageEntry(baseline, overlay, {
        item: {
          op: 'column.semanticType',
          tableName: input.table,
          columnName: entry.column,
          value: { semanticType: entry.semanticType },
        },
      });
    }
    if (entry.values === undefined) continue;
    overlay = stageEntry(baseline, overlay, {
      item: {
        op: 'column.options',
        tableName: input.table,
        columnName: entry.column,
        value: { values: entry.values.map((value) => ({ value })) },
      },
    });
  }
  await putOverrides(input.connectionId, buildPutDocument(baseline, overlay));
}

/**
 * Everything derived from this connection's overrides.
 *
 * The schema queries are in the list because a semantic is part of what the
 * schema browser and the remap editor show; the fit queries are in it because
 * the whole point of the tag was to change the answer they hold. Leaving either
 * out shows the operator a panel that still asks for what they just did.
 */
export async function invalidateAfterTag(
  client: QueryClient,
  connectionId: string,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['studio', 'pages', 'fit'] }),
    client.invalidateQueries({ queryKey: ['studio', 'pages', 'fit-alternatives'] }),
    client.invalidateQueries({ queryKey: ['studio', 'pages', 'fit-new-table'] }),
    client.invalidateQueries({ queryKey: ['studio', 'schema', connectionId] }),
    client.invalidateQueries({ queryKey: ['studio', 'remap', 'schema', connectionId] }),
    client.invalidateQueries({ queryKey: ['studio', 'remap', 'overrides', connectionId] }),
  ]);
}
