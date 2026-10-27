// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The email-documents API client.
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

/** Why a marketing mail is sent: the consent log's purposes. */
export type EmailPurpose = 'newsletter' | 'surveys';

/** The workspace's own people (everyone, or the holders of some roles). */
export interface EmailUsersAudience {
  kind: 'users';
  roleIds?: string[] | undefined;
}

/** The people of a table an app declares (marketing mail), optionally narrowed by a saved view. */
export interface EmailTableAudience {
  kind: 'table';
  connectionId: string;
  table: string;
  viewId?: string | null | undefined;
  purpose: EmailPurpose;
  /** Also the table's existing customers, where its owner switched the basis on. */
  existingCustomers?: boolean | undefined;
}

/** Who a campaign goes to. */
export type EmailAudience = EmailUsersAudience | EmailTableAudience;

/** What a run is told to do; null on a run from before the send ledger. */
export type EmailRunState = 'running' | 'paused' | 'stopped' | 'done';

/** A campaign's latest run, as the manager shows it. */
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
  /** Absent from a server before the send ledger. */
  state?: EmailRunState | null | undefined;
  /** At most this many an hour; null = as fast as the mail server allows. */
  ratePerHour?: number | null | undefined;
  /** `marketing` for a table's people; null for the workspace's own. */
  mailClass?: 'marketing' | 'service' | null | undefined;
  basis?: 'consent' | 'existing-customers' | null | undefined;
  trackClicks?: boolean | undefined;
}

/** The refusal codes a marketing send meets (`email/sender/refusals.ts`). */
export type EmailSenderRefusal = 'no-postal-address' | 'free-mail-from' | 'dns-unchecked' | 'no-dmarc' | 'not-aligned' | 'no-public-address';

/** A table audience's breakdown: who gets it, and who is left out, each way. */
export interface EmailAudienceBreakdown {
  rows: number;
  recipients: number;
  consent: number;
  existingCustomers: number;
  doNotEmail: number;
  notAgreed: number;
  awaitingReview: number;
  notMarked: number;
  sample: number;
  reservedDomain: number;
  noAddress: number;
}

/** `POST /:id/audience/preview`. */
export interface EmailAudiencePreview {
  total: number;
  skipped: number;
  /** Placeholders no recipient's send would fill: while there is one, the send is refused. */
  unfilled?: string[] | undefined;
  /** Minutes the recipients take at the cap; null without one. */
  estimateMinutes?: number | null | undefined;
  breakdown?: EmailAudienceBreakdown | undefined;
  variables?: string[] | undefined;
  /** A table audience: what refuses the send now (empty when it may go). */
  refusals?: EmailSenderRefusal[] | undefined;
  /** The address those refusals are about. */
  sender?: string | null | undefined;
}

/** Why a table audience is refused (the preview and the send answer `AUDIENCE_REFUSED` with one). */
export type EmailAudienceRefusal =
  | 'not-people'
  | 'cannot-send'
  | 'cannot-read'
  | 'addresses-hidden'
  | 'addresses-masked'
  | 'view-gone'
  | 'view-search'
  | 'view-hidden-column'
  | 'existing-customers-off';

/** The owner's "existing customers" switch on a table. */
export interface EmailExistingCustomers {
  offered: boolean;
  on: boolean;
  at: number | null;
  by: { id: string; name: string } | null;
}

/** One table the send dialog's picker lists. */
export interface EmailAudienceTable {
  connectionId: string;
  table: string;
  label: string;
  appKey: string;
  appName: string;
  kind: 'people' | 'companies';
  consentPurpose: EmailPurpose | null;
  /** How the sender sees the table's addresses: only `readable` may be sent to. */
  addresses: 'readable' | 'masked' | 'hidden';
  existingCustomers: EmailExistingCustomers;
}

/** A people table whose e-mail sheet the person may open, switched off or not. */
export interface EmailPeopleTable {
  connectionId: string;
  table: string;
  label: string;
  appName: string;
  canEmail: boolean;
}

/** "Only these": a saved view of the table, and why it may not be used when it may not. */
export interface EmailAudienceView {
  id: string;
  name: string;
  shared: boolean;
  refused: 'view-search' | 'view-hidden-column' | null;
}

/** The first send's review: people who say yes but were ticked before records were kept. */
export interface EmailReviewList {
  purpose: EmailPurpose | null;
  total: number;
  people: { key: string; name: string; address: string; tickedBy: string | null; tickedAt: number | null }[];
}

/** `GET /email-runs/:id`: the sending bar's "120 of 470". */
export interface EmailRunProgress {
  run: EmailRunView;
  name: string | null;
  done: number;
  total: number;
  left: number;
  estimateMinutes: number | null;
}

