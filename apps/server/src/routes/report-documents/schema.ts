// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the report-documents resource (43-report-builder.md §3.1;
 * 43-T03). SYNC NOTE: the client-side mirror of these shapes is
 * `apps/dashboard/src/report-builder/api.ts` (type-only copy — the dashboard
 * may not import server runtime code). Change both together; the replies are
 * deliberately UN-enveloped (`{ items, counts }` / bare detail), the
 * email/invoice client's style.
 */
import { z } from 'zod';
import { reportDocumentKindSchema, reportStatusSchema, reportSummarySchema } from '@adminium/meta';

import { reportBodyInputSchema, reportBodySchema } from '../../report-documents/document.js';

/** One card / row of the manager (`ReportSummary` in api.ts). */
export const reportSummaryView = z.object({
  id: z.string(),
  kind: reportDocumentKindSchema,
  name: z.string(),
  status: reportStatusSchema,
  /** Which starter minted it; null for blank documents (43 D14). */
  starter: z.string().nullable(),
  /** The template a report was built from (43 D6); null otherwise. */
  originId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  summary: reportSummarySchema,
});
export type ReportSummaryView = z.infer<typeof reportSummaryView>;

/** Unfiltered — the comp's badges never respond to the search box (580). */
export const reportCountsView = z.object({ template: z.number(), report: z.number() });

export const reportsListQuery = z.object({ kind: reportDocumentKindSchema.optional() });

export const reportsListReply = z.object({
  items: z.array(reportSummaryView),
  counts: reportCountsView,
});

export const reportDetailView = reportSummaryView.extend({ body: reportBodySchema });
export type ReportDetailView = z.infer<typeof reportDetailView>;

export const reportIdParams = z.object({ id: z.string().min(1).max(36) });

/** A starter tile of the New modal (comp 84-95, 570-577; Appendix C). */
export const reportStarterCard = z.object({
  key: z.string(),
  name: z.string(),
  /** A category key the dashboard labels: leadership · operations · revenue · growth · finance · product · success · engineering. */
  category: z.string(),
  icon: z.string(),
  reportTitle: z.string(),
  accent: z.string(),
  blockCount: z.number(),
  /** The thumbnail's bars — the starter's first bar/line series, at most six. */
  series: z.array(z.number()),
});
export const reportStartersReply = z.object({ starters: z.array(reportStarterCard) });

export const reportCreateBody = z.object({
  kind: reportDocumentKindSchema,
  /** A starter key, or null/absent for the blank document (comp `createBlank`, 554). */
  starter: z.string().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export const reportPutBody = z.object({
  name: z.string().trim().min(1).max(120),
  status: reportStatusSchema,
  body: reportBodyInputSchema,
});
export type ReportPutBody = z.infer<typeof reportPutBody>;

/** The rename (comp `commitRename`, 562). */
export const reportPatchBody = z
  .object({ name: z.string().trim().min(1).max(120).optional() })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

/** `:id` is the template; the report takes its name unless one is given (43 D6/O3). */
export const reportFromTemplateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });
