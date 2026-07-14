/**
 * Saved-views client (M5-T06) — typed wrappers over the views CRUD endpoints.
 * Shapes mirror the server Zod reply (`apps/server/src/routes/views/schema.ts`)
 * and the `@adminium/widgets` grid-state types — change them together.
 */

import type { CrudFilterCondition, CrudSort } from '@adminium/widgets';

import { api } from '../../app/api.js';

/** Persisted page-crud grid state. */
export interface ViewConfig {
  v: 1;
  search?: string;
  sort?: CrudSort | null;
  filters?: CrudFilterCondition[];
  pageSize?: number;
  columns?: string[];
}

export interface SavedView {
  id: string;
  pageId: string;
  userId: string | null;
  name: string;
  config: ViewConfig;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ViewWriteBody {
  name: string;
  config: ViewConfig;
  isDefault?: boolean;
}

const base = (pageId: string): string => `/api/v1/pages/${encodeURIComponent(pageId)}/views`;

export const viewsApi = {
  list: async (pageId: string): Promise<SavedView[]> =>
    (await api.get<{ data: { views: SavedView[] } }>(base(pageId))).data.views,

  create: async (pageId: string, body: ViewWriteBody): Promise<SavedView> =>
    (await api.post<{ data: SavedView }>(base(pageId), body)).data,

  update: async (
    pageId: string,
    viewId: string,
    patch: { name?: string; config?: ViewConfig; isDefault?: boolean },
  ): Promise<SavedView> =>
    (await api.patch<{ data: SavedView }>(`${base(pageId)}/${encodeURIComponent(viewId)}`, patch)).data,

  remove: async (pageId: string, viewId: string): Promise<void> => {
    await api.delete<{ data: { ok: true } }>(`${base(pageId)}/${encodeURIComponent(viewId)}`);
  },
};
