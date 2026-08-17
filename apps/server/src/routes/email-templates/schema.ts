// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the email-templates resource (M7 builders track contract;
 * 07-meta-store.md §3.28). SYNC NOTE: the client-side mirror of these shapes
 * is `apps/dashboard/src/api/emailTemplates.ts` (type-only copy — the
 * dashboard may not import server runtime code). Change both together; the
 * replies here are deliberately UN-enveloped (`{ items }` / bare item) because
 * that client already codes against exactly these bodies.
 */
import { z } from 'zod';
import { emailBlocksSchema } from '@adminium/meta';

export const emailTemplateListItem = z.object({
  id: z.string(),
  key: z.string(),
  locale: z.string(),
  name: z.string(),
  subject: z.string(),
  enabled: z.boolean(),
  updatedAt: z.number(),
});
export type EmailTemplateListItemView = z.infer<typeof emailTemplateListItem>;

export const emailTemplatesListReply = z.object({ items: z.array(emailTemplateListItem) });

export const emailTemplateDetailReply = emailTemplateListItem.extend({
  blocks: emailBlocksSchema,
});
export type EmailTemplateDetailView = z.infer<typeof emailTemplateDetailReply>;

/**
 * `locale` is a canonical locale id. Widened from 5 to 35 chars alongside
 * migration 0012 (23-runtime-translations.md §3.5): an admin-created locale
 * may carry a script subtag, and a 5-char cap would make a custom locale
 * unable to have an email variant at all.
 */
export const emailTemplateParams = z.object({
  key: z.string().min(1).max(80),
  locale: z.string().min(2).max(35),
});

export const emailTemplatePutBody = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(300),
  blocks: emailBlocksSchema,
  enabled: z.boolean(),
});
export type EmailTemplatePutBody = z.infer<typeof emailTemplatePutBody>;
