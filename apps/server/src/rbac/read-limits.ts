// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read grants that may not show everything.
 *
 * An app's role can say its `read` of a table shows only some columns:
 * housekeeping reads a stay's room, its dates and its late-leaving extra, and
 * nothing of its guest or its money. The limit is stored on the role's
 * matrix row for that table, beside the `read` it narrows
 * (`TableActions.readLimit`).
 *
 * WHO IS LIMITED. As with an update's limit: a person is held to it only
 * when every role that lets them read the table is limited. One role with a
 * plain `read` there lifts it, Super Admin is never limited, and two limited
 * roles widen each other (a column either shows is shown).
 *
 * WHAT IS ALWAYS SHOWN. The table's key and its links to other rows: a
 * screen moves through them, and a link says only which row, never what is
 * in it (that is the other table's read).
 */
import type { ReadLimit, RolePermission, TableActions } from '@adminium/meta';

import { grantMatches, isGranted } from './permissions.js';

export type { ReadLimit };

/** One limited read grant, as the resolver collected it. */
export interface LimitedRead {
  /** The grant it narrows, `table:<connectionId>:<table>:read`. */
  grant: string;
  limit: ReadLimit;
}

/** What the resolver keeps of a person's limited read grants. */
export interface ReadLimits {
  limited: readonly LimitedRead[];
  /** Every grant the person holds except the read grants a limit narrows. */
  unlimited: ReadonlySet<string>;
}

/** The limit on one matrix row's read, when the row grants read with one. */
export function readLimitOfRow(row: RolePermission): ReadLimit | null {
  if (row.resourceKind !== 'table') return null;
  const actions = row.actions as TableActions;
  return actions.read === true && actions.readLimit !== undefined ? actions.readLimit : null;
}

/**
 * The columns this person's read of one table shows (the key and links come
 * on top), or null when it shows every column: Super Admin, a person with no
 * limited read there, and a person who also holds an unlimited read there.
 */
export function readLimitOf(
  set: { superAdmin?: boolean; readLimits?: ReadLimits | undefined },
  connectionId: string,
  tableId: string,
): ReadonlySet<string> | null {
  if (set.superAdmin === true || set.readLimits === undefined) return null;
  const permission = `table:${connectionId}:${tableId}:read`;
  const matching = set.readLimits.limited.filter((entry) => grantMatches(entry.grant, permission));
  if (matching.length === 0) return null;
  if (isGranted(set.readLimits.unlimited, permission)) return null;
  return new Set(matching.flatMap((entry) => entry.limit.readable));
}

/**
 * Every table of one connection this person's read is limited on, with the
 * columns it shows — what a restricted view of the connection is built from.
 * Empty for nearly everyone.
 */
export function readLimitsOn(
  set: { superAdmin?: boolean; readLimits?: ReadLimits | undefined },
  connectionId: string,
  tableIds: Iterable<string>,
): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  if (set.superAdmin === true || set.readLimits === undefined) return out;
  for (const tableId of tableIds) {
    const limit = readLimitOf(set, connectionId, tableId);
    if (limit !== null) out.set(tableId, limit);
  }
  return out;
}
