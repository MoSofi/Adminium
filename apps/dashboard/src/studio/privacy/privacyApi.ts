// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The privacy page's API client: the privacy notice, one person's data by
 * their address (find, download, what an erasure does, erase), and how long
 * things are kept. Mirrors `apps/server/src/routes/privacy/schema.ts`
 * (copied-mirror convention: change both together).
 *
 * The address a person is found by goes in a request BODY, never a URL or a
 * query key: nothing here puts it where a browser's history, a proxy's log
 * or the query cache's devtools would keep it.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

// --- the privacy notice ---------------------------------------------------------

export interface PrivacyNotice {
  businessName: string | null;
  noticeUrl: string | null;
  /** Both are set. */
  ready: boolean;
  /** The name every page a stranger sees uses now. */
  shownName: string;
}

export const PRIVACY_NOTICE_QUERY_KEY = ['privacy', 'notice'] as const;

export function privacyNoticeQuery() {
  return queryOptions({
    queryKey: PRIVACY_NOTICE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PrivacyNotice }>('/api/v1/privacy/notice')).data,
  });
}

export async function putPrivacyNotice(body: { businessName: string | null; noticeUrl: string | null }): Promise<PrivacyNotice> {
  return (await api.put<{ data: PrivacyNotice }>('/api/v1/privacy/notice', body)).data;
}

/**
 * The notice's address as the server takes it: https, a host, no user name
 * or password in it (`isHttpsPageUrl` in `@adminium/meta`).
 */
export function isHttpsAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

// --- one person's data ----------------------------------------------------------

export type SourceKind =
  | 'people'
  | 'copy'
  | 'outbox'
  | 'consent'
  | 'stop-list'
  | 'campaign-mail'
  | 'campaign-failures'
  | 'documents'
  | 'invoices'
  | 'payments'
  | 'payment-events'
  | 'automation-runs'
  | 'notifications'
  | 'files';

export type KeptByLawReason = 'tax' | 'health' | 'contract' | 'safety';

export interface FoundSource {
  id: string;
  kind: SourceKind;
  group: 'gave' | 'agreed' | 'held';
  connectionId: string | null;
  table: string | null;
  app: string | null;
  ref: string | null;
  /** An app table's label; null for Adminium's own stores (worded by `kind`). */
  label: string | null;
  keptByLaw: KeptByLawReason | null;
  count: number;
  keys: string[];
}

export interface PersonFound {
  address: string;
  found: boolean;
  person: { name: string | null; company: string | null } | null;
  sources: FoundSource[];
}

export async function findPerson(address: string): Promise<PersonFound> {
  return (await api.post<{ data: PersonFound }>('/api/v1/privacy/find', { address })).data;
}

export type StaysKind =
  | 'app-rows'
  | 'documents'
  | 'invoices'
  | 'payments'
  | 'payment-events'
  | 'automation-runs'
  | 'notifications'
  | 'campaign-failures'
  | 'exports'
  | 'do-not-email';

export interface StaysItem {
  kind: StaysKind;
  reason: KeptByLawReason | 'issued-document' | 'payment-records' | 'kept-a-while' | 'objection';
  /** Null where they are not counted (exports staff made of a table). */
  count: number | null;
  keptDays: number | null;
  forever: boolean;
  connectionId?: string | undefined;
  table?: string | undefined;
  app?: string | undefined;
  label?: string | undefined;
}

export type GoesKind = 'people' | 'copy' | 'outbox' | 'consent' | 'campaign-mail' | 'files';

export interface GoesItem {
  kind: GoesKind;
  count: number;
  connectionId?: string | undefined;
  table?: string | undefined;
  app?: string | undefined;
  label?: string | undefined;
}

/** A column of theirs that cannot be emptied: left as it is. */
export interface LeftColumn {
  connectionId: string;
  table: string;
  column: string;
  rows: number;
}

export interface ErasePreview {
  address: string;
  found: boolean;
  goes: GoesItem[];
  stays: StaysItem[];
  left: LeftColumn[];
}

export async function previewErasure(address: string): Promise<ErasePreview> {
  return (await api.post<{ data: ErasePreview }>('/api/v1/privacy/erase/preview', { address })).data;
}

export interface EraseResult {
  counts: Record<string, number>;
  left: LeftColumn[];
  filesFailed: number;
}

/** The erasure, confirmed by the address typed again. */
export async function erasePerson(address: string, confirm: string): Promise<EraseResult> {
  return (await api.post<{ data: EraseResult }>('/api/v1/privacy/erase', { address, confirm })).data;
}

// --- "Download everything" ------------------------------------------------------

export interface PrivacyExport {
  id: string;
  status: 'processing' | 'ready' | 'failed' | 'expired';
  counts: Record<string, number> | null;
  createdAt: number;
  completedAt: number | null;
  expiresAt: number | null;
}

export const PRIVACY_EXPORTS_QUERY_KEY = ['privacy', 'exports'] as const;

export function privacyExportsQuery() {
  return queryOptions({
    queryKey: PRIVACY_EXPORTS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PrivacyExport[] }>('/api/v1/privacy/exports')).data,
    // While one is being made, look again until it is done.
    refetchInterval: (query) => (query.state.data?.some((one) => one.status === 'processing') === true ? 2_000 : false),
  });
}

export async function requestExport(address: string): Promise<PrivacyExport> {
  return (await api.post<{ data: PrivacyExport }>('/api/v1/privacy/exports', { address })).data;
}

/** Where a ready download is fetched: the signed-in person's own, by its id (never the address). */
export function exportDownloadHref(id: string): string {
  return `/api/v1/privacy/exports/${encodeURIComponent(id)}/download`;
}

// --- how long we keep things ----------------------------------------------------

export interface KeepingRow {
  key: string;
  fixed: boolean;
  keptFor: 'forever' | 'until-erased' | number;
  options: number[];
}

export function keepingQuery() {
  return queryOptions({
    queryKey: ['privacy', 'keeping'] as const,
    queryFn: async () => (await api.get<{ data: { rows: KeepingRow[] } }>('/api/v1/privacy/keeping')).data.rows,
  });
}
