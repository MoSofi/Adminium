// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard layout-persistence client (04-widget-registry.md §6.3) — typed
 * wrappers over the two write surfaces the builder saves through:
 *
 *   PATCH  /api/v1/pages/:pageId/layout        → the SHARED default (page-edit)
 *   PUT    /api/v1/me/views/:pageId/layout      → the caller's PERSONAL override
 *   DELETE /api/v1/me/views/:pageId/layout      → reset the personal override
 *
 * Shapes mirror the server Zod replies (`apps/server/src/routes/pages/schema.ts`
 * and `.../me-views/schema.ts`). The resolved layout itself arrives through the
 * normal page document (`GET /pages/:pageId`), where the server has already
 * applied per-user-override-wins resolution — see `useResolvedLayout`.
 */

import type { PageLayout } from '@adminium/widgets/page-config';

import { api } from '../../app/api.js';

export type { PageLayout } from '@adminium/widgets/page-config';

const sharedBase = (pageId: string): string => `/api/v1/pages/${encodeURIComponent(pageId)}/layout`;
const personalBase = (pageId: string): string =>
  `/api/v1/me/views/${encodeURIComponent(pageId)}/layout`;

export const layoutApi = {
  /** Write the shared default layout every viewer sees (Admin+ / page-edit). */
  saveShared: async (pageId: string, layout: PageLayout): Promise<PageLayout> =>
    (await api.patch<{ data: { layout: PageLayout } }>(sharedBase(pageId), layout)).data.layout,

  /** Save the caller's personal rearrange (any user with page-view access). */
  savePersonal: async (pageId: string, layout: PageLayout): Promise<PageLayout> =>
    (await api.put<{ data: { layout: PageLayout } }>(personalBase(pageId), layout)).data.layout,

  /** Drop the caller's personal override — the shared default resolves again. */
  reset: async (pageId: string): Promise<void> => {
    await api.delete<{ data: { ok: true } }>(personalBase(pageId));
  },
};
