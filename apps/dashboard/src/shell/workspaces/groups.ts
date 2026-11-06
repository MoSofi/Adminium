// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The menu's groups and the tab's place among them: the part of the model the
 * shell reads on every page (the tab's workspace, for the lists below it).
 * The rest of the model (blocks, the link rule) loads with the grouped menu.
 */
import type { BootstrapData } from '../../app/bootstrap.js';

/** "Other databases", as a group id and as a list's `workspaceId`. */
export const OTHER_GROUP = 'other';

export interface WorkspaceGroup {
  /** The workspace's id, or {@link OTHER_GROUP}. */
  id: string;
  kind: 'workspace' | 'other';
  /** The workspace's name; empty for "Other databases" (its words are the reader's). */
  name: string;
  initials: string;
  connectionIds: readonly string[];
}

/** The groups this person sees, in menu order: the workspaces by position, then "Other databases". */
export function workspaceGroups(bootstrap: Pick<BootstrapData, 'workspaces'>): WorkspaceGroup[] {
  const block = bootstrap.workspaces;
  if (block === undefined) return [];
  const groups: WorkspaceGroup[] = [...block.workspaces]
    .sort((a, b) => a.position - b.position)
    .map((workspace) => ({ id: workspace.id, kind: 'workspace', name: workspace.name, initials: workspace.initials, connectionIds: workspace.connectionIds }));
  if (block.otherDatabases !== null && block.otherDatabases.length > 0) {
    groups.push({ id: OTHER_GROUP, kind: 'other', name: '', initials: '', connectionIds: block.otherDatabases });
  }
  return groups;
}

/**
 * Where a tab is: its own choice while it still names a group this person
 * sees, else their last choice on the server (where a new tab starts), else
 * the first group.
 */
export function resolveGroup(groups: readonly WorkspaceGroup[], stored: string | null, last: string | null): WorkspaceGroup | null {
  return groups.find((group) => group.id === stored) ?? groups.find((group) => group.id === last) ?? groups[0] ?? null;
}
