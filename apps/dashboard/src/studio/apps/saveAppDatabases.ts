// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The databases Save as app offers, each once, with the workspaces it is in.
 *
 * A database can sit in several workspaces, so it is listed once and carries
 * a chip per workspace; one in none carries "Other databases". While the
 * server shows workspaces one at a time, the tab's workspace's databases
 * come first. With no workspaces there are no chips: the list is the one it
 * always was.
 */
import type { BootstrapData, BootstrapWorkspaces } from '../../app/bootstrap.js';
import { OTHER_GROUP } from '../../workspaces/current.js';
import type { ConnectionDto } from '../api.js';

export interface SaveDatabase {
  connection: ConnectionDto;
  /** The workspaces it is in, by name, in the menu's order. */
  workspaces: string[];
  /** In no workspace, while the server has some. */
  other: boolean;
}

function workspacesOf(bootstrap: Pick<BootstrapData, 'workspaces'> | undefined): BootstrapWorkspaces | null {
  const value = bootstrap?.workspaces;
  return value === undefined || value.workspaces.length === 0 ? null : value;
}

/**
 * `currentWorkspaceId` is the tab's workspace (`useCurrentWorkspace()`): a
 * workspace's id, or `'other'` for "Other databases".
 */
export function saveDatabases(connections: readonly ConnectionDto[], bootstrap: Pick<BootstrapData, 'workspaces'> | undefined, currentWorkspaceId: string | null = null): SaveDatabase[] {
  const spaces = workspacesOf(bootstrap);
  if (spaces === null) return connections.map((connection) => ({ connection, workspaces: [], other: false }));
  const ordered = [...spaces.workspaces].sort((a, b) => a.position - b.position);
  const rows = connections.map((connection) => {
    const names = ordered.filter((space) => space.connectionIds.includes(connection.id)).map((space) => space.name);
    return { connection, workspaces: names, other: names.length === 0 };
  });
  if (spaces.workspaceView !== 'one' || currentWorkspaceId === null) return rows;
  const held = currentWorkspaceId === OTHER_GROUP ? (spaces.otherDatabases ?? []) : ordered.find((space) => space.id === currentWorkspaceId)?.connectionIds;
  if (held === undefined) return rows;
  const first = rows.filter((row) => held.includes(row.connection.id));
  return [...first, ...rows.filter((row) => !held.includes(row.connection.id))];
}
