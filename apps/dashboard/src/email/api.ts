// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email-documents API client (39-email-templates-and-campaigns.md §3.1).
 *
 * TYPE-ONLY MIRROR of `apps/server/src/routes/email-templates/schema.ts`: the
 * dashboard may not import server runtime code, so the reply shapes are
 * restated here by hand and the two files change together (the server file
 * carries the same SYNC NOTE). Replies are deliberately un-enveloped
 * (`{ items, counts }`, a bare detail) — the style the pre-39 client already
 * coded against.
 *
 * One document row = one language variation of one topic (`key`, `locale`);
 * a "template" and a "campaign" are the same row with a different `kind`.
 */
import { api } from '../app/api.js';

const BASE = '/api/v1/email-templates';

export type EmailDocumentKind = 'template' | 'campaign';
export type EmailCategory = 'transactional' | 'lifecycle' | 'marketing';
export type EmailRunStatus = 'scheduled' | 'running' | 'sent' | 'failed' | 'cancelled';

/** Who a campaign goes to (39 D11). `users` is phase 1; a table audience joins in the next wave. */
export interface EmailAudience {
  kind: 'users';
  roleIds?: string[] | undefined;
}

/** A campaign's latest run, as the manager shows it (39 D2, D12). */
export interface EmailRunView {
  id: string;
  status: EmailRunStatus;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  jobId: string | null;
  audience: EmailAudience;
  failures: { to: string; error: string }[];
  createdAt: number;
}

export interface EmailBrand {
  name: string;
  /** One of the twelve shipped marks, or `logo` for the workspace's own (39 D6). */
  mark: string;
  /** Six-digit hex. */
  accent: string;
  fromName: string;
  fromEmail: string;
}

export type EmailAttachment =
  | { id: string; kind: 'file'; fileId: string }
  | { id: string; kind: 'generated'; label: string; token: string };

/** The eight style axes of one block; an absent axis is the comp's default. */
export interface EmailBlockStyle {
  pad?: 'none' | 's' | 'm' | 'l' | undefined;
  bg?: 'none' | 'soft' | 'tint' | 'accent' | 'dark' | undefined;
  fg?: 'auto' | 'strong' | 'muted' | 'accent' | 'white' | undefined;
  size?: 's' | 'm' | 'l' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  border?: 'none' | 'thin' | 'dashed' | undefined;
  radius?: 'none' | 'md' | 'lg' | undefined;
  full?: boolean | undefined;
}

export interface EmailBlockRecord {
  id: string;
  block: string;
  data: Record<string, unknown>;
  style: EmailBlockStyle;
}

/** The envelope the editor edits and the renderer reads (39 D5). */
export interface EmailDocument {
  subject: string;
  preheader: string;
  blocks: EmailBlockRecord[];
  footer: string;
  brand: EmailBrand | null;
  attachments: EmailAttachment[];
}

/** What `PUT` and test-send carry — the on-screen document (39 D1). */
export interface EmailDocumentInput {
  subject: string;
  preheader?: string | undefined;
  blocks: Record<string, unknown>[];
  footer?: string | undefined;
  brand?: EmailBrand | null | undefined;
  attachments?: EmailAttachment[] | undefined;
}

/** One card / row of the manager. */
export interface EmailDocumentSummary {
  id: string;
  kind: EmailDocumentKind;
  key: string;
  locale: string;
  name: string;
  subject: string;
  category: EmailCategory;
  enabled: boolean;
  needsTranslation: boolean;
  archivedAt: number | null;
  updatedAt: number;
  /** A key the built-ins own — "Reset to built-in" instead of "Delete for good" (39 D4). */
  isBuiltin: boolean;
  isBuiltinCopy: boolean;
  starter: string | null;
  brand: { accent: string; mark: string } | null;
  /** The first heading block's text, for the mini preview. */
  heading: string;
  /** The family's label — the `en_US` sibling's name, else the first sibling's (39 D3). */
  topicLabel: string;
  run?: EmailRunView | undefined;
}

export interface EmailCounts {
  template: number;
  campaign: number;
  archived: number;
}

export interface EmailDocumentsListReply {
  items: EmailDocumentSummary[];
  counts: EmailCounts;
}

/** A language variation row of the editor's menu (39 D3). */
export interface EmailLanguageView {
  id: string;
  locale: string;
  needsTranslation: boolean;
  enabled: boolean;
  archived: boolean;
}

/** A fixed attachment as the inspector shows it — with the file's facts, or `missing` (39 D8). */
export interface EmailAttachmentResolved {
  id: string;
  fileId: string;
  filename: string;
  sizeBytes: number;
  mime: string;
  missing: boolean;
}

export interface EmailDocumentDetail extends EmailDocumentSummary {
  document: EmailDocument;
  vars: string[];
  languages: EmailLanguageView[];
  attachmentsResolved: EmailAttachmentResolved[];
}

export interface EmailStarterCard {
  key: string;
  name: string;
  category: EmailCategory;
  icon: string;
  accent: string;
  heading: string;
}

