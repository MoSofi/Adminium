// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The project-folder status of this server's pages, for the pages manager.
 *
 * Shapes mirror `apps/server/src/routes/project/index.ts`; change both
 * together. A server that runs no project folder has no `/project` routes, and
 * its 404 reads as `null` here: the manager then shows nothing about projects.
 *
 * The query key sits under `['studio', 'pages']`, so every page mutation's
 * `invalidatePages` refreshes it too.
 */

import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';

export type ProjectFileStatus =
  'changed-on-server' | 'conflict' | 'not-in-project' | 'pending' | 'invalid';

export interface ProjectStatusEntryDto {
  path: string;
  kind: 'page' | 'schema';
  /** The page address, or the database key of a schema file. */
  name: string;
  pageId: string | null;
  status: ProjectFileStatus;
  serverEditedAt: number | null;
  problems?: string[];
}

export interface OutsidePageDto {
  pageId: string;
  slug: string;
  connectionId: string | null;
  reason: string;
}

export interface ProjectStatusDto {
  /** `dev` keeps files and Studio in step by itself; a `server` flags what differs. */
  mode: 'dev' | 'server';
  entries: ProjectStatusEntryDto[];
  outside: OutsidePageDto[];
}

export const PROJECT_STATUS_QUERY_KEY = ['studio', 'pages', 'project-status'] as const;

/** The reason the server gives for a page whose database the project does not list. */
export const NOT_CONFIGURED_REASON = 'its database is not in adminium.config.ts';

export function projectStatusQuery() {
  return queryOptions({
    queryKey: PROJECT_STATUS_QUERY_KEY,
    queryFn: async (): Promise<ProjectStatusDto | null> => {
      try {
        const reply = await api.get<{ data: ProjectStatusDto }>('/api/v1/project/status');
        return reply.data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export async function resolveProjectFile(
  path: string,
  keep: 'server' | 'project',
): Promise<ProjectStatusDto> {
  const reply = await api.post<{ data: ProjectStatusDto }>('/api/v1/project/resolve', {
    path,
    keep,
  });
  return reply.data;
}

export type PageProjectFlag = 'changed' | 'conflict' | 'outside';

/** What the manager marks each page with, by page id. */
export function projectFlagsByPage(
  status: ProjectStatusDto | null | undefined,
): Map<string, PageProjectFlag> {
  const flags = new Map<string, PageProjectFlag>();
  if (status === null || status === undefined || status.mode !== 'server') return flags;
  for (const entry of status.entries) {
    if (entry.pageId === null) continue;
    if (entry.status === 'conflict') flags.set(entry.pageId, 'conflict');
    else if (entry.status === 'changed-on-server') flags.set(entry.pageId, 'changed');
    else if (entry.status === 'not-in-project') flags.set(entry.pageId, 'outside');
  }
  for (const page of status.outside) flags.set(page.pageId, 'outside');
  return flags;
}
