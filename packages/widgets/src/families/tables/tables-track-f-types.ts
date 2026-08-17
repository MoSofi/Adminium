// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Data-contract shapes for the `tables` family Track F widgets (annex §3).
 * Types only — erased at compile time, so both the pure `tables-track-f-config`
 * module (which the registry's eager metadata graph reaches) and the widget
 * components can name them without either one importing the other. That keeps
 * the config module free of component code (04 §2.3, acceptance #3) AND keeps
 * the module graph acyclic, which `pnpm check-deps` enforces with
 * `tsPreCompilationDeps`.
 *
 * The component files re-export these, so existing import points stay stable.
 */

// --- card-gallery -------------------------------------------------------------

/** One `card-gallery` tile. */
export interface GalleryCard {
  id: string | number;
  title: string;
  subtitle?: string | undefined;
  meta?: string | undefined;
  status?: string | undefined;
  statusTone?: string | undefined;
  tone?: string | undefined;
}

// --- grouped-summary-table ----------------------------------------------------

export type AggFormat = 'number' | 'currency' | 'percent' | 'progress' | 'text';

export interface AggColumn {
  key: string;
  label: string;
  format?: AggFormat | undefined;
  tone?: string | undefined;
  /** progress-format denominator (defaults to 100). */
  max?: number | undefined;
}

export interface SummaryGroup {
  key: string;
  label: string;
  count?: number | undefined;
  aggregates: Record<string, number | string>;
  rows?: { label: string; aggregates: Record<string, number | string> }[] | undefined;
}

export interface GroupedSummaryData {
  data: SummaryGroup[];
  columns: AggColumn[];
  totals?: Record<string, number | string> | undefined;
  total?: number | undefined;
}

// --- log-table ----------------------------------------------------------------

/** One `log-table` row. */
export interface LogRow {
  id: string | number;
  ts: string;
  actor?: string | undefined;
  category?: string | undefined;
  categoryTone?: string | undefined;
  action?: string | undefined;
  resource?: string | undefined;
  status?: string | undefined;
  code?: number | undefined;
  ip?: string | undefined;
  url?: string | undefined;
}

// --- schema-tree --------------------------------------------------------------

export type SchemaNodeKind = 'schema' | 'table' | 'view' | 'column';

export interface SchemaNode {
  id: string;
  kind: SchemaNodeKind;
  label: string;
  children?: SchemaNode[] | undefined;
  rowCount?: number | undefined;
  pgType?: string | undefined;
  pk?: boolean | undefined;
  fk?: boolean | undefined;
  unique?: boolean | undefined;
  nullable?: boolean | undefined;
}

// --- toggle-matrix ------------------------------------------------------------

export interface MatrixColumn {
  id: string;
  label: string;
  locked?: boolean | undefined;
}

export interface MatrixRow {
  id: string;
  label: string;
  group?: string | undefined;
  desc?: string | undefined;
}

export interface MatrixData {
  rowKeys: string[];
  colKeys: string[];
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** rowId → colId → boolean (granted). */
  cells: Record<string, Record<string, boolean>>;
  /** rowId → colId → true when the cell is immutable (granted + locked). */
  locked?: Record<string, Record<string, boolean>> | undefined;
}
