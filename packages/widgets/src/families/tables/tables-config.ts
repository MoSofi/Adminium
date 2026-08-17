// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Config schemas for the `tables` family M4 base group (annex §3): `data-grid`,
 * `pagination-footer`, `bulk-action-toolbar`, `detail-key-value`, `mini-table`.
 * PURE module — zod, the shared config, and the (pure) `column-spec` leaf only;
 * no React and no component code.
 *
 * WHY THIS EXISTS: `registry/index.ts` statically imports `definitions.ts`, so
 * anything the definitions module imports lands in the registry's EAGER graph.
 * While these schemas lived in `./widgets.tsx`, the definitions had to reach into
 * that component module to name them, pulling every `tables` widget and its
 * @adminium/ui deps into the eager chunk and leaving the sibling
 * `lazy(() => import('./widgets.js'))` refs buying nothing (04 §2.3,
 * acceptance #3; enforced by `qa/chunk-budget.test.ts`).
 *
 * `./widgets.tsx` re-exports these symbols so existing import points stay stable.
 */
import { z } from 'zod';

import { gridColumnSpecSchema } from './column-spec.js';
import { widgetSharedConfigSchema } from '../../registry/shared-config.js';

export const dataGridConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  sortable: z.boolean().default(true),
  selectable: z.boolean().default(false),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  rowAction: z.enum(['detail', 'link', 'none']).default('detail'),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type DataGridConfig = z.infer<typeof dataGridConfigSchema>;

export const paginationFooterConfigSchema = widgetSharedConfigSchema.extend({
  pageSize: z.number().int().min(1).max(200).default(50),
  style: z.enum(['numbered', 'cursor']).default('cursor'),
});
export type PaginationFooterConfig = z.infer<typeof paginationFooterConfigSchema>;

export const bulkActionToolbarConfigSchema = widgetSharedConfigSchema.extend({
  actions: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        danger: z.boolean().optional(),
        permission: z.string().optional(),
      }),
    )
    .default([]),
});
export type BulkActionToolbarConfig = z.infer<typeof bulkActionToolbarConfigSchema>;

export const detailKeyValueConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  showTypeTags: z.boolean().default(false),
});
export type DetailKeyValueConfig = z.infer<typeof detailKeyValueConfigSchema>;

export const miniTableConfigSchema = widgetSharedConfigSchema.extend({
  columns: z.array(gridColumnSpecSchema).default([]),
  limit: z.number().int().min(1).max(6).default(5),
  viewAllHref: z.string().optional(),
});
export type MiniTableConfig = z.infer<typeof miniTableConfigSchema>;
