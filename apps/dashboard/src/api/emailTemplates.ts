/**
 * Email-templates client (M7-T06 Email Templates surface; 07-meta-store.md
 * §3.28 `adminium_email_templates`). Thin typed wrappers over the server's
 * email-template routes — shapes mirror the server Zod reply schemas exactly
 * (the copied-mirror convention from app/bootstrap.ts: change both together):
 *
 *   GET /api/v1/email-templates              → { items: EmailTemplateListItem[] }
 *   GET /api/v1/email-templates/:key/:locale → EmailTemplateDetail (item + blocks)
 *   PUT /api/v1/email-templates/:key/:locale → EmailTemplateListItem (upserted)
 *
 * `blocks` is the meta-store `emailBlocksSchema` payload — an ordered array of
 * open block records (packages/meta json-payloads.ts); the editor maps it onto
 * the `document-canvas` doc shape in `pages/builders/emailDoc.ts`.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../app/api.js';

export interface EmailTemplateListItem {
  id: string;
  key: string;
  locale: string;
  name: string;
  subject: string;
  enabled: boolean;
  updatedAt: number;
}

export type EmailBlock = Record<string, unknown>;

export interface EmailTemplateDetail extends EmailTemplateListItem {
  blocks: EmailBlock[];
}

export interface EmailTemplateWriteBody {
  name: string;
  subject: string;
  blocks: EmailBlock[];
  enabled: boolean;
}

const BASE = '/api/v1/email-templates';

function detailPath(key: string, locale: string): string {
  return `${BASE}/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`;
}

export const emailTemplatesApi = {
  list: async (): Promise<EmailTemplateListItem[]> =>
    (await api.get<{ items: EmailTemplateListItem[] }>(BASE)).items,

  get: (key: string, locale: string): Promise<EmailTemplateDetail> =>
    api.get<EmailTemplateDetail>(detailPath(key, locale)),

  put: (key: string, locale: string, body: EmailTemplateWriteBody): Promise<EmailTemplateListItem> =>
    api.put<EmailTemplateListItem>(detailPath(key, locale), body),
};

export function emailTemplatesQuery() {
  return queryOptions({
    queryKey: ['email-templates'] as const,
    queryFn: () => emailTemplatesApi.list(),
  });
}

export function emailTemplateQuery(key: string, locale: string) {
  return queryOptions({
    queryKey: ['email-templates', key, locale] as const,
    queryFn: () => emailTemplatesApi.get(key, locale),
  });
}
