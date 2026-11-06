// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The tab's current workspace, for any screen that needs it.
 *
 * The one public door to what the menu keeps (`shell/workspaces/current.ts`):
 * other screens read it here, never from the shell's modules.
 *
 * - `currentWorkspaceId`: the tab's workspace id, `'other'` for "Other
 *   databases" (the same word a list's `workspaceId` takes), or null while the menu does not group by workspace (a server
 *   with no workspace, or a person who sees one group). Send it as a list's
 *   `workspaceId` in One at a time; it is never a stored server-side choice.
 * - `view`: the server's view of workspaces, `'one'` or `'all'`.
 * - `workspaces`: the groups this person sees, in menu order ("Other
 *   databases" last, when they see it).
 * - `shown`: whether the menu groups by workspace at all.
 */
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import { useContext } from 'react';

import { bootstrapQuery, type BootstrapData } from '../app/bootstrap.js';
import { useCurrentGroup } from '../shell/workspaces/current.js';
import type { WorkspaceGroup } from '../shell/workspaces/model.js';

export { OTHER_GROUP } from '../shell/workspaces/model.js';
export type { WorkspaceGroup } from '../shell/workspaces/model.js';
// The bootstrap's typed `workspaces` field, for pieces that read it themselves.
export type { BootstrapWorkspace, BootstrapWorkspaces } from '../app/bootstrap.js';

export interface CurrentWorkspace {
  currentWorkspaceId: string | null;
  view: 'one' | 'all';
  workspaces: WorkspaceGroup[];
  shown: boolean;
}

const NOBODY: Pick<BootstrapData, 'workspaces' | 'user'> = {
  user: { id: '', email: '', name: '', status: 'active', totpEnabled: false, lastLoginAt: null, createdAt: 0, updatedAt: 0 },
};

/** Stand-in for a piece drawn outside a query provider (a unit test, a story): never fetches. */
const DETACHED_CLIENT = new QueryClient();

/** The tab's current workspace. Reads the bootstrap the shell already holds, and never asks for it. */
export function useCurrentWorkspace(): CurrentWorkspace {
  const client = useContext(QueryClientContext) as QueryClient | undefined;
  const { data } = useQuery({ ...bootstrapQuery(), enabled: false }, client ?? DETACHED_CLIENT);
  const { groups, shown, current, view } = useCurrentGroup(data ?? NOBODY);
  return { currentWorkspaceId: current?.id ?? null, view, workspaces: groups, shown };
}
