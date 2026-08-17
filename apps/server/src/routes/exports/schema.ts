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
