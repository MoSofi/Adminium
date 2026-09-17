// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The report-builder API client.
 *
 * TYPE-ONLY MIRROR of `apps/server/src/routes/report-documents/schema.ts`:
 * the dashboard may not import server runtime code, so the reply shapes are
 * restated here by hand and the two files change together (the server file
 * carries the same SYNC NOTE). Replies are un-enveloped (`{ items, counts }`,
 * a bare detail) — the email/invoice client's style.
 *
 * One row = one report template OR one report (`kind`). NOT
 * `/api/v1/scheduled-reports`, which is a different feature
 * (trap 1).
 */
import { api } from '../app/api.js';
import type { ReportBody, ReportDocumentKind, ReportStatus } from './model/envelope.js';

const BASE = '/api/v1/report-documents';

export type { ReportBody, ReportDocumentKind, ReportStatus } from './model/envelope.js';

/**
 * What the manager's card, row and thumbnail draw without decoding the
 * body: written by the server on every save. Exactly the inputs of the
 * comp's `cards` thumbnail (584-591).
 */
export interface ReportSummaryFacts {
  reportTitle: string;
  kicker: string;
  accent: string;
  blockCount: number;
  /** The comp draws at most three KPI boxes (`Math.min(3, kpis.length)`, 584). */
  kpiCount: number;
  /** The first bar/line block's values, at most six. */
  series: number[];
  /** The starter's icon, carried on the row so a rename never changes it. */
  starterIcon: string;
}

/** One card / row of the manager. */
export interface ReportSummary {
  id: string;
  kind: ReportDocumentKind;
  name: string;
  status: ReportStatus;
  /** Which starter minted it; null for blank documents. */
  starter: string | null;
  /** The template a report was built from; null otherwise. */
  originId: string | null;
  createdAt: number;
  updatedAt: number;
  summary: ReportSummaryFacts;
}

export interface ReportCounts {
  /** Unfiltered — the comp's badges never respond to the search box (580). */
  template: number;
  report: number;
}

export interface ReportListReply {
  items: ReportSummary[];
  counts: ReportCounts;
}

export interface ReportDetail extends ReportSummary {
  body: ReportBody;
}

/** A starter tile of the New modal (comp 84-95, 570-577; Appendix C). */
export interface ReportStarterCard {
  key: string;
  /** A category key the dashboard labels: leadership · operations · revenue · growth · finance · product · success · engineering. */
  category: string;
  name: string;
  icon: string;
  reportTitle: string;
  accent: string;
  blockCount: number;
  /** The thumbnail's bars — the starter's first bar/line series, at most six. */
  series: number[];
}

export interface ReportListParams {
  kind?: ReportDocumentKind | undefined;
}

export interface ReportCreateBody {
  kind: ReportDocumentKind;
  /** A starter key, or null/absent for the blank document (comp `createBlank`, 554). */
  starter?: string | null | undefined;
  name?: string | undefined;
}

export interface ReportPutBody {
  name: string;
  status: ReportStatus;
  body: ReportBody;
}

export interface ReportPatchBody {
  name?: string | undefined;
}

function listPath(params: ReportListParams): string {
  const query = new URLSearchParams();
  if (params.kind !== undefined) query.set('kind', params.kind);
  const qs = query.toString();
  return qs === '' ? BASE : `${BASE}?${qs}`;
}

export const reportBuilderApi = {
  list: (params: ReportListParams = {}) => api.get<ReportListReply>(listPath(params)),
  detail: (id: string) => api.get<ReportDetail>(`${BASE}/${encodeURIComponent(id)}`),
  starters: () => api.get<{ starters: ReportStarterCard[] }>(`${BASE}/starters`),
  create: (body: ReportCreateBody) => api.post<ReportDetail>(BASE, body),
  save: (id: string, body: ReportPutBody) => api.put<ReportDetail>(`${BASE}/${encodeURIComponent(id)}`, body),
  patch: (id: string, body: ReportPatchBody) => api.patch<ReportSummary>(`${BASE}/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<null>(`${BASE}/${encodeURIComponent(id)}`),
  /** Lands directly after its source as "{name} (copy)", status draft (comp 555). */
  duplicate: (id: string) => api.post<ReportDetail>(`${BASE}/${encodeURIComponent(id)}/duplicate`),
  /** `id` is the TEMPLATE; the report records it as `originId`. */
  fromTemplate: (id: string, name?: string) =>
    api.post<ReportDetail>(`${BASE}/${encodeURIComponent(id)}/from-template`, name === undefined ? {} : { name }),
};
