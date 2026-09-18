// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a record is CALLED, when something has to name one.
 *
 * The search palette labels its hits with it, and the reference picker labels
 * the records a link points at. One answer, in one place: two surfaces that
 * called the same record different things would be two surfaces the same
 * person has to reconcile.
 */

import { classifyTable, type DatabaseModel, type TableModel } from '@adminium/engine';

import type { ResolvedTable, SnapshotView } from './identifiers.js';

/**
 * The label column for record hits: classifier displayColumn when it is a
 * readable (text-ish, unmasked, non-secret) column, else the first such
 * column, else null (→ PK label). Masked columns NEVER label a hit.
 */
export function labelColumnFor(view: SnapshotView, table: ResolvedTable): string | null {
  const usable = (name: string): boolean => {
    const column = table.columns.get(name);
    return column !== undefined && column.textish && !column.secret && !column.masked;
  };
  const classified = classifyTable(
    view.model as DatabaseModel,
    table.table as unknown as TableModel,
  );
  if (classified.displayColumn !== null && usable(classified.displayColumn)) {
    return classified.displayColumn;
  }
  return [...table.columns.values()].find((c) => usable(c.name))?.name ?? null;
}
