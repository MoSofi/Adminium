// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHETHER A ROW LIMIT CAN HOLD ON A TABLE, asked before one is stored and
 * before a figure is worked out under one.
 *
 * A limit that names a table that is not there, one that does not say whose
 * its rows are, or a private one (read by its own people whatever a role
 * says) would be stored and never judged: the screen would say "their own
 * rows" and the role would read every row. And "only while column X is one
 * of …" may name only a column staff read plainly: under a hidden one, the
 * count of rows reached tells its values to whoever edits roles.
 */
import type { RowLimit, RowReach } from '@adminium/meta';

import type { EffectiveModel } from '../connections/effective-schema.js';

export interface RowLimitIssue {
  code: 'no-such-table' | 'private' | 'no-belongs' | 'no-such-column' | 'hidden-column';
  message: string;
  column?: string;
}

export function rowReachIssue(model: EffectiveModel, tableId: string, reach: RowReach): RowLimitIssue | null {
  const table = model.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined) return { code: 'no-such-table', message: 'That table is not there.' };
  if (table.private === true) return { code: 'private', message: 'A private table is read by its own people only.' };
  if (table.belongs === undefined && reach.reach !== 'all') return { code: 'no-belongs', message: 'This table does not say whose its rows are.' };
  if (reach.while !== undefined) {
    const column = table.columns.find((candidate) => candidate.name === reach.while?.column);
    if (column === undefined) return { code: 'no-such-column', message: `"${table.label ?? table.name}" has no column "${reach.while.column}".`, column: reach.while.column };
    // A secret is carried by no response; a masked column is shown only to who is granted it by name.
    const flags = column.semantics?.flags;
    if (flags?.secret === true || column.masked === true || column.hidden === true || (column.masked === undefined && flags?.maskedByDefault === true)) {
      return { code: 'hidden-column', message: `"${reach.while.column}" is not shown to everybody who reads the table, so a limit cannot be told by it.`, column: reach.while.column };
    }
  }
  return null;
}

/** The first thing wrong with a table's whole limit, with the action it is under. */
export function rowLimitIssue(model: EffectiveModel, tableId: string, limit: RowLimit): (RowLimitIssue & { action: string }) | null {
  for (const [action, reach] of Object.entries(limit)) {
    if (reach === undefined) continue;
    const issue = rowReachIssue(model, tableId, reach);
    if (issue !== null) return { ...issue, action };
  }
  return null;
}
