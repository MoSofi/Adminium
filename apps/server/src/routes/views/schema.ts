/**
 * Zod schemas for saved views (M5-T06, 07-meta-store.md §3.18).
 *
 * `config` is the page-crud grid state (search / sort / filters / page size /
 * visible columns). It is validated structurally but kept forward-compatible
 * (`.passthrough()`, permissive filter `op`) — the grid state is opaque config
 * like a page envelope; the data route re-validates filter grammar when a view
 * is actually applied. Shapes mirror `@adminium/widgets` `CrudSort` /
 * `CrudFilterCondition` (crud-api.ts) — change both together.
 */

import { z } from 'zod';

const viewSort = z
  .object({ column: z.string().min(1), dir: z.enum(['asc', 'desc']) })
  .nullable();

const viewFilter = z
  .object({ column: z.string().min(1), op: z.string().min(1), value: z.unknown().optional() })
  .passthrough();

/** The persisted grid-state envelope. */
export const viewConfigSchema = z
  .object({
    v: z.literal(1),
    search: z.string().max(500).optional(),
    sort: viewSort.optional(),
    filters: z.array(viewFilter).max(50).optional(),
    pageSize: z.number().int().positive().max(500).optional(),
    columns: z.array(z.string()).max(200).optional(),
  })
  .passthrough();
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const viewPageParams = z.object({ pageId: z.string().min(1) });
export const viewIdParams = z.object({ pageId: z.string().min(1), viewId: z.string().min(1) });

export const viewCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  config: viewConfigSchema,
  isDefault: z.boolean().optional(),
});
export type ViewCreateBody = z.infer<typeof viewCreateBody>;

export const viewPatchBody = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    config: viewConfigSchema.optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'empty patch' });
export type ViewPatchBody = z.infer<typeof viewPatchBody>;

export const viewView = z.object({
  id: z.string(),
  pageId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  config: z.unknown(),
  isDefault: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ViewView = z.infer<typeof viewView>;

export const viewListReply = z.object({ data: z.object({ views: z.array(viewView) }) });
export const viewReply = z.object({ data: viewView });
export const viewOkReply = z.object({ data: z.object({ ok: z.literal(true) }) });
