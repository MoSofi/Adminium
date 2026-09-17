// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `config.columns[]` → validated `GridColumnSpec[]` — shared by the crud and
 * record bindings (WS-C), which render the same stored body from two routes.
 * Invalid entries are dropped with a console warning, never a crash.
 */
import { parseCrudDerived } from '@adminium/engine/config';
import {
  fkDisplayAliasOf,
  gridColumnSpecSchema,
  type CrudApi,
  type GridColumnSpec,
} from '@adminium/widgets';

/**
 * Parse `config.columns[]`, forcing `sortable:false` on every PROJECTION.
 *
 * Not a UI preference — a defence. A lookup, reverse or derived value is a
 * correlated subquery aliased into the SELECT list, and no dialect lets an
 * alias into `ORDER BY`, so `order=<alias>` is a hard 422 that blanks the
 * whole page. The config PATCH route validates nothing about `columns[]`, so
 * a hand-edited `sortable:true` would reach the wire; forcing it closed on the
 * READ path is the only place that cannot be bypassed.
 */
export function parseColumns(config: Record<string, unknown>, pageId: string): GridColumnSpec[] {
  const raw = config['columns'];
  if (!Array.isArray(raw)) return [];
  const columns: GridColumnSpec[] = [];
  for (const entry of raw) {
    const parsed = gridColumnSpecSchema.safeParse(entry);
    if (parsed.success) {
      const column = parsed.data;
      const projection =
        column.lookup !== undefined || column.reverse !== undefined || column.derived !== undefined;
      columns.push(projection && column.sortable ? { ...column, sortable: false } : column);
    } else {
      console.warn(`[adminium] ${pageId}: dropping invalid column spec`, parsed.error.issues[0]?.message);
    }
  }
  return columns;
}

/**
 * Wire `lookup=` specs (`alias:fkColumn[.fkColumn…].targetColumn`) for the
 * page's lookup columns — the server projects each referenced-table value
 * into the row under the column's own `name`, which is exactly the key the
 * cell renderers read.
 */
export function lookupParamsOf(columns: readonly GridColumnSpec[]): string[] {
  const params: string[] = [];
  for (const column of columns) {
    if (column.lookup === undefined) continue;
    params.push(`${column.name}:${[...column.lookup.path, column.lookup.select].join('.')}`);
  }
  return params;
}

/**
 * Server cap on `lookup=` params per read (apps/server/src/crud/lookups.ts
 * MAX_LOOKUPS) — mirrored because exceeding it is a hard 422, and the derived
 * FK-display lookups below must never push a request past what the page's
 * explicit lookup columns already spend.
 */
const MAX_LOOKUPS = 12;

export interface FkDisplayPlan {
  /** The page's columns, `fk.displayKey` stamped where a display value rides. */
  columns: GridColumnSpec[];
  /** Full `lookup=` param list: the explicit ones first, then the derived. */
  lookups: string[];
}

/**
 * Derive the FK-chip display lookups (30-follow-up: chips read "Drift & Fern",
 * not "5"): for every column whose `fk.display` names the referenced table's
 * display column, request `<name>__display:<name>.<display>` alongside the
 * page's explicit lookups and stamp `fk.displayKey` so FkChipCell picks the
 * joined value up. Everything degrades to the raw-id fallback, never a crash:
 *
 * - explicit lookup columns keep absolute priority — derived params only
 *   spend what the MAX_LOOKUPS budget has left, dropped in spec order beyond
 *   it (with a console note, so a 13-FK page is diagnosable);
 * - a column already covered by an explicit single-hop lookup of the same
 *   display value reuses THAT alias instead of spending budget on a twin;
 * - aliases the server would refuse (grammar, collision with a spec name) are
 *   skipped — the generation-time stamping already pre-checked the source
 *   table's real columns, this re-checks what the interpreter can see;
 * - a server-refused display value (PII without the unmask grant) arrives as
 *   `null` + `_masked`, and the chip falls back to the raw id.
 */
export function withFkDisplay(columns: readonly GridColumnSpec[]): FkDisplayPlan {
  const explicit = lookupParamsOf(columns);
  let budget = MAX_LOOKUPS - explicit.length;
  const taken = new Set(columns.map((column) => column.name));
  const derived: string[] = [];
  const dropped: string[] = [];
  const out = columns.map((column) => {
    const fk = column.fk;
    if (fk?.display === undefined || fk.displayKey !== undefined) return column;
    const covering = columns.find(
      (other) =>
        other.lookup !== undefined &&
        other.lookup.path.length === 1 &&
        other.lookup.path[0] === column.name &&
        other.lookup.select === fk.display,
    );
    if (covering !== undefined) return { ...column, fk: { ...fk, displayKey: covering.name } };
    const alias = fkDisplayAliasOf(column.name);
    if (alias === null || taken.has(alias)) return column;
    if (budget <= 0) {
      dropped.push(column.name);
      return column;
    }
    budget -= 1;
    taken.add(alias);
    derived.push(`${alias}:${column.name}.${fk.display}`);
    return { ...column, fk: { ...fk, displayKey: alias } };
  });
  if (dropped.length > 0) {
    console.warn(
      `[adminium] FK display lookups dropped for ${dropped.join(', ')} — the server cap of ${String(MAX_LOOKUPS)} lookup params is spent`,
    );
  }
  return { columns: out, lookups: [...explicit, ...derived] };
}

