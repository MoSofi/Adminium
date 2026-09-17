// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The invoices API client.
 *
 * TYPE-ONLY MIRROR of `apps/server/src/routes/invoices/schema.ts`: the
 * dashboard may not import server runtime code, so the reply shapes are
 * restated here by hand and the two files change together (the server file
 * carries the same SYNC NOTE). Replies are un-enveloped (`{ items, counts }`,
 * a bare detail) — the email client's style.
 *
 * One row = one template OR one invoice (`kind`); a language variation is
 * another row with the same `topic` and a different `lang` (the comp's
 * `addLangVariant`, 1237-1253).
 */
import { api } from '../app/api.js';
import type { InvoiceBody, InvoiceDocumentKind, InvoiceStatus, InvoiceTopic } from './model/envelope.js';
import type { InvoiceLang } from './model/languages.js';

const BASE = '/api/v1/invoices';

export type { InvoiceBody, InvoiceDocumentKind, InvoiceStatus, InvoiceTopic } from './model/envelope.js';
export type { InvoiceLang } from './model/languages.js';

/**
 * What the manager's card and row read without decoding the body: written
 * by the server on every save.
 */
export interface InvoiceSummaryFacts {
  number: string;
  customerName: string;
  /** The sheet's title word — RECEIPT picks the receipt glyph (comp 1435). */
  title: string;
  logoText: string;
  logoIcon: string;
  accent: string;
  currency: string;
  cents: boolean;
  /** The ladder's total in integer minor units (the money law). */
  totalMinor: number;
  /** How many line items — the thumbnail draws up to three rows (comp 1432). */
  itemCount: number;
}

/** One card / row of the manager. */
export interface InvoiceSummary {
  id: string;
  kind: InvoiceDocumentKind;
  name: string;
  status: InvoiceStatus;
  topic: InvoiceTopic;
  lang: InvoiceLang;
  /** Which starter minted it; null for blank documents. */
  starter: string | null;
  /** The template an invoice was built from; null otherwise. */
  originId: string | null;
  createdAt: number;
  updatedAt: number;
  summary: InvoiceSummaryFacts;
}

export interface InvoiceCounts {
  /** Unfiltered — the comp's badges never respond to the search box (1423). */
  template: number;
  invoice: number;
}

export interface InvoiceListReply {
  items: InvoiceSummary[];
  counts: InvoiceCounts;
}

/** A sibling in the same topic, for the language menu (comp 1622-1634). */
export interface InvoiceLanguageView {
  id: string;
  lang: InvoiceLang;
  name: string;
  status: InvoiceStatus;
}

export interface InvoiceDetail extends InvoiceSummary {
  body: InvoiceBody;
  /** Every document of this kind sharing the topic, this one included, in the comp's language order. */
  languages: InvoiceLanguageView[];
}

/** A starter tile of the New modal (comp 1406-1413, Appendix G). */
export interface InvoiceStarterCard {
  key: string;
  name: string;
  /** A category key the dashboard labels: business · payments · adjustments · sales · recurring · services · projects · shipping · nonprofit. */
  category: string;
  icon: string;
  title: string;
  accent: string;
}

export interface InvoiceListParams {
  kind?: InvoiceDocumentKind | undefined;
}

export interface InvoiceCreateBody {
  kind: InvoiceDocumentKind;
  /** A starter key, or null/absent for the blank document (comp `createBlank`, 1383). */
  starter?: string | null | undefined;
  name?: string | undefined;
}

export interface InvoicePutBody {
  name: string;
  status: InvoiceStatus;
  topic: InvoiceTopic;
  lang: InvoiceLang;
  body: InvoiceBody;
}

export interface InvoicePatchBody {
  name?: string | undefined;
}

function listPath(params: InvoiceListParams): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  const qs = query.toString();
  return qs === '' ? BASE : `${BASE}?${qs}`;
}

export const invoicesApi = {
  list: (params: InvoiceListParams = {}) => api.get<InvoiceListReply>(listPath(params)),
  detail: (id: string) => api.get<InvoiceDetail>(`${BASE}/${encodeURIComponent(id)}`),
  starters: () => api.get<{ starters: InvoiceStarterCard[] }>(`${BASE}/starters`),
  create: (body: InvoiceCreateBody) => api.post<InvoiceDetail>(BASE, body),
  save: (id: string, body: InvoicePutBody) => api.put<InvoiceDetail>(`${BASE}/${encodeURIComponent(id)}`, body),
  patch: (id: string, body: InvoicePatchBody) => api.patch<InvoiceSummary>(`${BASE}/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<null>(`${BASE}/${encodeURIComponent(id)}`),
  /** Lands directly after its source as "{name} (copy)", status draft (comp 1384). */
  duplicate: (id: string) => api.post<InvoiceDetail>(`${BASE}/${encodeURIComponent(id)}/duplicate`),
  /** A linked copy under the same topic; 409 with `existingId` when that language already exists (comp 1242-1243). */
  addLanguage: (id: string, lang: InvoiceLang) => api.post<InvoiceDetail>(`${BASE}/${encodeURIComponent(id)}/languages`, { lang }),
  /** `id` is the TEMPLATE; the invoice records it as `originId`. */
  fromTemplate: (id: string, name?: string) =>
    api.post<InvoiceDetail>(`${BASE}/${encodeURIComponent(id)}/from-template`, name === undefined ? {} : { name }),
};
