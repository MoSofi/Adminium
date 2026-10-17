// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the import-wizard resource. Mapping/options/stats
 * vocabularies come from meta's payload schemas — one authority, no drift.
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
  /**
   * Whether the first row holds the column names (`first-row`) or every row
   * is data (`none`: the columns are then named `Column 1`, `Column 2`, …).
   */
  header: z.enum(['first-row', 'none']).default('first-row'),
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
    /** What parted the fields of the text as it was sent: a file's commas, a pasted sheet's tabs, or semicolons. */
    delimiter: z.enum(['comma', 'tab', 'semicolon']).optional(),
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

// --- preview ---------------------------------------------------------------------

/** How many lines of a file one preview judges: the counts are of these, and the reply says when there are more. */
export const PREVIEW_LINE_CAP = 2000;

/** How long a preview line's `label` may be, in characters. */
export const PREVIEW_LABEL_MAX = 120;

export const importsPreviewQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

/** One line of the file as the import would treat it. */
export const previewLineView = z.object({
  /** The line's number among the file's data rows, from 1. */
  row: z.number(),
  /** `new`: a row would be made. `here`: it matches a row (updated by an `upsert`, left alone by a `skip`). `refused`: not written. */
  status: z.enum(['new', 'here', 'refused']),
  code: z.string().optional(),
  column: z.string().optional(),
  message: z.string().optional(),
  /** For a line that is `here` only because an earlier line of the same file would have made its row: that line's number. */
  earlierLine: z.number().optional(),
  /**
   * Which line of the file this is, in the file's own words: the value typed in the column the lines are matched
   * on, else the line's first mapped cell. Trimmed, at most {@link PREVIEW_LABEL_MAX} characters; absent when that
   * cell is empty. It is the requester's own upload read back to them, and nothing of the table.
   */
  label: z.string().optional(),
});
export type PreviewLineView = z.infer<typeof previewLineView>;

export const importsPreviewReply = z.object({
  data: z.object({
    /** Data rows in the file. */
    total: z.number(),
    /** How many of them were judged: at most {@link PREVIEW_LINE_CAP}. */
    judged: z.number(),
    capped: z.boolean(),
    counts: z.object({ new: z.number(), here: z.number(), refused: z.number() }),
    /** True when the table has hooks for these writes: they run when the import runs, never for a preview. */
    hooksNotRun: z.boolean(),
    lines: z.array(previewLineView),
  }),
});
