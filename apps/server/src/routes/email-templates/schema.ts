// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the email-documents resource (39-email-templates-and-
 * campaigns.md). SYNC NOTE: the client-side mirror of these shapes is
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
  emailRunStateSchema,
  emailRunStatusSchema,
  emailRunBasisSchema,
  emailRunClassSchema,
  emailSendStateSchema,
} from '@adminium/meta';

import { emailDocumentInputSchema, emailDocumentSchema } from '../../email/document.js';

/** A campaign's latest run, as the manager shows it. */
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
  /** What the run is told to do (running, paused, stopped, done); null on a run from before the ledger. */
  state: emailRunStateSchema.nullable(),
  /** At most this many an hour; null = as fast as the mail server allows. */
  ratePerHour: z.number().int().nullable(),
  /** Marketing (a table's people) or none (the workspace's own people). */
  mailClass: emailRunClassSchema.nullable(),
  /** The ground a marketing run stands on: consent, or consent and existing customers. */
  basis: emailRunBasisSchema.nullable(),
  /** Whether the run counts clicks. */
  trackClicks: z.boolean(),
});
export type EmailRunView = z.infer<typeof emailRunView>;

/** One card / row of the manager (`EmailDocumentSummary`). */
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
  /** The assistant wrote this version and no person has saved it or said it looks right since. */
  assistantWrote: z.boolean(),
  archivedAt: z.number().nullable(),
  updatedAt: z.number(),
  /** A key the built-ins own — "Reset to built-in" instead of "Delete for
   * good". */
  isBuiltin: z.boolean(),
  isBuiltinCopy: z.boolean(),
  starter: z.string().nullable(),
  brand: z.object({ accent: z.string(), mark: z.string() }).nullable(),
  /** The first heading block's text, for the mini preview. */
  heading: z.string(),
  /** The family's label — the `en_US` sibling's name, else the first sibling's.
   * */
  topicLabel: z.string(),
  run: emailRunView.optional(),
});
export type EmailDocumentSummaryView = z.infer<typeof emailDocumentSummary>;

export const emailDocumentsListQuery = z.object({
  kind: emailDocumentKindSchema.optional(),
  archived: z.coerce.boolean().optional(),
  q: z.string().max(200).optional(),
  /**
   * Only the documents one installed app brought (its key). It narrows the
   * list this reader would get without it, and the counts with it; a key no
   * app holds answers an empty list.
   */
  app: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/, 'an app key').optional(),
});

export const emailDocumentsListReply = z.object({
  items: z.array(emailDocumentSummary),
  counts: z.object({ template: z.number(), campaign: z.number(), archived: z.number() }),
});

/** A language variation row of the editor's menu. */
export const emailLanguageView = z.object({
  id: z.string(),
  locale: z.string(),
  needsTranslation: z.boolean(),
  enabled: z.boolean(),
  archived: z.boolean(),
});

/** A fixed attachment as the inspector shows it — with the file's facts, or
 * `missing`. */
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
 * migration 0012: an admin-created locale
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
  /** A starter key, or null/absent for a blank document. */
  starter: z.string().max(40).nullable().optional(),
  locale: z.string().min(2).max(35).optional(),
});

export const emailAddLanguageBody = z.object({ locale: z.string().min(2).max(35) });

/** `:id` is the template; the campaign takes its name unless one is given. */
export const emailFromTemplateBody = z.object({ name: z.string().trim().min(1).max(120).optional() });

export const emailPutBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: emailCategorySchema,
  enabled: z.boolean(),
  document: emailDocumentInputSchema,
  /** The session's structural edits, applied to every sibling in the same save.
   * */
  mirrorOps: emailMirrorOpsSchema.optional(),
});
export type EmailPutBody = z.infer<typeof emailPutBody>;

export const emailPatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    category: emailCategorySchema.optional(),
    archived: z.boolean().optional(),
    /** A person has read what the assistant wrote and says it looks right. Only `true` means anything. */
    reviewed: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'nothing to change');

/**
 * Addresses to send the sample to. Deliberately NOT `z.string().email()`: the
 * repo validates addresses the same loose way `POST /users` does, and the SMTP
 * relay is the real authority on what it will accept. The document is the
 * ON-SCREEN one — a test send never reads the stored row.
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

/** Bundle v1. */
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

// --- campaigns
// ------------------------------------------------------------------

