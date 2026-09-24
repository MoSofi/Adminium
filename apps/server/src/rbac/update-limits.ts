// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Update grants that may not write everything.
 *
 * An app's role can say its `update` on a table reaches only some columns,
 * and some of those only to some values: a clinician moves a visit along
 * (`status` to roomed, with the clinician, ready) and cannot cancel it or
 * rewrite its time. The limit is stored on the role's matrix row for that
 * table, beside the `update` it narrows (`TableActions.updateLimit`).
 *
 * WHO IS LIMITED. Roles add up, as grants always have: a person is held to a
 * limit only when every role that lets them update the table is limited. One
 * role with a plain `update` there (a manager's, an admin's wildcard) lifts
 * it, and Super Admin is never limited. Two limited roles widen each other: a
 * column either allows is allowed, and a value either allows is allowed.
 *
 * WHAT IS CHECKED is what the caller sent, never what Adminium adds to it: a
 * stamp or a copied value a rule writes because `status` moved is the rule's
 * doing, not the person's. A column sent with the value the row already holds
 * is not a change, so a form that posts the whole row still saves when only
 * an allowed column moved.
 *
 * A create is not limited. The limit narrows `update`; a role that may create
 * rows was given that separately and creates them whole. An undo is not judged
 * either: it puts back, within the undo window, only what the same person's
 * own write changed. Files attached beside a record are not its columns.
 */
import type { RolePermission, TableActions, UpdateLimit } from '@adminium/meta';

import { ForbiddenError } from '../errors.js';
import { grantMatches, isGranted } from './permissions.js';

export type { UpdateLimit };

/** One limited update grant, as the resolver collected it. */
export interface LimitedUpdate {
  /** The grant it narrows, `table:<connectionId>:<table>:update`. */
  grant: string;
  limit: UpdateLimit;
}

/** What the resolver keeps of a person's limited update grants. */
export interface UpdateLimits {
  limited: readonly LimitedUpdate[];
  /** Every grant the person holds except the update grants a limit narrows. */
  unlimited: ReadonlySet<string>;
}

/** The limit on one matrix row's update, when the row grants update with one. */
export function limitOfRow(row: RolePermission): UpdateLimit | null {
  if (row.resourceKind !== 'table') return null;
  const actions = row.actions as TableActions;
  return actions.update === true && actions.updateLimit !== undefined ? actions.updateLimit : null;
}

/** Several limits as one: a column or a value any of them allows is allowed. */
export function mergeLimits(limits: readonly UpdateLimit[]): UpdateLimit {
  const writable = new Set<string>();
  const values = new Map<string, Set<string | number | boolean> | 'any'>();
  for (const limit of limits) {
    for (const column of limit.writable) {
      writable.add(column);
      const allowed = limit.writableValues?.[column];
      const held = values.get(column);
      if (allowed === undefined || held === 'any') {
        values.set(column, 'any');
        continue;
      }
      const set = held ?? new Set();
      for (const value of allowed) set.add(value);
      values.set(column, set);
    }
  }
  const writableValues: Record<string, (string | number | boolean)[]> = {};
  for (const [column, allowed] of values) if (allowed !== 'any') writableValues[column] = [...allowed];
  return {
    writable: [...writable],
    ...(Object.keys(writableValues).length === 0 ? {} : { writableValues }),
  };
}

/**
 * The limit this person's update on one table is held to, or null when it is
 * not held to one: Super Admin, a person with no limited grant there, and a
 * person who also holds an unlimited update there.
 */
export function updateLimitOf(
  set: { superAdmin?: boolean; updateLimits?: UpdateLimits | undefined },
  connectionId: string,
  tableId: string,
): UpdateLimit | null {
  if (set.superAdmin === true || set.updateLimits === undefined) return null;
  const permission = `table:${connectionId}:${tableId}:update`;
  const matching = set.updateLimits.limited.filter((entry) => grantMatches(entry.grant, permission));
  if (matching.length === 0) return null;
  if (isGranted(set.updateLimits.unlimited, permission)) return null;
  return mergeLimits(matching.map((entry) => entry.limit));
}

/**
 * Loose equality between a value sent and the value stored, across drivers.
 * When in doubt it answers "changed", which only ever refuses more.
 */
function sameValue(sent: unknown, stored: unknown): boolean {
  if (sent === null || sent === undefined) return stored === null || stored === undefined;
  if (stored === null || stored === undefined) return false;
  if (stored instanceof Date && typeof sent === 'string') return Date.parse(sent) === stored.getTime();
  const text = (value: unknown): string => {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'boolean') return value ? '1' : '0';
    return String(value);
  };
  return text(sent) === text(stored);
}

/** Does `value` equal one of the allowed values? A number may arrive as text. */
function allows(allowed: readonly (string | number | boolean)[], value: unknown): boolean {
  return allowed.some((candidate) => sameValue(candidate, value));
}

/**
 * Refuse a write the limit does not allow: 403 `COLUMN_FORBIDDEN`, naming the
 * table, the column and — when the column may be written but not to this —
 * the value, with what is allowed.
 *
 * `before` is the row as it stands. With it, a column sent unchanged is let
 * through; without it (a bulk update, one `values` for many rows) every
 * column sent counts.
 */
export function assertWithinLimit(
  limit: UpdateLimit | null,
  table: string,
  values: Readonly<Record<string, unknown>>,
  before?: Readonly<Record<string, unknown>> | null,
): void {
  if (limit === null) return;
  const writable = new Set(limit.writable);
  for (const [column, value] of Object.entries(values)) {
    if (before != null && column in before && sameValue(value, before[column])) continue;
    if (!writable.has(column)) {
      throw new ForbiddenError(`Your role may not change ${column} on this table.`, 'COLUMN_FORBIDDEN', {
        table,
        column,
        reason: 'update-limit',
        writable: limit.writable,
      });
    }
    const allowed = limit.writableValues?.[column];
    if (allowed !== undefined && !allows(allowed, value)) {
      throw new ForbiddenError(
        `Your role may not set ${column} to ${JSON.stringify(value)} on this table.`,
        'COLUMN_FORBIDDEN',
        { table, column, value, reason: 'update-limit', writableValues: allowed },
      );
    }
  }
}
