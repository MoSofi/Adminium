// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the import-wizard resource (M7-T07, 07-meta-store.md §3.26,
 * 09-generated-app.md §11.1). Mapping/options/stats vocabularies come from
 * meta's payload schemas — one authority, no drift.
 */

import { z } from 'zod';
import {
  importMappingSchema,
  importOptionsSchema,
  importStatsSchema,
  importStatusSchema,
} from '@adminium/meta';

// --- upload -------------------------------------------------------------------

export const importsUploadQuery = z.object({
  filename: z.string().trim().min(1).max(260).default('upload.csv'),
});

export const importsUploadReply = z.object({
  data: z.object({
    fileId: z.string(),
    filename: z.string(),
    sizeBytes: z.number(),
    sha256: z.string(),
    /** Header row of the parsed CSV. */
    columns: z.array(z.string()),
    /** Up to {@link UPLOAD_SAMPLE_ROWS} data rows for the mapping preview. */
    sampleRows: z.array(z.array(z.string())),
    /** Data rows in the file (header excluded). */
    totalRows: z.number(),
  }),
});

export const UPLOAD_SAMPLE_ROWS = 20;

// --- import rows ---------------------------------------------------------------

export const importsCreateBody = z.object({
  fileId: z.string().min(1),
  connectionId: z.string().min(1),
  table: z.string().min(1),
  mapping: importMappingSchema,
  options: importOptionsSchema.default({}),
});
export type ImportsCreateBody = z.infer<typeof importsCreateBody>;

export const importIdParams = z.object({ id: z.string().min(1) });

export const importView = z.object({
  id: z.string(),
  connectionId: z.string(),
  tableName: z.string(),
  requestedBy: z.string(),
  fileId: z.string(),
  mapping: importMappingSchema,
  options: importOptionsSchema,
  status: importStatusSchema,
  stats: importStatsSchema.nullable(),
  errorReportFileId: z.string().nullable(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});
export type ImportView = z.infer<typeof importView>;

/** One validation issue row (reply capped at {@link REPORT_ISSUE_CAP}). */
export const validationIssueView = z.object({
  row: z.number(),
  column: z.string(),
  code: z.string(),
  message: z.string(),
  value: z.string(),
});
export type ValidationIssueView = z.infer<typeof validationIssueView>;

export const REPORT_ISSUE_CAP = 200;

export const validationReport = z.object({
  total: z.number(),
  valid: z.number(),
  invalid: z.number(),
  /** First {@link REPORT_ISSUE_CAP} issues; `invalid` is the true count. */
  issues: z.array(validationIssueView),
});
export type ValidationReport = z.infer<typeof validationReport>;

export const importsCreateReply = z.object({
  data: z.object({ import: importView, report: validationReport }),
});

export const importsRunReply = z.object({
  data: z.object({ import: importView, jobId: z.string() }),
});

export const importsListReply = z.object({ data: z.array(importView) });
export const importsGetReply = z.object({ data: importView });

export const importsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
