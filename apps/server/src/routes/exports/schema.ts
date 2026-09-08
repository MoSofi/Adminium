// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the data-exports resource (M7-T07, 07-meta-store.md §3.25,
 * 09-generated-app.md §11.2). Source/format/status vocabularies come from
 * meta's payload schemas — one authority, no drift.
 */

import { z } from 'zod';
import { exportFormatSchema, exportSourceSchema, exportStatusSchema } from '@adminium/meta';

export const exportsCreateBody = z.object({
  connectionId: z.string().min(1),
  source: exportSourceSchema,
  format: exportFormatSchema,
});
export type ExportsCreateBody = z.infer<typeof exportsCreateBody>;

export const exportIdParams = z.object({ id: z.string().min(1) });

export const exportView = z.object({
  id: z.string(),
  connectionId: z.string().nullable(),
  requestedBy: z.string(),
  source: exportSourceSchema,
  format: exportFormatSchema,
  status: exportStatusSchema,
  fileId: z.string().nullable(),
  filename: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  rowCount: z.number().nullable(),
  error: z.string().nullable(),
  jobId: z.string().nullable(),
  createdAt: z.number(),
  completedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
});
export type ExportView = z.infer<typeof exportView>;

export const exportsCreateReply = z.object({ data: exportView });
export const exportsListReply = z.object({ data: z.array(exportView) });
export const exportsGetReply = z.object({ data: exportView });

export const exportsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// --- the builder's reads (41-export-builder.md §3.1, §3.5) ------------------------------

export const exportsSourcesQuery = z.object({ connectionId: z.string().min(1) });

export const exportSourcePage = z.object({
  id: z.string(),
  title: z.string(),
  /** Length of the page's stored `columns[]`. */
  columns: z.number(),
  /** Entries carrying a `lookup` block. */
  linked: z.number(),
  /** Entries carrying a `reverse` or a `derived` block. */
  totals: z.number(),
});

export const exportSourceTable = z.object({
  id: z.string(),
  schema: z.string(),
  name: z.string(),
  label: z.string().nullable(),
  rowCountEstimate: z.number().nullable(),
  columnCount: z.number(),
  /** `table:<conn>:<table>:export`, resolved server-side. */
  canExport: z.boolean(),
  /** Pages bound to the table, any template. */
  usedBy: z.number(),
  /** The `page-crud` pages the column list can start from. */
  pages: z.array(exportSourcePage),
});

export const exportsSourcesReply = z.object({
  data: z.object({
    connection: z.object({ id: z.string(), name: z.string(), dialect: z.string() }),
    tables: z.array(exportSourceTable),
  }),
});

export const exportsViewsQuery = z.object({
  connectionId: z.string().min(1),
  table: z.string().min(1),
});

export const exportSavedView = z.object({
  id: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  name: z.string(),
  filterCount: z.number(),
  /** The view's filter list, verbatim — what a `kind: 'table'` export carries (D8). */
  filters: z.array(z.unknown()),
  /** A search term an export cannot carry; the builder warns and drops it. */
  hasSearch: z.boolean(),
  rowCount: z.number().nullable(),
});

export const exportsViewsReply = z.object({ data: z.object({ views: z.array(exportSavedView) }) });

export const exportsPreviewBody = z.object({
  connectionId: z.string().min(1),
  source: exportSourceSchema,
  format: exportFormatSchema,
  sampleRows: z.number().int().min(1).max(50).default(20),
});

export const exportPreviewColumn = z.object({
  key: z.string(),
  header: z.string(),
  kind: z.enum(['base', 'lookup', 'count', 'measure', 'field']),
  numeric: z.boolean(),
  /** Masked or refused for THIS caller. */
  masked: z.boolean(),
});

export const exportsPreviewReply = z.object({
  data: z.object({
    columns: z.array(exportPreviewColumn),
    /** The first `sampleRows` rows, each cell exactly as the file writes it. */
    rows: z.array(z.array(z.string())),
    /** The file's first lines, verbatim minus the BOM and the line terminators. */
    raw: z.array(z.string()),
    rowCount: z.number().nullable(),
    rowCountKind: z.enum(['exact', 'estimate', 'unknown']),
    estimatedBytes: z.number().nullable(),
    sampleRows: z.number(),
  }),
});
