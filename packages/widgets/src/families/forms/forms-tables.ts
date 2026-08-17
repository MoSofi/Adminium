// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table-inclusion RULES behind `table-inclusion-checklist` (annex §10) —
 * PURE module (React-free, JSX-free, copy-free).
 *
 * LIFTED FROM THE STUDIO WIZARD, same reasoning as `forms-dsn.ts`: these rules
 * were born in `apps/dashboard/src/studio/connect/wizardState.ts` (M5-T02), and
 * the wizard now consumes them instead of keeping a rival copy. The rule that
 * matters is the DEFAULT: a >100k-row table starts unchecked. If the widget and
 * the wizard disagreed about that threshold, the same database would generate
 * different dashboards depending on which screen the user came through.
 *
 * WHAT STAYED IN THE WIZARD: the mapping from `@adminium/engine`'s introspected
 * `SchemaTable` onto `InclusionTable` below. That shape is the wizard's own
 * dependency, and the widget binds a §3 `record-list` instead — so the two meet
 * at `InclusionTable`, which is all the RULES ever needed to see.
 */

/** 05: a row estimate above this ⇒ an ops-volume table ⇒ starts unchecked. */
export const HIGH_VOLUME_ROWS = 100_000;

/** One includable table, reduced to what the inclusion rules read. */
export interface InclusionTable {
  /** Qualified table name — the mono label AND the inclusion key. */
  id: string;
  /** `null` when the source cannot supply counts (a schema file has none). */
  rowEstimate: number | null;
  /** How many of its columns the classifier flagged as PII (annex §10). */
  piiColumns: number;
  highVolume: boolean;
  /** Join/system tables are pre-hidden — never listed as includable. */
  preHidden: boolean;
  /** Suggested-dashboard tag chip (annex §10), when the enricher named one. */
  tag?: string | undefined;
}

/**
 * Whether a row estimate makes a table high-volume. `null` is NOT high-volume:
 * an unknown count is not evidence of a big table, and defaulting the unknown to
 * "exclude" would silently drop every table of a schema-file import.
 */
export function isHighVolume(rowEstimate: number | null): boolean {
  return rowEstimate !== null && rowEstimate > HIGH_VOLUME_ROWS;
}

/**
 * The default inclusion set: everything visible except high-volume ops tables
 * (05; M5-T02). Order follows the input so the derived list is deterministic.
 */
export function defaultIncludedIds(tables: readonly InclusionTable[]): string[] {
  return tables.filter((table) => !table.preHidden && !table.highVolume).map((table) => table.id);
}

/** `included`/`total` for the checklist header count (annex §10). */
export function inclusionCounts(
  tables: readonly InclusionTable[],
  selected: ReadonlySet<string>,
): { included: number; total: number } {
  const visible = tables.filter((table) => !table.preHidden);
  return {
    included: visible.filter((table) => selected.has(table.id)).length,
    total: visible.length,
  };
}
