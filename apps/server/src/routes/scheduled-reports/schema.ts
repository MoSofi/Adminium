// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the scheduled-reports resource (M7 reports track,
 * 07-meta-store.md §3.24). Schedule/recipients/format vocabularies come from
 * meta's payload schemas — one authority, no drift.
 */
import { z } from 'zod';
import { reportFormatSchema, reportRecipientsSchema, reportScheduleSchema } from '@adminium/meta';

export const scheduledReportView = z.object({
  id: z.string(),
  pageId: z.string(),
  /** Denormalized for the list row; null when the page has vanished. */
  pageTitle: z.string().nullable(),
  pageSlug: z.string().nullable(),
  name: z.string(),
  schedule: reportScheduleSchema,
  recipients: reportRecipientsSchema,
  /** §3.24 stored INTENT (`pdf | png`); v1 delivers a CSV data snapshot. */
  format: reportFormatSchema,
  enabled: z.boolean(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ScheduledReportView = z.infer<typeof scheduledReportView>;

export const scheduledReportsCreateBody = z.object({
  pageId: z.string().min(1),
  name: z.string().min(1).max(120),
  schedule: reportScheduleSchema,
  recipients: reportRecipientsSchema.default([]),
  format: reportFormatSchema.default('pdf'),
  enabled: z.boolean().default(true),
});
export type ScheduledReportsCreateBody = z.infer<typeof scheduledReportsCreateBody>;

export const scheduledReportsPatchBody = z.object({
  pageId: z.string().min(1).optional(),
  name: z.string().min(1).max(120).optional(),
  schedule: reportScheduleSchema.optional(),
  recipients: reportRecipientsSchema.optional(),
  format: reportFormatSchema.optional(),
  enabled: z.boolean().optional(),
});
export type ScheduledReportsPatchBody = z.infer<typeof scheduledReportsPatchBody>;

export const scheduledReportIdParams = z.object({ id: z.string().min(1) });

export const scheduledReportsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const scheduledReportsListReply = z.object({ data: z.array(scheduledReportView) });
export const scheduledReportsItemReply = z.object({ data: scheduledReportView });
export const scheduledReportsDeleteReply = z.object({ data: z.object({ deleted: z.boolean() }) });