/** The send log's state of one recipient. */
export type EmailSendState = 'queued' | 'sending' | 'sent' | 'skipped-stop' | 'skipped-consent' | 'bounced' | 'spam' | 'failed' | 'unsubscribed';

export type EmailSendLogFilter = 'all' | 'sent' | 'waiting' | 'skipped' | 'bounced' | 'spam' | 'failed' | 'unsubscribed';

export interface EmailSendLogSummary {
  total: number;
  sent: number;
  waiting: number;
  skipped: number;
  bounced: number;
  spam: number;
  failed: number;
  unsubscribed: number;
}

export interface EmailSendLogRow {
  id: string;
  seq: number;
  name: string;
  address: string;
  language: string | null;
  state: EmailSendState;
  /** A code the screen words (`not-agreed`, `notice:postmark`), or what the mail server said. */
  reason: string | null;
  /** When it was handed over or settled; null while it waits. */
  time: number | null;
  /** Handed over, and the mail queue still tries after a refusal: `reason` is the last one. */
  retrying: boolean;
  attempts: number;
  clicks: number;
}

export interface EmailSendLogPage {
  summary: EmailSendLogSummary;
  rows: EmailSendLogRow[];
  next: number | null;
}

export interface EmailBrand {
  name: string;
  /** One of the twelve shipped marks, or `logo` for the workspace's own. */
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
  /** Sent only when this variable has a value. */
  showWhen?: { var: string } | undefined;
  /** What a text or heading block says in its own place when it has none. */
  otherwise?: string | undefined;
}

/** The envelope the editor edits and the renderer reads. */
export interface EmailDocument {
  subject: string;
  preheader: string;
  blocks: EmailBlockRecord[];
  footer: string;
  brand: EmailBrand | null;
  attachments: EmailAttachment[];
}

/** What `PUT` and test-send carry — the on-screen document. */
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
  /** The assistant wrote this version and no person has saved it or said it looks right since. Absent from an older server. */
  assistantWrote?: boolean;
  archivedAt: number | null;
  updatedAt: number;
  /** A key the built-ins own — "Reset to built-in" instead of "Delete for
   * good". */
  isBuiltin: boolean;
  isBuiltinCopy: boolean;
  starter: string | null;
  brand: { accent: string; mark: string } | null;
  /** The first heading block's text, for the mini preview. */
  heading: string;
  /** The family's label — the `en_US` sibling's name, else the first sibling's.
   * */
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

/** A language variation row of the editor's menu. */
export interface EmailLanguageView {
  id: string;
  locale: string;
  needsTranslation: boolean;
  enabled: boolean;
  archived: boolean;
}

/** A fixed attachment as the inspector shows it — with the file's facts, or
 * `missing`. */
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
  /** Only the documents one installed app brought. */
  app?: string | undefined;
}

export interface EmailCreateBody {
  kind: EmailDocumentKind;
  name?: string | undefined;
  /** A starter key, or null/absent for a blank document. */
  starter?: string | null | undefined;
  locale?: string | undefined;
}

export interface EmailPutBody {
  name: string;
  category: EmailCategory;
  enabled: boolean;
  document: EmailDocumentInput;
  /** The session's structural edits, applied to every sibling in the same save.
   * */
  mirrorOps?: EmailMirrorOp[] | undefined;
}

export interface EmailPatchBody {
  name?: string | undefined;
  enabled?: boolean | undefined;
  category?: EmailCategory | undefined;
  archived?: boolean | undefined;
  /** A person has read what the assistant wrote and says it looks right. */
  reviewed?: true | undefined;
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

/** What `POST /:id/send` takes. */
export interface EmailSendBody {
  audience: EmailAudience;
  scheduleAt?: number | undefined;
  /** At most this many an hour; absent = as fast as the mail server allows. */
  ratePerHour?: number | undefined;
  /** Count clicks on a marketing send (off unless asked for). */
  trackClicks?: boolean | undefined;
}

const RUNS = '/api/v1/email-runs';
const AUDIENCE = '/api/v1/email-audience';

function logQuery(params: { filter?: EmailSendLogFilter | undefined; q?: string | undefined; after?: number | undefined; limit?: number | undefined }): string {
  const query = new URLSearchParams();
  if (params.filter !== undefined && params.filter !== 'all') query.set('filter', params.filter);
  if (params.q !== undefined && params.q.trim() !== '') query.set('q', params.q.trim());
  if (params.after !== undefined) query.set('after', String(params.after));
  if (params.limit !== undefined) query.set('limit', String(params.limit));
  const qs = query.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** The send log as a spreadsheet: a plain navigation, the session cookie rides along. */
export function sendLogCsvUrl(runId: string, params: { filter?: EmailSendLogFilter | undefined; q?: string | undefined } = {}): string {
  return `${RUNS}/${encodeURIComponent(runId)}/log.csv${logQuery(params)}`;
}

function listPath(params: EmailListParams): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  if (params.archived === true) query.set('archived', 'true');
  if (params.q !== undefined && params.q !== '') query.set('q', params.q);
  if (params.app !== undefined) query.set('app', params.app);
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
  /** A built-in key resets to the shipped copy (200 + detail); anything else is
   * gone (204 → null). */
  remove: (id: string) => api.delete<EmailDocumentDetail | null>(`${BASE}/${encodeURIComponent(id)}`),
  duplicate: (id: string) => api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/duplicate`),
  addLanguage: (id: string, locale: string) =>
    api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/languages`, { locale }),
  /** `id` is the TEMPLATE; the campaign takes its name unless one is given. */
  fromTemplate: (id: string, name?: string) =>
    api.post<EmailDocumentDetail>(`${BASE}/${encodeURIComponent(id)}/from-template`, name === undefined ? {} : { name }),
  testSend: (id: string, body: { to: string[]; document: EmailDocumentInput }) =>
    api.post<EmailTestSendReply>(`${BASE}/${encodeURIComponent(id)}/test-send`, body),
  previewAudience: (id: string, audience: EmailAudience, ratePerHour?: number | null) =>
    api.post<EmailAudiencePreview>(`${BASE}/${encodeURIComponent(id)}/audience/preview`, ratePerHour == null ? { audience } : { audience, ratePerHour }),
  send: (id: string, body: EmailSendBody) => api.post<{ run: EmailRunView }>(`${BASE}/${encodeURIComponent(id)}/send`, body),
  runs: (id: string) => api.get<{ runs: EmailRunView[] }>(`${BASE}/${encodeURIComponent(id)}/runs`),
  cancelRun: (runId: string) => api.post<{ run: EmailRunView }>(`${RUNS}/${encodeURIComponent(runId)}/cancel`),
  run: (runId: string) => api.get<EmailRunProgress>(`${RUNS}/${encodeURIComponent(runId)}`),
  pauseRun: (runId: string) => api.post<{ run: EmailRunView }>(`${RUNS}/${encodeURIComponent(runId)}/pause`),
  resumeRun: (runId: string) => api.post<{ run: EmailRunView }>(`${RUNS}/${encodeURIComponent(runId)}/resume`),
  stopRun: (runId: string) => api.post<{ run: EmailRunView; left: number }>(`${RUNS}/${encodeURIComponent(runId)}/stop`),
  sendLog: (runId: string, params: { filter?: EmailSendLogFilter | undefined; q?: string | undefined; after?: number | undefined; limit?: number | undefined } = {}) =>
    api.get<EmailSendLogPage>(`${RUNS}/${encodeURIComponent(runId)}/log${logQuery(params)}`),
  audienceTables: () => api.get<{ tables: EmailAudienceTable[] }>(`${AUDIENCE}/tables`),
  peopleTables: () => api.get<{ tables: EmailPeopleTable[] }>(`${AUDIENCE}/people-tables`),
  audienceViews: (connectionId: string, table: string) =>
    api.get<{ views: EmailAudienceView[] }>(`${AUDIENCE}/views?${new URLSearchParams({ connectionId, table }).toString()}`),
  reviewList: (connectionId: string, table: string) =>
    api.get<EmailReviewList>(`${AUDIENCE}/review?${new URLSearchParams({ connectionId, table }).toString()}`),
  answerReview: (body: { connectionId: string; table: string; key: string; answer: 'confirm' | 'leave-out' }) =>
    api.post<{ event: { id: string; state: 'yes' | 'no'; at: number } }>(`${AUDIENCE}/review/answer`, body),
  importBundle: (bundle: unknown, mode: 'skip' | 'replace') =>
    api.post<EmailImportReply>(`${BASE}/import`, { bundle, mode }),
  savedBlocks: () => api.get<{ blocks: EmailSavedBlock[] }>('/api/v1/email-blocks'),
  saveBlock: (name: string, block: Record<string, unknown>) =>
    api.post<{ block: EmailSavedBlock }>('/api/v1/email-blocks', { name, block }),
  removeSavedBlock: (id: string) => api.delete<null>(`/api/v1/email-blocks/${encodeURIComponent(id)}`),
};

/**
 * The export download's URL. A plain navigation, not `fetch`: the reply is
 * a `content-disposition: attachment` JSON file the browser saves, and the
 * session cookie rides along on its own.
 */
export function emailExportUrl(params: { kind?: EmailDocumentKind | undefined; ids?: readonly string[] | undefined } = {}): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  if (params.ids !== undefined && params.ids.length > 0) query.set('ids', params.ids.join(','));
  const qs = query.toString();
  return qs === '' ? `${BASE}/export` : `${BASE}/export?${qs}`;
}