export interface EmailSavedBlock {
  id: string;
  name: string;
  block: Record<string, unknown>;
  createdAt: number;
}

export type EmailMirrorOp =
  | { kind: 'insert'; index: number; block: Record<string, unknown> }
  | { kind: 'delete'; index: number }
  | { kind: 'move'; from: number; to: number };

export interface EmailListParams {
  kind?: EmailDocumentKind | undefined;
  archived?: boolean | undefined;
  q?: string | undefined;
}

export interface EmailCreateBody {
  kind: EmailDocumentKind;
  name?: string | undefined;
  /** A starter key, or null/absent for a blank document (39 D10). */
  starter?: string | null | undefined;
  locale?: string | undefined;
}

export interface EmailPutBody {
  name: string;
  category: EmailCategory;
  enabled: boolean;
  document: EmailDocumentInput;
  /** The session's structural edits, applied to every sibling in the same save (39 D1). */
  mirrorOps?: EmailMirrorOp[] | undefined;
}

export interface EmailPatchBody {
  name?: string | undefined;
  enabled?: boolean | undefined;
  category?: EmailCategory | undefined;
  archived?: boolean | undefined;
}

export interface EmailTestSendReply {
  queued: number;
  locale: string;
}

export interface EmailImportReply {
  created: number;
  replaced: number;
  skipped: number;
  errors: { key: string; locale: string; reason: string }[];
}

function listPath(params: EmailListParams): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  if (params.archived === true) query.set('archived', 'true');
  if (params.q !== undefined && params.q !== '') query.set('q', params.q);
  const qs = query.toString();
  return qs === '' ? BASE : `${BASE}?${qs}`;
}

export const emailApi = {
  list: (params: EmailListParams = {}) => api.get<EmailDocumentsListReply>(listPath(params)),
  detail: (id: string) => api.get<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}`),
  starters: () => api.get<{ starters: EmailStarterCard[] }>(`${BASE}/starters`),
  create: (body: EmailCreateBody) => api.post<EmailDocumentDetail>(BASE, body),
  save: (id: string, body: EmailPutBody) =>
    api.put<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}`, body),
  patch: (id: string, body: EmailPatchBody) =>
    api.patch<EmailDocumentSummary>(`${BASE}/${encodeURIComponent(id)}`, body),
  /** A built-in key resets to the shipped copy (200 + detail); anything else is gone (204 → null) (39 D4). */
  remove: (id: string) => api.delete<EmailDocumentDetail | null>(`${BASE}/${encodeURIComponent(id)}`),
  duplicate: (id: string) => api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/duplicate`),
  addLanguage: (id: string, locale: string) =>
    api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/languages`, { locale }),
  /** `id` is the TEMPLATE; the campaign takes its name unless one is given. */
  fromTemplate: (id: string, name?: string) =>
    api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/from-template`, name === undefined ? {} : { name }),
  testSend: (id: string, body: { to: string[]; document: EmailDocumentInput }) =>
    api.post<EmailTestSendReply>(`${BASE}/${encodeURIComponent(id)}/test-send`, body),
  previewAudience: (id: string, audience: EmailAudience) =>
    api.post<{ total: number; skipped: number }>(`${BASE}/${encodeURIComponent(id)}/audience/preview`, { audience }),
  send: (id: string, body: { audience: EmailAudience; scheduleAt?: number | undefined }) =>
    api.post<{ run: EmailRunView }>(`${BASE}/${encodeURIComponent(id)}/send`, body),
  runs: (id: string) => api.get<{ runs: EmailRunView[] }>(`${BASE}/${encodeURIComponent(id)}/runs`),
  cancelRun: (runId: string) => api.post<{ run: EmailRunView }>(`/api/v1/email-runs/${encodeURIComponent(runId)}/cancel`),
  importBundle: (bundle: unknown, mode: 'skip' | 'replace') =>
    api.post<EmailImportReply>(`${BASE}/import`, { bundle, mode }),
  savedBlocks: () => api.get<{ blocks: EmailSavedBlock[] }>('/api/v1/email-blocks'),
  saveBlock: (name: string, block: Record<string, unknown>) =>
    api.post<{ block: EmailSavedBlock }>('/api/v1/email-blocks', { name, block }),
  removeSavedBlock: (id: string) => api.delete<null>(`/api/v1/email-blocks/${encodeURIComponent(id)}`),
};

/**
 * The export download's URL (39 D14). A plain navigation, not `fetch`: the
 * reply is a `content-disposition: attachment` JSON file the browser saves,
 * and the session cookie rides along on its own.
 */
export function emailExportUrl(params: { kind?: EmailDocumentKind | undefined; ids?: readonly string[] | undefined } = {}): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  if (params.ids !== undefined && params.ids.length > 0) query.set('ids', params.ids.join(','));
  const qs = query.toString();
  return qs === '' ? `${BASE}/export` : `${BASE}/export?${qs}`;
}
