// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the email-documents resource (39-email-templates-and-
 * campaigns.md §3.1). SYNC NOTE: the client-side mirror of these shapes is
 * `apps/dashboard/src/email/api.ts` (type-only copy — the dashboard may not
 * import server runtime code). Change both together; the replies are
 * deliberately UN-enveloped (`{ items, counts }` / bare detail) because the
 * pre-39 client already coded against exactly that style.
 */
import { z } from 'zod';
import {
  emailAttachmentsSchema,
  emailAudienceSchema,
  emailBrandSchema,
  emailCategorySchema,
  emailDocumentKindSchema,
  emailMirrorOpsSchema,
  emailRunStatusSchema,
} from '@adminium/meta';

import { emailDocumentInputSchema, emailDocumentSchema } from '../../email/document.js';

/** A campaign's latest run, as the manager shows it (39 D2, D12). */
export const emailRunView = z.object({
  id: z.string(),
  status: emailRunStatusSchema,
  total: z.number(),
  sent: z.number(),
  failed: z.number(),
  skipped: z.number(),
  scheduledAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  jobId: z.string().nullable(),
  audience: emailAudienceSchema,
  failures: z.array(z.object({ to: z.string(), error: z.string() })),
  createdAt: z.number(),
});
export type EmailRunView = z.infer<typeof emailRunView>;

/** One card / row of the manager (39 §3.1 `EmailDocumentSummary`). */
export const emailDocumentSummary = z.object({
  id: z.string(),
  kind: emailDocumentKindSchema,
  key: z.string(),
  locale: z.string(),
  name: z.string(),
  subject: z.string(),
  category: emailCategorySchema,
  enabled: z.boolean(),
  needsTranslation: z.boolean(),
  archivedAt: z.number().nullable(),
  updatedAt: z.number(),
  /** A key the built-ins own — "Reset to built-in" instead of "Delete for good" (39 D4). */
  isBuiltin: z.boolean(),
  isBuiltinCopy: z.boolean(),
  starter: z.string().nullable(),
  brand: z.object({ accent: z.string(), mark: z.string() }).nullable(),
  /** The first heading block's text, for the mini preview. */
  heading: z.string(),
  /** The family's label — the `en_US` sibling's name, else the first sibling's (39 D3). */
  topicLabel: z.string(),
  run: emailRunView.optional(),
});
export type EmailDocumentSummaryView = z.infer<typeof emailDocumentSummary>;

export const emailDocumentsListQuery = z.object({
  kind: emailDocumentKindSchema.optional(),
  archived: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
});

export const emailDocumentsListReply = z.object({
  items: z.array(emailDocumentSummary),
  counts: z.object({ template: z.number(), campaign: z.number(), archived: z.number() }),
});

/** A language variation row of the editor's menu (39 D3). */
export const emailLanguageView = z.object({
  id: z.string(),
  locale: z.string(),
  needsTranslation: z.boolean(),
  enabled: z.boolean(),
  archived: z.boolean(),
});

/** A fixed attachment as the inspector shows it — with the file's facts, or `missing` (39 D8). */
export const emailAttachmentResolvedView = z.object({
  id: z.string(),
  fileId: z.string(),
  filename: z.string(),
  sizeBytes: z.number(),
  mime: z.string(),
  missing: z.boolean(),
});

export const emailDocumentDetail = emailDocumentSummary.extend({
  document: emailDocumentSchema,
  vars: z.array(z.string()),
  languages: z.array(emailLanguageView),
  attachmentsResolved: z.array(emailAttachmentResolvedView),
});
export type EmailDocumentDetailView = z.infer<typeof emailDocumentDetail>;

export const emailIdParams = z.object({ id: z.string().min(1).max(36) });

/**
 * `locale` is a canonical locale id. Widened from 5 to 35 chars alongside
 * migration 0012 (23-runtime-translations.md §3.5): an admin-created locale
 * may carry a script subtag, and a 5-char cap would make a custom locale
 * unable to have an email variant at all.
 */
export const emailKeyLocaleParams = z.object({
  key: z.string().min(1).max(80),
  locale: z.string().min(2).max(35),
});

export const emailStarterCard = z.object({
  key: z.string(),
  name: z.string(),
  category: emailCategorySchema,
  icon: z.string(),
  accent: z.string(),
  heading: z.string(),
});
export const emailStartersReply = z.object({ starters: z.array(emailStarterCard) });

