// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The workspaces routes, for Data connections: list, create, rename, order,
 * what a delete would do, delete, and a connection's workspaces. Shapes mirror
 * `apps/server/src/routes/workspaces/schema.ts`. Every change publishes
 * `config-changed` on the server, which redraws every open menu; this tab's
 * own caches are refreshed here.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { api } from '../../app/api.js';

export interface WorkspaceDto {
  id: string;
  name: string;
  position: number;
  connectionIds: string[];
  sender: { name: string | null; from: string | null; replyTo: string | null; postal: string | null };
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceList {
  workspaces: WorkspaceDto[];
  /** The databases in no workspace once one exists; null while none does. */
  otherDatabases: string[] | null;
  view: 'one' | 'all';
}

export interface ShownOnlyIn {
  kind: 'email-template' | 'report' | 'invoice';
  itemId: string;
  name: string;
}

export interface WorkspaceDeletePlan {
  workspace: WorkspaceDto;
  connectionIds: string[];
  shownOnlyIn: ShownOnlyIn[];
  last: boolean;
}

export const WORKSPACES_QUERY_KEY = ['studio', 'workspaces'] as const;

export function workspacesQuery() {
  return queryOptions({
    queryKey: WORKSPACES_QUERY_KEY,
    queryFn: () => api.get<WorkspaceList>('/api/v1/workspaces'),
  });
}

export function deletePlanQuery(id: string) {
  return queryOptions({
    queryKey: [...WORKSPACES_QUERY_KEY, id, 'delete-plan'] as const,
    queryFn: () => api.get<WorkspaceDeletePlan>(`/api/v1/workspaces/${encodeURIComponent(id)}/delete-plan`),
    staleTime: 0,
  });
}

export const workspacesApi = {
  create: (input: { name: string; connectionIds: string[] }) => api.post<{ workspace: WorkspaceDto; first: boolean }>('/api/v1/workspaces', input),
  rename: (id: string, name: string) => api.patch<WorkspaceDto>(`/api/v1/workspaces/${encodeURIComponent(id)}`, { name }),
  reorder: (ids: string[]) => api.put<WorkspaceList>('/api/v1/workspaces/order', { ids }),
  remove: (id: string) => api.delete<{ deleted: true; shownOnlyIn: ShownOnlyIn[]; last: boolean }>(`/api/v1/workspaces/${encodeURIComponent(id)}`),
  setForConnection: (connectionId: string, workspaceIds: string[]) =>
    api.put<{ connectionId: string; workspaceIds: string[]; added: string[]; removed: string[] }>(`/api/v1/connections/${encodeURIComponent(connectionId)}/workspaces`, { workspaceIds }),
};

/** After any change: the hub's list, and this tab's menu (others follow `config-changed`). */
export async function refreshWorkspaces(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
  ]);
}
