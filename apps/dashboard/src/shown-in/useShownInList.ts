// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A Library list's "Shown in" cut: in One at a time it follows the tab's
 * workspace; in All in one menu it is the list's own Workspace filter, which
 * starts at every workspace. `workspaceId` goes to the server (it only
 * narrows); `keeps` makes the same cut on the client, which "Other
 * databases" needs (no workspace the server knows).
 */
import { useCallback, useState } from 'react';

import { listCut, pickerWhere, shownWhere, type ShownIn } from './model.js';
import { OTHER_DATABASES, useShownInScope, type ShownInScope } from './scope.js';

export interface ShownInList {
  scope: ShownInScope;
  /** For the list's request. */
  workspaceId: string | undefined;
  /** Whether an item is in the cut. */
  keeps: (shownIn: ShownIn | undefined) => boolean;
  /** Whether the list draws its "Shown in" column (or card chips). */
  showColumn: boolean;
  /** The Workspace filter, drawn in All in one menu only; null otherwise. */
  filter: { value: string; onChange: (next: string) => void } | null;
}

export function useShownInList(): ShownInList {
  const scope = useShownInScope();
  const [picked, setPicked] = useState('');
  const cut = listCut(scope, picked);
  const keeps = useCallback((shownIn: ShownIn | undefined) => shownWhere(shownIn, cut.where), [cut.where]);
  return {
    scope,
    workspaceId: cut.workspaceId,
    keeps,
    showColumn: scope.active,
    filter: scope.active && scope.view === 'all' ? { value: picked, onChange: setPicked } : null,
  };
}

/**
 * A picker's cut (a "start from a template" list, a rule's template select):
 * what is listed in the tab's workspace, in either view. A send never asks;
 * an item already chosen that is not listed here is shown with
 * `HiddenHereNote`.
 */
export function useShownInPicker(): Pick<ShownInList, 'scope' | 'workspaceId' | 'keeps'> {
  const scope = useShownInScope();
  const where = pickerWhere(scope);
  const keeps = useCallback((shownIn: ShownIn | undefined) => shownWhere(shownIn, where), [where]);
  return { scope, workspaceId: where === null || where === OTHER_DATABASES ? undefined : where, keeps };
}
