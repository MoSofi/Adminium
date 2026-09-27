// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A write's refusal, as a caller whose role reads a table only in part may be
 * told it.
 *
 * A write judges the row whole: its limits, its balances, its states, its
 * stamps. Their refusals repeat some of what was judged — a strict row's
 * `by` and `at` and its `show` columns, a full pool's key and what is left,
 * a balance, the moment a window closes at, a parent's state. For a caller
 * who may not read the column a value comes from, that value is left out of
 * the refusal; the code, the column's name and where it happened stay, so a
 * form still knows which field to mark. Nearly everyone reads every column,
 * and is told everything as before.
 */
import { AppError } from '../../errors.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import { strictSources } from '../../crud/state-conditions.js';
import { stringsOf } from '../../crud/read-view.js';

/** What a refusal may always say: where it happened and which rule, never a value of the row. */
const STRUCTURAL: ReadonlySet<string> = new Set([
  'column',
  'columns',
  'rule',
  'kind',
  'row',
  'reason',
  'relation',
  'under',
  'path',
  'child',
  'index',
  'retry',
  'requires',
  'create',
  'unresolved',
  'bound',
  'effect',
  'on',
  'table',
  'parent',
  'fields',
  'code',
  'constraint',
]);

const TIMED: ReadonlySet<string> = new Set(['STATE_MOVE_REFUSED', 'STATE_TOO_LATE', 'WRITE_WINDOW_CLOSED', 'CAPACITY_TOO_LATE']);

/** Every column the caller's view hides, on any table: a rule may read one through a link. */
function hiddenAnywhere(view: SnapshotView): Set<string> {
  const out = new Set<string>();
  for (const model of view.model.tables) {
    const table = view.linkTable(model.id);
    for (const column of table?.columns.values() ?? []) if (column.unreadable === true) out.add(column.name);
  }
  return out;
}

/**
 * The refusal as the caller may read it: the same error when their view
 * hides nothing, else a copy whose details leave out every value read from a
 * column they may not read. `table` is the table the refusal is about, as
 * the caller's view reads it.
 */
export function scrubRefusal(error: unknown, view: SnapshotView, table: ResolvedTable): unknown {
  if (!view.readLimited || !(error instanceof AppError)) return error;
  const details = error.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return error;
  const hidden = (at: ResolvedTable | null | undefined, column: unknown): boolean => typeof column === 'string' && at?.columns.get(column)?.unreadable === true;
  const out: Record<string, unknown> = { ...(details as Record<string, unknown>) };
  // A value keyed by its column (a strict row's `show`).
  for (const key of Object.keys(out)) if (hidden(table, key)) delete out[key];
  // A refusal about a hidden column says which column, and nothing it holds.
  if (hidden(table, out['column']) || hidden(table, out['via'])) {
    for (const key of Object.keys(out)) if (!STRUCTURAL.has(key)) delete out[key];
  }
  const everywhere = hiddenAnywhere(view);
  const reads = (rule: unknown) => [...stringsOf(rule)].some((name) => everywhere.has(name));
  // When and by whom a strict row got to its state: the stamp columns it is read from.
  const states = table.table?.states;
  if (error.code === 'STATE_UNCHANGED' && states !== undefined) {
    const sources = strictSources(table, states, out['state']);
    if (sources.at === undefined || hidden(table, sources.at)) delete out['at'];
    if (sources.by === undefined || hidden(table, sources.by)) delete out['by'];
  }
  // A full pool: its key and what is left are read from the rule's columns (its dates, its link, its size).
  if (error.code.startsWith('CAPACITY_') && reads([table.table?.capacity, table.table?.capacityRules])) {
    delete out['pool'];
    delete out['left'];
    delete out['at'];
  }
  // A moment a move or a window waits for is read from the row's (or a linked row's) columns.
  if (TIMED.has(error.code) && 'at' in out && reads([states, table.table?.stateParents])) delete out['at'];
  // A parent's state, when the caller may not read the parent's state column.
  if (typeof out['parent'] === 'string' && 'state' in out) {
    let parent: ResolvedTable | null = null;
    try {
      parent = view.table(out['parent']);
    } catch {
      parent = null;
    }
    if (parent === null || hidden(parent, parent.table?.states?.column)) delete out['state'];
  }
  // A balance: its figure is the balance column's.
  if ('balance' in out && hidden(table, out['column'])) delete out['balance'];
  return new AppError(error.statusCode, error.code, error.message, out);
}
