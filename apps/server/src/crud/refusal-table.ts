// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The table a write's refusal is about, when it is not the table written.
 *
 * A move of one row can move a linked row too (a stay's room change marks
 * the old room for cleaning and the new one occupied), and the linked row's
 * own rules may refuse that move. The refusal then speaks of the linked
 * row — its state, its lock, its limits — and whoever is told it is judged
 * against that table's read, not the table they wrote (`refusal-scrub.ts`).
 * The innermost mark wins: a refusal already marked keeps its table.
 */
const TABLE = Symbol('adminium.refusalTable');

/** The same error, marked as a refusal about `table` (a table name or id), unless it is marked already. */
export function refusedOn<T>(error: T, table: string): T {
  if (typeof error === 'object' && error !== null && !Object.prototype.hasOwnProperty.call(error, TABLE)) {
    Object.defineProperty(error, TABLE, { value: table, enumerable: false });
  }
  return error;
}

/** The table a refusal was marked as being about, or undefined when it is about the table written. */
export function refusalTableOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const found = (error as { [TABLE]?: unknown })[TABLE];
  return typeof found === 'string' ? found : undefined;
}