/**
 * Server cap on correlated subqueries per read — `agg=` and `compute=`'s
 * measures SHARE it (apps/server/src/crud/aggregates.ts MAX_AGGREGATES), so
 * the client budget has to be shared too or a page authored to one limit
 * plus a measure hard-422s.
 */
const MAX_PROJECTIONS = 12;

export interface ProjectionParams {
  /** Repeatable `agg=` specs, `alias:table.fkColumn:count`. */
  agg: string[];
  /** The single `compute=` payload, or undefined when the page has none. */
  compute: string | undefined;
}

/**
 * The projection params for one page's reads: `agg=` from its reverse-link
 * columns, `compute=` from its stored `config.derived` block.
 *
 * Three rules that each close a live foot-gun:
 *
 * 1. **Non-`count` `agg` tokens are DROPPED.** `reverse.agg` is an open string
 *    the config schema and the PATCH route both accept, but the server's wire
 *    grammar is `count` and nothing else — a stored `agg:'sum'` is a hard 422
 *    that blanks the whole page. Dropping it renders one empty column instead.
 *    Safe because the Studio never authors one: a new aggregate is a MEASURE
 *    on `compute=`, and the `reverse` vocabulary stays count-only (D15).
 * 2. **The shared budget is enforced here**, not discovered as a 422. Excess
 *    `agg` tokens are dropped in spec order; if the measures would not fit in
 *    what is left, the WHOLE compute block is dropped rather than part of it —
 *    a field referencing a dropped measure is itself a 422, so a partial send
 *    would trade one refusal for another.
 * 3. **An unreadable `derived` block degrades to none.** Same never-crash rule
 *    `parseColumns` follows for a malformed column spec.
 */
export function projectionParamsOf(
  columns: readonly GridColumnSpec[],
  config: Record<string, unknown> = {},
): ProjectionParams {
  const agg: string[] = [];
  const dropped: string[] = [];
  for (const column of columns) {
    if (column.reverse === undefined) continue;
    if (column.reverse.agg !== 'count') {
      dropped.push(`${column.name} (${column.reverse.agg})`);
      continue;
    }
    if (agg.length >= MAX_PROJECTIONS) {
      dropped.push(column.name);
      continue;
    }
    agg.push(`${column.name}:${column.reverse.table}.${column.reverse.fkColumn}:count`);
  }

  let compute: string | undefined;
  const parsed = parseCrudDerived(config['derived']);
  if (!parsed.ok) {
    console.warn(`[adminium] dropping an unreadable derived block: ${parsed.refusal.message}`);
  } else if (parsed.value.measures.length > 0 || parsed.value.fields.length > 0) {
    if (agg.length + parsed.value.measures.length > MAX_PROJECTIONS) {
      dropped.push(`derived (${String(parsed.value.measures.length)} measures)`);
    } else {
      compute = JSON.stringify(parsed.value);
    }
  }

  if (dropped.length > 0) {
    console.warn(
      `[adminium] projections dropped for ${dropped.join(', ')} — the server cap of ${String(MAX_PROJECTIONS)} correlated subqueries is shared between \`agg\` and \`compute\``,
    );
  }
  return { agg, compute };
}

/**
 * A CrudApi whose reads carry the page's projection params — lookups,
 * aggregates and the derived block. `list` and `get` decorated, everything
 * else passed through. Callers memo per (api, lookups, projections) so the
 * templates' fetch effects don't re-arm on every render.
 */
export function withLookups<T extends CrudApi>(
  api: T,
  lookups: readonly string[],
  aggs: readonly string[] = [],
  compute?: string | undefined,
): T {
  if (lookups.length === 0 && aggs.length === 0 && compute === undefined) return api;
  const read = {
    ...(lookups.length === 0 ? {} : { lookup: lookups }),
    ...(aggs.length === 0 ? {} : { agg: aggs }),
    ...(compute === undefined ? {} : { compute }),
  };
  const decorated: CrudApi = {
    ...api,
    list: (params) => api.list({ ...params, ...read }),
    get: (recordId, options) => api.get(recordId, { ...options, ...read }),
  };
  return decorated as T;
}

/** The stored `defaultSort` head, validated shallowly; null when unusable. */
export function parseDefaultSort(
  config: Record<string, unknown>,
): { column: string; dir: 'asc' | 'desc' } | null {
  const raw = config['defaultSort'];
  const head: unknown = Array.isArray(raw) ? raw[0] : null;
  if (typeof head !== 'object' || head === null) return null;
  const column = (head as { column?: unknown }).column;
  const dir = (head as { dir?: unknown }).dir;
  if (typeof column !== 'string' || column.length === 0) return null;
  return { column, dir: dir === 'asc' ? 'asc' : 'desc' };
}
