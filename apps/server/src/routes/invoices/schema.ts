// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the invoice-documents resource (34-invoices-add-on.md
 * §3.9; 34-T46). SYNC NOTE: the client-side mirror of these shapes is
 * `apps/dashboard/src/invoices/api.ts` (type-only copy — the dashboard may
 * not import server runtime code). Change both together; the replies are
 * deliberately UN-enveloped (`{ items, counts }` / bare detail), the email
 * client's style.
 */
import { z } from 'zod';
import { invoiceDocumentKindSchema, invoiceLangSchema, invoiceStatusSchema, invoiceSummarySchema, invoiceTopicSchema } from '@adminium/meta';

import { invoiceBodyInputSchema, invoiceBodySchema } from '../../invoices/document.js';

/** One card / row of the manager (`InvoiceSummary` in api.ts). */
export const invoiceSummaryView = z.object({
  id: z.string(),
  kind: invoiceDocumentKindSchema,
  name: z.string(),
  status: invoiceStatusSchema,
  topic: invoiceTopicSchema,
  lang: invoiceLangSchema,
  /** Which starter minted it; null for blank documents. */
  starter: z.string().nullable(),
  /** The template an invoice was built from (34 O20); null otherwise. */
  originId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  summary: invoiceSummarySchema,
});
export type InvoiceSummaryView = z.infer<typeof invoiceSummaryView>;

/** Unfiltered — the comp's badges never respond to the search box (1423). */
export const invoiceCountsView = z.object({ template: z.number(), invoice: z.number() });

export const invoicesListQuery = z.object({ kind: invoiceDocumentKindSchema.optional() });

export const invoicesListReply = z.object({
  items: z.array(invoiceSummaryView),
  counts: invoiceCountsView,
});

/** A sibling in the same topic, for the language menu (comp 1622-1634). */
export const invoiceLanguageView = z.object({
  id: z.string(),
  lang: invoiceLangSchema,
  name: z.string(),
  status: invoiceStatusSchema,
});

export const invoiceDetailView = invoiceSummaryView.extend({
  body: invoiceBodySchema,
  /** Every document of this kind sharing the topic, this one included, in the comp's language order. */
  languages: z.array(invoiceLanguageView),
});
export type InvoiceDetailView = z.infer<typeof invoiceDetailView>;

export const invoiceIdParams = z.object({ id: z.string().min(1).max(36) });

/** A starter tile of the New modal (comp 1406-1413, Appendix G). */
export const invoiceStarterCard = z.object({
  key: z.string(),
  name: z.string(),
  /** A category key the dashboard labels: business · payments · adjustments · sales · recurring · services · projects · shipping · nonprofit. */
  category: z.string(),
  icon: z.string(),
  title: z.string(),
  accent: z.string(),
});
export const invoiceStartersReply = z.object({ starters: z.array(invoiceStarterCard) });

export const invoiceCreateBody = z.object({
  kind: invoiceDocumentKindSchema,
  /** A starter key, or null/absent for the blank document (comp `createBlank`, 1383). */
  starter: z.string().max(40).nullable().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

export const invoicePutBody = z.object({
  name: z.string().trim().min(1).max(120),
  status: invoiceStatusSchema,
  topic: invoiceTopicSchema,
  lang: invoiceLangSchema,
  body: invoiceBodyInputSchema,
});
export type InvoicePutBody = z.infer<typeof invoicePutBody>;

/** The rename (comp `commitRename`, 1391). */
export const invoicePatchBody = z
  .object({ name: z.string().trim().min(1).max(120).optional() })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

/** One of the six document languages — checked in the route so the 422 names it. */
export const invoiceAddLanguageBody = z.object({ lang: z.string().min(2).max(8) });

/** `:id` is the template; the invoice takes its name unless one is given (34 O20). */
export const invoiceFromTemplateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });
