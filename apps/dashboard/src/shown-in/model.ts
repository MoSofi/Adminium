// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Shown in" as data: an email template, a report layout or an invoice layout
 * is listed in every workspace (`all`, the default) or in the chosen ones
 * (`chosen`, possibly none). It narrows lists and pickers. A send never asks.
 *
 * TYPE MIRROR of `apps/server/src/workspaces/shown-in.ts` (`shownInView`).
 */
import { OTHER_DATABASES, type ShownInScope } from './scope.js';

export interface ShownIn {
  mode: 'all' | 'chosen';
  /** The chosen workspaces; empty for `all`, and for "chosen, none". */
  workspaceIds: string[];
}

export const SHOWN_IN_ALL: ShownIn = { mode: 'all', workspaceIds: [] };

/** Whether an item is listed where the person is looking: a workspace id, {@link OTHER_DATABASES}, or anywhere (null). */
export function shownWhere(shownIn: ShownIn | undefined, where: string | null): boolean {
  if (where === null || shownIn === undefined || shownIn.mode === 'all') return true;
  if (where === OTHER_DATABASES) return false;
  return shownIn.workspaceIds.includes(where);
}

/**
 * Where a list is narrowed to: in One at a time, the tab's workspace; in All
 * in one menu, what the list's own Workspace filter says ('' = every one).
 *
 * `workspaceId` goes to the server (`?workspaceId=`, which only narrows).
 * "Other databases" is no workspace the server knows: its cut is made here,
 * keeping what is shown in all.
 */
export function listCut(scope: ShownInScope, picked: string): { where: string | null; workspaceId: string | undefined } {
  if (!scope.active) return { where: null, workspaceId: undefined };
  const where = scope.view === 'one' ? scope.currentWorkspaceId : picked === '' ? null : picked;
  return { where, workspaceId: where === null || where === OTHER_DATABASES ? undefined : where };
}

/**
 * The value after one change in the control. Switching to "Only these"
 * starts from the tab's workspace when there is one; ids the person cannot
 * see are kept, never dropped by an edit they could not make.
 */
export function nextShownIn(
  value: ShownIn,
  change: { mode: 'all' | 'chosen' } | { toggle: string; on: boolean },
  start: string | null,
): ShownIn {
  if ('mode' in change) {
    if (change.mode === 'all') return SHOWN_IN_ALL;
    if (value.mode === 'chosen') return value;
    return { mode: 'chosen', workspaceIds: start === null || start === OTHER_DATABASES ? [] : [start] };
  }
  const without = value.workspaceIds.filter((id) => id !== change.toggle);
  return { mode: 'chosen', workspaceIds: change.on ? [...without, change.toggle].sort() : without };
}

/** Where a picker narrows to: the tab's workspace, in either view (a picker offers what is listed where the person is). */
export function pickerWhere(scope: ShownInScope): string | null {
  return scope.active ? scope.currentWorkspaceId : null;
}
