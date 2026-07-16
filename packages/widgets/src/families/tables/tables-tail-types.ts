/**
 * Data-contract shapes for the `tables` family M7 Wave-4 TAIL slice (annex §3):
 * sparkline-table, top-movers-list, ranked-entity-list, accordion-list,
 * comparison-matrix, chip-cloud.
 *
 * Types only — erased at compile time, so both the pure `tables-tail-config`
 * module (which the registry's eager metadata graph reaches) and the widget
 * components can name them without either importing the other. That keeps the
 * config module free of component code (04 §2.3, acceptance #3) AND keeps the
 * module graph acyclic, which `pnpm check-deps` enforces with
 * `tsPreCompilationDeps`. Mirrors `tables-track-f-types.ts`.
 *
 * The component files re-export these, so import points stay stable.
 */

// --- sparkline-table ----------------------------------------------------------

/**
 * One `sparkline-table` metric row (annex: "name + 8-bar sparkline + mono value
 * + delta pill (good/bad aware)").
 */
export interface SparkMetricRow {
  id: string | number;
  name: string;
  /** Already-formatted display value, or a raw number the widget formats. */
  value: number | string;
  /** Period-over-period change, in percent (e.g. `-4.2` → "-4.2%"). */
  delta?: number | undefined;
  /**
   * Which direction is GOOD for this metric. `down` inverts the delta pill's
   * tone (error rate, churn, latency, cost); omitted → `up`.
   */
  goodDirection?: 'up' | 'down' | undefined;
  /** The 8-point micro-series behind the row (annex: "8-bar sparkline"). */
  spark?: number[] | undefined;
  /** Currency code when `value` is money (else the number/compact formatter). */
  currency?: string | undefined;
  /** Row-level unit suffix ("ms", "req/s") appended to a numeric value. */
  unit?: string | undefined;
}

// --- top-movers-list ----------------------------------------------------------

/**
 * One `top-movers-list` row (annex: "tone-tinted icon, name, micro sparkline,
 * value, fixed-width arrow delta pill (danger for bad movers)").
 */
export interface MoverRow {
  id: string | number;
  name: string;
  value: number | string;
  delta: number;
  goodDirection?: 'up' | 'down' | undefined;
  spark?: number[] | undefined;
  /** Icon-tile tone; else derived from whether the move is good or bad. */
  tone?: string | undefined;
  currency?: string | undefined;
  unit?: string | undefined;
}

// --- ranked-entity-list -------------------------------------------------------

/**
 * One `ranked-entity-list` row (annex: "Rank number, name, value, proportional
 * accent bar"). `pct` is derived by the widget from the max value — a row never
 * carries a pre-computed bar width, so the bars stay proportional after the
 * top-N slice.
 */
export interface RankedEntity {
  id: string | number;
  name: string;
  value: number;
  /** Row-click target for the sibling-widget link (annex `linkTarget`). */
  key?: string | undefined;
  tone?: string | undefined;
}

// --- accordion-list -----------------------------------------------------------

/**
 * One `accordion-list` row (annex: "header with badge/method chip + body panel
 * (description, column schema, FAQ answer)").
 */
export interface AccordionRow {
  id: string;
  header: string;
  /** Method chip / status badge shown before the header (GET, POST, "New"…). */
  badge?: string | undefined;
  badgeTone?: string | undefined;
  /** Prose body revealed on expand. */
  body?: string | undefined;
  /** Optional key/value detail rows (an endpoint's column schema). */
  fields?: { label: string; value: string; mono?: boolean | undefined }[] | undefined;
}

// --- comparison-matrix --------------------------------------------------------

/** A `comparison-matrix` column (a plan / tier / product being compared). */
export interface ComparisonColumn {
  id: string;
  label: string;
  /** Sub-label under the column head ("$29 / mo"). */
  meta?: string | undefined;
}

/**
 * A matrix cell: `true`/`false` render as a check / em-dash, a string renders as
 * mono text (annex: "cells rendering check / em-dash / mono text").
 */
export type ComparisonCell = boolean | string;

/** One `comparison-matrix` feature row. */
export interface ComparisonRow {
  id: string;
  label: string;
  /** Category band this row belongs to (annex `groups`). */
  group?: string | undefined;
  /** columnId → cell. A missing entry renders as the em-dash. */
  cells: Record<string, ComparisonCell>;
}

/** The `comparison-matrix` payload (annex: "static or config-driven rows"). */
export interface ComparisonMatrixData {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  /** Ordered category bands; rows without a group render before the first band. */
  groups?: string[] | undefined;
}

// --- chip-cloud ---------------------------------------------------------------

/**
 * One `chip-cloud` chip (annex: "string array (+ optional icon per chip)").
 * Carried in the canonical `categorical` envelope's `items`, so the host's
 * shared `isEmptyByShape['categorical']` predicate routes an empty cloud to the
 * empty state without the widget re-implementing emptiness.
 */
export interface CloudChip {
  label: string;
  /** lucide-react icon name, resolved against the family's closed icon map. */
  icon?: string | undefined;
  tone?: string | undefined;
  /** Drill-through/insert payload; defaults to `label`. */
  value?: string | undefined;
}