/** "At most N an hour": a whole number of messages; absent or null = as fast as the mail server allows. */
export const EMAIL_RATE_MAX = 100_000;
const ratePerHour = z.number().int().min(1).max(EMAIL_RATE_MAX).nullable().optional();

export const emailAudiencePreviewBody = z.object({ audience: emailAudienceSchema, ratePerHour });
export const emailAudiencePreviewReply = z.object({
  total: z.number().int(),
  skipped: z.number().int(),
  /** The placeholders no recipient's send would fill; while there is one, the send is refused. */
  unfilled: z.array(z.string()),
  /** How long the people who get it take at `ratePerHour`, in minutes; null without a cap. */
  estimateMinutes: z.number().int().nullable(),
  /** A table audience: who gets it and who is left out, each way (`email/audience-table.ts`). */
  breakdown: z
    .object({
      rows: z.number().int(),
      recipients: z.number().int(),
      consent: z.number().int(),
      existingCustomers: z.number().int(),
      doNotEmail: z.number().int(),
      notAgreed: z.number().int(),
      awaitingReview: z.number().int(),
      notMarked: z.number().int(),
      sample: z.number().int(),
      reservedDomain: z.number().int(),
      noAddress: z.number().int(),
    })
    .optional(),
  /** A table audience: the placeholders it fills besides the four every campaign gives (its columns the sender reads). */
  variables: z.array(z.string()).optional(),
});

export const emailSendBody = z.object({
  audience: emailAudienceSchema,
  /** Epoch ms; absent = now. Never in the past by more than a minute. */
  scheduleAt: z.number().int().positive().optional(),
  ratePerHour,
  /** Count clicks (signed links) on a marketing send; off unless asked for. */
  trackClicks: z.boolean().optional(),
});
export const emailSendReply = z.object({ run: emailRunView });
export const emailRunsReply = z.object({ runs: z.array(emailRunView) });
export const emailRunCancelReply = z.object({ run: emailRunView });

/** One run, as the sending bar shows it: "Sending · 120 of 470", and how long the rest takes. */
export const emailRunProgressReply = z.object({
  run: emailRunView,
  /** The campaign's name when the run started (its own after it was deleted); null before it started. */
  name: z.string().nullable(),
  /** Recipients handed over or settled, and all of them. */
  done: z.number().int(),
  total: z.number().int(),
  /** Not yet handed over: what "stop for good" would leave unsent. */
  left: z.number().int(),
  /** Minutes the rest takes at the run's cap; null without one, or with nobody left. */
  estimateMinutes: z.number().int().nullable(),
});

export const emailRunMoveReply = z.object({ run: emailRunView });
export const emailRunStopReply = z.object({
  run: emailRunView,
  /** How many people will not get it. */
  left: z.number().int(),
});

/** The send log's filters (comp E1.11): all, or one group of states. */
export const emailSendLogFilter = z.enum(['all', 'sent', 'waiting', 'skipped', 'bounced', 'spam', 'failed', 'unsubscribed']);

export const emailSendLogQuery = z.object({
  filter: emailSendLogFilter.optional(),
  /** Part of a name or an address. */
  q: z.string().max(200).optional(),
  /** The `seq` of the last row of the page before. */
  after: z.coerce.number().int().min(-1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const emailSendLogCsvQuery = emailSendLogQuery.omit({ after: true, limit: true });

export const emailSendLogSummary = z.object({
  total: z.number().int(),
  sent: z.number().int(),
  waiting: z.number().int(),
  skipped: z.number().int(),
  bounced: z.number().int(),
  spam: z.number().int(),
  failed: z.number().int(),
  unsubscribed: z.number().int(),
});

export const emailSendLogRow = z.object({
  id: z.string(),
  seq: z.number().int(),
  name: z.string(),
  address: z.string(),
  language: z.string().nullable(),
  state: emailSendStateSchema,
  /** A code the screen words (`campaign-mail-off`), or what the mail server said. */
  reason: z.string().nullable(),
  /** When it was handed over, or settled; null while it waits. */
  time: z.number().nullable(),
  /** Handed over, and the mail queue is still trying after a refusal: `reason` is the last one. */
  retrying: z.boolean(),
  attempts: z.number().int(),
  clicks: z.number().int(),
});
export type EmailSendLogRowView = z.infer<typeof emailSendLogRow>;

export const emailSendLogReply = z.object({
  summary: emailSendLogSummary,
  rows: z.array(emailSendLogRow),
  /** The `after` of the next page; null on the last. */
  next: z.number().int().nullable(),
});
