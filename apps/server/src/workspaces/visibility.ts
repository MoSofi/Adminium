// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Which workspaces a person sees.
 *
 * A workspace is a way to organise a server's databases, not a security wall:
 * rights stay with roles, and nothing here grants anything. A person sees a
 * workspace when the menu gives them something of it — a page on one of its
 * databases, or the staff screens of an app installed on one — or when they
 * manage connections (they manage what workspaces hold). The same rule
 * applies to "Other databases": the databases in no workspace, a group of its
 * own once one workspace exists.
 */
import { pagesRepo, workspacesRepo, type MetaDb, type Workspace } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { addressKey } from '../surfaces/settings.js';

const CONNECTIONS_MANAGE = 'system:connections:manage';

/**
 * What a list's `workspaceId` says for "Other databases": not a workspace, so
 * it has no id of its own. A workspace's id is never this word.
 */
export const OTHER_DATABASES = 'other';

export interface VisibleWorkspaces {
  /** Every workspace, by position; `visible` says whether this person sees it. */
  all: (Workspace & { visible: boolean })[];
  /** The databases in no workspace, when one workspace exists; null while none does. */
  otherDatabases: string[] | null;
  /** Whether this person sees the "Other databases" group. */
  otherVisible: boolean;
  /** Whether they manage connections (they see every workspace). */
  manages: boolean;
}

type Can = (permission: string) => Promise<boolean>;

function canOf(request: FastifyRequest): Can {
  return async (permission) => typeof request.can !== 'function' || (await request.can(permission as never));
}

/**
 * The databases a person reaches through the menu: those of the pages they
 * may open, and those of the app installs whose staff screens they may open.
 * A caller that has already read either (the bootstrap) passes it in.
 */
export async function reachedConnections(
  meta: MetaDb,
  can: Can,
  known: { pageConnections?: Iterable<string | null>; installConnections?: Iterable<string | null> } = {},
): Promise<Set<string>> {
  const out = new Set<string>();
  if (known.pageConnections !== undefined) {
    for (const id of known.pageConnections) if (id !== null) out.add(id);
  } else {
    for (const row of await pagesRepo(meta).navRows()) {
      if (row.connectionId !== null && !out.has(row.connectionId) && (await can(`page:${row.id}:view`))) out.add(row.connectionId);
    }
  }
  if (known.installConnections !== undefined) {
    for (const id of known.installConnections) if (id !== null) out.add(id);
  } else {
    const installs = await meta.db.selectFrom('adminium_manifests').select(['manifestKey', 'instanceSlug', 'connectionId']).where('kind', '=', 'app').where('status', '=', 'installed').execute();
    for (const install of installs) {
      if (install.connectionId === null || out.has(install.connectionId)) continue;
      if (await can(`app:${addressKey(install.manifestKey, install.instanceSlug)}:staff`)) out.add(install.connectionId);
    }
  }
  return out;
}

/** The workspaces and the "Other databases" group, each marked seen or not for this person. */
export async function visibleWorkspaces(
  meta: MetaDb,
  can: Can,
  known: Parameters<typeof reachedConnections>[2] = {},
): Promise<VisibleWorkspaces> {
  const all = await workspacesRepo(meta).list();
  const manages = await can(CONNECTIONS_MANAGE);
  if (all.length === 0) return { all: [], otherDatabases: null, otherVisible: false, manages };
  const reached = manages ? new Set<string>() : await reachedConnections(meta, can, known);
  const grouped = new Set(all.flatMap((workspace) => workspace.connectionIds));
  const connections = (await meta.db.selectFrom('adminium_connections').select('id').orderBy('name', 'asc').execute()).map((row) => row.id);
  const other = connections.filter((id) => !grouped.has(id));
  return {
    all: all.map((workspace) => ({ ...workspace, visible: manages || workspace.connectionIds.some((id) => reached.has(id)) })),
    otherDatabases: other.length === 0 ? null : other,
    otherVisible: other.length > 0 && (manages || other.some((id) => reached.has(id))),
    manages,
  };
}

/** The ids of the workspaces a request's person sees. */
export async function visibleWorkspaceIds(meta: MetaDb, request: FastifyRequest): Promise<Set<string>> {
  const seen = await visibleWorkspaces(meta, canOf(request));
  return new Set(seen.all.filter((workspace) => workspace.visible).map((workspace) => workspace.id));
}

/**
 * A list's `workspaceId`, as the connections it narrows to. It only narrows:
 * the list keeps its own checks and is cut to these databases. A workspace
 * the person cannot see is not found.
 */
export async function workspaceConnections(meta: MetaDb, request: FastifyRequest, workspaceId: string): Promise<ReadonlySet<string> | null> {
  const seen = await visibleWorkspaces(meta, canOf(request));
  // The databases in no workspace, a group of their own once one exists: the same rule of who sees it.
  if (workspaceId === OTHER_DATABASES) return seen.otherVisible ? new Set(seen.otherDatabases ?? []) : null;
  const found = seen.all.find((workspace) => workspace.id === workspaceId && workspace.visible);
  return found === undefined ? null : new Set(found.connectionIds);
}

export { canOf };
