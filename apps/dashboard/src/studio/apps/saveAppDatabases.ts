// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The databases Save as app offers, each once, with the workspaces it is in.
 *
 * A database can sit in several workspaces, so it is listed once and carries
 * a chip per workspace; one in none carries "Other databases". While the
 * server shows workspaces one at a time, the current workspace's databases
 * come first. With no workspaces there are no chips: the list is the one it
 * always was.
 */
import type { BootstrapData } from '../../app/bootstrap.js';
import type { ConnectionDto } from '../api.js';

interface BootstrapWorkspaces {
  workspaces: { id: string; name: string; position: number; connectionIds: string[] }[];
  otherDatabases: string[] | null;
  workspaceView: 'one' | 'all';
  lastWorkspaceId: string | null;
}

export interface SaveDatabase {
  connection: ConnectionDto;
  /** The workspaces it is in, by name, in the menu's order. */
  workspaces: string[];
  /** In no workspace, while the server has some. */
  other: boolean;
}

function workspacesOf(bootstrap: BootstrapData | undefined): BootstrapWorkspaces | null {
  const value = (bootstrap as { workspaces?: BootstrapWorkspaces } | undefined)?.workspaces;
  return value === undefined || value.workspaces.length === 0 ? null : value;
}

export function saveDatabases(connections: readonly ConnectionDto[], bootstrap: BootstrapData | undefined, currentWorkspaceId: string | null = null): SaveDatabase[] {
  const spaces = workspacesOf(bootstrap);
  if (spaces === null) return connections.map((connection) => ({ connection, workspaces: [], other: false }));
  const ordered = [...spaces.workspaces].sort((a, b) => a.position - b.position);
  const rows = connections.map((connection) => {
    const names = ordered.filter((space) => space.connectionIds.includes(connection.id)).map((space) => space.name);
    return { connection, workspaces: names, other: names.length === 0 };
  });
  const current = spaces.workspaceView === 'one' ? ordered.find((space) => space.id === (currentWorkspaceId ?? spaces.lastWorkspaceId)) : undefined;
  if (current === undefined) return rows;
  const first = rows.filter((row) => current.connectionIds.includes(row.connection.id));
  return [...first, ...rows.filter((row) => !current.connectionIds.includes(row.connection.id))];
}
