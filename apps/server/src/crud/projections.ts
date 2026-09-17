// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The three projection families of a CRUD read — `lookup=`, `agg=` and
 * `compute=` — resolved together, in alias-namespace order.
 *
 * Extracted from `routes/data` so that the export preview and the export job
 * resolve an export definition through EXACTLY the code a page read uses. A
 * parallel resolver in the job is how a permission check drifts: the
 * per-reached-table read grant, the masking of a target column, the shared
 * twelve-subquery budget and the one-namespace rule are all decided here and
 * nowhere else.
 *
 * The order is the alias namespace: lookups claim first, aggregates check
 * against them, and `compute=` checks against both — one row key can only be
 * claimed once across all four families (D26). The subquery budget is shared
 * the same way: `compute=` is told how many `agg=` already bought, so a
 * request cannot buy 24 by splitting across two params (D13).
 *
 * Refusals are RETURNED, not audited: auditing needs a request and the
 * app's audit writer, which the route has and the job does not. Every caller
 * decides what to do with the list; the route writes one `projection.denied`
 * row per entry (D16).
 */

import { resolveAggregates } from './aggregates.js';
import { parseComputeParam, singleComputeParam, type ParsedCompute } from './compute.js';
import type { ResolvedTable, SnapshotView } from './identifiers.js';
import { resolveLookups, type ResolvedLookup } from './lookups.js';
import { resolveMeasures, type MeasureRefusal, type ResolvedMeasure } from './measures.js';

export interface ResolveProjectionsOptions {
  view: SnapshotView;
  table: ResolvedTable;
  canReadPii: boolean;
  /** Per-table read check (`table:<conn>:<id>:read`) for every reached table. */
  canReadTable: (tableId: string) => Promise<boolean>;
  /** Raw `lookup=` values (`alias:fk[.fk…].target`), in request order. */
  lookup?: string | string[] | undefined;
  /** Raw `agg=` values (`alias:table.fk:count`), in request order. */
  agg?: string | string[] | undefined;
  /** The single `compute=` payload, or none. */
  compute?: string | string[] | undefined;
}

/** One degraded projection: what was refused, on which table, and why. */
export interface ProjectionRefusal {
  alias: string;
  table: string;
  reason: 'lookup' | MeasureRefusal['reason'];
}

/** Everything a read projects beyond its own columns, resolved together. */
export interface Projections {
  lookups: ResolvedLookup[];
  /** `agg=`'s counts first, then `compute=`'s measures — emission order. */
  measures: ResolvedMeasure[];
  /** Base columns a derived field reads (merged into the SELECT list, never `select=`). */
  requiredColumns: readonly string[];
  /** Derived fields, evaluated after masking. */
  fields: ParsedCompute['fields'];
  /** Per-caller refusals, for the caller's audit trail. */
  refusals: ProjectionRefusal[];
}

function listOf(raw: string | string[] | undefined): string[] {
  return raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
}

/**
 * Resolve `lookup=`, `agg=` and `compute=` for one read. Identifier errors,
 * alias collisions and over-budget requests are 422s (page-author mistakes);
 * per-caller conditions degrade to `null` + `_masked` and are listed in
 * `refusals`.
 */
export async function resolveProjections(opts: ResolveProjectionsOptions): Promise<Projections> {
  const { view, table, canReadPii, canReadTable } = opts;
  const measureRefusals: MeasureRefusal[] = [];
  const onRefusal = (refusal: MeasureRefusal): void => {
    measureRefusals.push(refusal);
  };

  const lookupRaw = listOf(opts.lookup);
  const lookups =
    lookupRaw.length === 0
      ? []
      : await resolveLookups({ view, table, raw: lookupRaw, canReadPii, canReadTable });

  const aggRaw = listOf(opts.agg);
  const aggregates =
    aggRaw.length === 0
      ? []
      : await resolveAggregates({
          view,
          table,
          raw: aggRaw,
          canReadPii,
          canReadTable,
          takenAliases: new Set(lookups.map((lookup) => lookup.alias)),
          onRefusal,
        });

  const raw = singleComputeParam(opts.compute);
  let measures = aggregates;
  let requiredColumns: readonly string[] = [];
  let fields: ParsedCompute['fields'] = [];
  if (raw !== undefined) {
    const compute = parseComputeParam(raw, {
      view,
      table,
      takenAliases: new Set([
        ...lookups.map((lookup) => lookup.alias),
        ...aggregates.map((aggregate) => aggregate.alias),
      ]),
      usedSubqueries: aggregates.length,
    });
    const resolved = await resolveMeasures({
      view,
      table,
      specs: compute.measures,
      canReadPii,
      canReadTable,
      onRefusal,
    });
    measures = [...aggregates, ...resolved];
    requiredColumns = compute.requiredColumns;
    fields = compute.fields;
  }

  const refusals: ProjectionRefusal[] = [
    ...lookups
      .filter((lookup) => lookup.refused)
      .map((lookup) => ({
        alias: lookup.alias,
        table: lookup.hops.at(-1)?.refTable.id ?? table.id,
        reason: 'lookup' as const,
      })),
    ...measureRefusals,
  ];
  return { lookups, measures, requiredColumns, fields, refusals };
}
