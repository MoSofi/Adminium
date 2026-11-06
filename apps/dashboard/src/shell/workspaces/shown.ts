// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether the menu groups by workspace for this person: two groups or more
 * (the workspaces they see, and "Other databases" when they see it). Its own
 * small module: the shell asks it on every page, and everything else about
 * workspaces loads only when the answer is yes.
 */
import type { BootstrapData } from '../../app/bootstrap.js';

export function workspacesShown(bootstrap: Pick<BootstrapData, 'workspaces'>): boolean {
  const block = bootstrap.workspaces;
  if (block === undefined) return false;
  return block.workspaces.length + ((block.otherDatabases?.length ?? 0) > 0 ? 1 : 0) >= 2;
}
