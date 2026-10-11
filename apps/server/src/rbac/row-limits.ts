// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Grants that may not reach every row.
 *
 * A role can say its read, its update or its delete of a table reaches only
 * some rows: the ones the person owns, the ones of the teams they lead, the
 * ones nobody owns yet, and — on top — only while a column holds some value.
 * The limit is stored on the role's matrix row for that table, beside the
 * action it narrows (`TableActions.rowLimit.<action>`). Whose a row is, is
 * the table's own word (`table.belongs`); this file knows only what each role
 * asks for. The test itself is built in `crud/row-limit.ts`.
 *
 * WHO IS LIMITED, action by action. As with a column limit: a person is held
 * to a row limit for an action only when every role that gives them that
 * action on the table is limited for it. Another role with a plain grant
 * lifts it, and Super Admin is never limited. Within ONE role a limit on a
 * table stands over that role's own wider grant ("every table" beside "deals:
 * the person's own" reads every table, and their own deals).
 *
 * TWO LIMITED ROLES are never blended. Each role's reach is its own test, and
 * the person reaches a row when any ONE role's whole test passes: a role that
 * reaches the team's rows while they are open, and another that reaches the
 * person's own rows always, do not add up to "the team's rows always".
 */
import type { RolePermission, RowReach, TableActions } from '@adminium/meta';

import { grantMatches, isGranted } from './permissions.js';

export type { RowReach };

/** The actions a row limit narrows. A create makes a new row: it is held by the links and the people it names. */
export const ROW_ACTIONS = ['read', 'update', 'delete'] as const;
export type RowAction = (typeof ROW_ACTIONS)[number];

/** One limited grant, as the resolver collected it. */
export interface LimitedRows {
  /** The grant it narrows, `table:<connectionId>:<table>:<action>`. */
  grant: string;
  reach: RowReach;
}

/**
 * What ONE role says of an action: the grants of it that a limit narrows,
 * and every other grant the role holds. Kept role by role, because a role
 * that limits a table and also holds a grant wide enough to cover it (an
 * editor's "every table", with deals narrowed to the person's own) means its
 * narrower word there: within a role, the limit on a table stands over that
 * role's own wider grant. Only ANOTHER role's plain grant lifts it.
 */
export interface RoleRows {
  limited: readonly LimitedRows[];
  /** Every grant the role holds except this action's grants a limit narrows. */
  unlimited: ReadonlySet<string>;
}

/** A person's row limits, per action, role by role; an action no role limits is absent. */
export type RowLimits = Partial<Record<RowAction, readonly RoleRows[]>>;

/**
 * Who the person is to a row: themselves, and the people they reach by
 * leading a team. Read once with the permission set. An API key is nobody
 * (`userId: null`): it owns no row and leads no team.
 */
export interface RowReachOf {
  userId: string | null;
  /** Every other member of every team the person leads. Empty unless a limit of theirs asks for the team's rows. */
  ledIds: readonly string[];
  /** The list above was cut at the most people a reach may hold. */
  capped?: true;
}

/** How far one matrix row's `action` reaches, when the row grants it with a limit. */
export function rowReachOfRow(row: RolePermission, action: RowAction): RowReach | null {
  if (row.resourceKind !== 'table') return null;
  const actions = row.actions as TableActions;
  return actions[action] === true ? (actions.rowLimit?.[action] ?? null) : null;
}

/**
 * The reaches this person's `action` on one table is held to, one per limit
 * of a limited role, or null when it is not held to any: Super Admin, a
 * person none of whose roles limits it there, and a person one of whose
 * OTHER roles grants it plainly. A table id that is no part of a permission
 * (it cannot be granted, so nobody reads it) answers no limit: there is
 * nothing to reach.
 */
export function rowReachesOf(
  set: { superAdmin?: boolean; rowLimits?: RowLimits | undefined },
  connectionId: string,
  tableId: string,
  action: RowAction,
): readonly RowReach[] | null {
  const roles = set.rowLimits?.[action];
  if (set.superAdmin === true || roles === undefined) return null;
  const permission = `table:${connectionId}:${tableId}:${action}`;
  const reaches: RowReach[] = [];
  for (const role of roles) {
    const matching = role.limited.filter((entry) => grantMatches(entry.grant, permission));
    if (matching.length > 0) reaches.push(...matching.map((entry) => entry.reach));
    // A role with no limit on this table that grants the action: every row, and nothing more to ask.
    else if (isGranted(role.unlimited, permission)) return null;
  }
  return reaches.length === 0 ? null : reaches;
}

/** Whether any limit this person holds asks for the rows of the teams they lead. */
export function asksForTeam(limits: RowLimits | undefined): boolean {
  return ROW_ACTIONS.some((action) => (limits?.[action] ?? []).some((role) => role.limited.some((entry) => entry.reach.reach === 'team')));
}