export const emailCreateBody = z.object({
  kind: emailDocumentKindSchema,
  name: z.string().trim().min(1).max(120).optional(),
  /** A starter key, or null/absent for a blank document (39 D10). */
  starter: z.string().max(40).nullable().optional(),
  locale: z.string().min(2).max(35).optional(),
});

export const emailAddLanguageBody = z.object({ locale: z.string().min(2).max(35) });

/** `:id` is the template; the campaign takes its name unless one is given (39 D21). */
export const emailFromTemplateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

export const emailPutBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: emailCategorySchema,
  enabled: z.boolean(),
  document: emailDocumentInputSchema,
  /** The session's structural edits, applied to every sibling in the same save (39 D1). */
  mirrorOps: emailMirrorOpsSchema.optional(),
});
export type EmailPutBody = z.infer<typeof emailPutBody>;

export const emailPatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    category: emailCategorySchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

/**
 * Addresses to send the sample to. Deliberately NOT `z.string().email()`: the
 * repo validates addresses the same loose way `POST /users` does, and the SMTP
 * relay is the real authority on what it will accept. The document is the
 * ON-SCREEN one — a test send never reads the stored row (39 D1).
 */
export const emailTestSendBody = z.object({
  to: z.array(z.string().trim().min(3).max(320)).min(1).max(10),
  document: emailDocumentInputSchema,
});

export const emailTestSendReply = z.object({
  queued: z.number().int(),
  /** Which locale was rendered — the document's own. */
  locale: z.string(),
});

export const emailExportQuery = z.object({
  kind: emailDocumentKindSchema.optional(),
  /** Comma-separated ids; absent = every live document of `kind` (or all). */
  ids: z.string().max(4000).optional(),
});

/** Bundle v1 (39 D14). */
export const emailBundleDocument = z.object({
  kind: emailDocumentKindSchema,
  key: z.string().min(1).max(80),
  locale: z.string().min(2).max(35),
  name: z.string().min(1).max(120),
  category: emailCategorySchema,
  starter: z.string().max(40).nullable(),
  subject: z.string().max(300),
  preheader: z.string().max(300),
  blocks: z.array(z.record(z.string(), z.unknown())).max(200),
  footer: z.string().max(2000),
  brand: emailBrandSchema.nullable(),
  /** Generated attachments travel by token; fixed ones inline as base64 (up to the cap). */
  attachments: emailAttachmentsSchema,
  files: z
    .array(
      z.object({
        /** The document's attachment id this file belongs to. */
        attachmentId: z.string().min(1).max(40),
        filename: z.string().min(1).max(255),
        mime: z.string().min(1).max(200),
        sha256: z.string().length(64),
        base64: z.string(),
      }),
    )
    .max(20),
});

export const emailBundle = z.object({
  adminium: z.object({ kind: z.literal('email-templates'), version: z.literal(1) }),
  documents: z.array(emailBundleDocument).max(500),
});
export type EmailBundle = z.infer<typeof emailBundle>;

export const emailImportBody = z.object({
  bundle: emailBundle,
  mode: z.enum(['skip', 'replace']),
});

export const emailImportReply = z.object({
  created: z.number().int(),
  replaced: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ key: z.string(), locale: z.string(), reason: z.string() })),
});

export const savedBlockView = z.object({
  id: z.string(),
  name: z.string(),
  block: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
});
export const savedBlocksListReply = z.object({ blocks: z.array(savedBlockView) });
export const savedBlockCreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  block: z.record(z.string(), z.unknown()),
});
export const savedBlockDetailReply = z.object({ block: savedBlockView });

// --- campaigns (39 D11) ------------------------------------------------------------------

export const emailAudiencePreviewBody = z.object({ audience: emailAudienceSchema });
export const emailAudiencePreviewReply = z.object({ total: z.number().int(), skipped: z.number().int() });

export const emailSendBody = z.object({
  audience: emailAudienceSchema,
  /** Epoch ms; absent = now. Never in the past by more than a minute. */
  scheduleAt: z.number().int().positive().optional(),
});
export const emailSendReply = z.object({ run: emailRunView });
export const emailRunsReply = z.object({ runs: z.array(emailRunView) });
export const emailRunCancelReply = z.object({ run: emailRunView });
