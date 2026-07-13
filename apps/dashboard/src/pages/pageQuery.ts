/**
 * Page-config query (09-generated-app.md §2.3 loader): `GET
 * /api/v1/pages/:pageId`, keyed `['page', pageId]`. The pages routes land
 * with M4 Wave B (config interpreter + generator) — until then the stub
 * PageRenderer treats a 404 as "not generated yet" rather than an error.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

/** Opaque validated envelope — Zod validation via @adminium/engine/config
 * arrives with the Wave B PageRenderer (09-T03). */
export type PageConfigDocument = Record<string, unknown>;

export function pageQuery(pageId: string) {
  return queryOptions({
    queryKey: ['page', pageId] as const,
    queryFn: async () =>
      (await api.get<{ data: PageConfigDocument }>(`/api/v1/pages/${encodeURIComponent(pageId)}`)).data,
  });
}
