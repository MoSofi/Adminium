// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Settings → Project: what `GET /project/overview` says about the
 * project folder this server runs.
 *
 * Shapes mirror `apps/server/src/routes/project/index.ts`; change both
 * together. A server that runs no project has no `/project` routes, and its
 * 404 reads as `null`.
 */

import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';
import type { ProjectStatusEntryDto } from '../pages/projectApi.js';

export interface ProjectOverviewDto {
  root: string;
  version: string;
  mode: 'dev' | 'server';
  /** False where project code never loads: the desktop app. */
  codeEnabled: boolean;
  loadedAt: number | null;
  actions: {
    id: string;
    source: string;
    label: string;
    database: string;
    table: string;
    bulk: boolean;
    permission: 'read' | 'create' | 'update' | 'delete';
  }[];
  hooks: {
    source: string;
    database: string;
    table: string;
    events: string[];
    onImport: boolean;
  }[];
  files: { pages: string[]; schema: string[] };
  /** The hand-written pages, `pages/<slug>.tsx`. */
  pages: { slug: string; source: string; title: string; group: string; hidden: boolean }[];
  /** The widgets, `widgets/<name>.tsx`. */
  widgets: { id: string; source: string; kind: 'cell' | 'card' }[];
  problems: { source: string; message: string; at: number }[];
  hookFailures: {
    at: number;
    source: string;
    event: string;
    database: string;
    table: string;
    message: string;
  }[];
  changes: ProjectStatusEntryDto[];
}

export const PROJECT_OVERVIEW_QUERY_KEY = ['studio', 'project', 'overview'] as const;

export function projectOverviewQuery() {
  return queryOptions({
    queryKey: PROJECT_OVERVIEW_QUERY_KEY,
    queryFn: async (): Promise<ProjectOverviewDto | null> => {
      try {
        const reply = await api.get<{ data: ProjectOverviewDto }>('/api/v1/project/overview');
        return reply.data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });
}
