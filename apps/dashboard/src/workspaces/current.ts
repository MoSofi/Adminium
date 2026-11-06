// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tab's current workspace, for any screen that needs it.
 *
 * The one public door to what the menu keeps (`shell/workspaces/current.ts`):
 * other screens read it here, never from the shell's modules.
 *
 * - `currentWorkspaceId`: the tab's workspace id, `'other'` for "Other
 *   databases", or null while the menu does not group by workspace (a server
 *   with no workspace, or a person who sees one group). Send it as a list's
 *   `workspaceId` in One at a time; it is never a stored server-side choice.
 * - `view`: the server's view of workspaces, `'one'` or `'all'`.
 * - `workspaces`: the groups this person sees, in menu order ("Other
 *   databases" last, when they see it).
 * - `shown`: whether the menu groups by workspace at all.
 */
import { useQuery } from '@tanstack/react-query';

import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { useCurrentGroup } from '../shell/workspaces/current.js';
import type { WorkspaceGroup } from '../shell/workspaces/model.js';

export { OTHER_GROUP } from '../shell/workspaces/model.js';
export type { WorkspaceGroup } from '../shell/workspaces/model.js';

export interface CurrentWorkspace {
  currentWorkspaceId: string | null;
  view: 'one' | 'all';
  workspaces: WorkspaceGroup[];
  shown: boolean;
}

const NOBODY: Pick<BootstrapData, 'workspaces' | 'user'> = {
  user: { id: '', email: '', name: '', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 0, updatedAt: 0 },
};

/** The tab's current workspace. Reads the bootstrap the shell already holds. */
export function useCurrentWorkspace(): CurrentWorkspace {
  const { data } = useQuery(bootstrapQuery());
  const { groups, shown, current, view } = useCurrentGroup(data ?? NOBODY);
  return { currentWorkspaceId: current?.id ?? null, view, workspaces: groups, shown };
}
