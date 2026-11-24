// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The privacy page's API client: the privacy notice, one person's data by
 * their address (find, download, what an erasure does, erase), how long
 * things are kept, whether visitors can reach the public pages, and the
 * websites that may show a form in a frame. Mirrors `apps/server/src/routes/privacy/schema.ts`
 * (copied-mirror convention: change both together).
 *
 * The address a person is found by goes in a request BODY, never a URL or a
 * query key: nothing here puts it where a browser's history, a proxy's log
 * or the query cache's devtools would keep it.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';
import type { ReachabilityState } from '../payments/paymentsApi.js';

// --- the privacy notice ---------------------------------------------------------

export interface PrivacyNotice {
  businessName: string | null;
  noticeUrl: string | null;
  /** Both are set. */
  ready: boolean;
  /** The name every page a stranger sees uses now. */
  shownName: string;
  /** Whom a person writes to about their details (a data privacy officer); null while not set. */
  dpoContact: string | null;
  /** While an add-on keeps the people its sources find: where their details may come from, and whom it asks. */
  peopleFound: PeopleFoundNotice[];
}

/** What the privacy notice must also name for one add-on that keeps the people its sources find. */
export interface PeopleFoundNotice {
  addOn: { key: string; name: string };
  sources: { id: string; name: string; hosts: string[]; website: boolean }[];
  recipients: string[];
}

export const PRIVACY_NOTICE_QUERY_KEY = ['privacy', 'notice'] as const;

export function privacyNoticeQuery() {
  return queryOptions({
    queryKey: PRIVACY_NOTICE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PrivacyNotice }>('/api/v1/privacy/notice')).data,
  });
}

export async function putPrivacyNotice(body: { businessName: string | null; noticeUrl: string | null; dpoContact?: string | null }): Promise<PrivacyNotice> {
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
  | 'files'
  | 'shipping-labels'
  | 'form-answers'
  | 'form-invitations'
  | 'form-files'
  | 'chat-conversations'
  | 'chat-messages'
  | 'chat-choices'
  | 'page-visits'
  | 'found-people'
  | 'found-people-mail'
  | 'found-people-fields'
  /** A reviews add-on's reviews one of their rows left. */
  | 'reviews';

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
  | 'shipping-bookings'
  | 'automation-runs'
  | 'notifications'
  | 'campaign-failures'
  | 'exports'
  | 'do-not-email'
  | 'held-values';

export interface StaysItem {
  kind: StaysKind;
  reason: KeptByLawReason | 'issued-document' | 'payment-records' | 'carrier-records' | 'kept-a-while' | 'objection' | 'live-balance';
  /** Null where they are not counted (exports staff made of a table). */
  count: number | null;
  keptDays: number | null;
  forever: boolean;
  connectionId?: string | undefined;
  table?: string | undefined;
  app?: string | undefined;
  label?: string | undefined;
}

export type GoesKind = 'people' | 'copy' | 'outbox' | 'consent' | 'campaign-mail' | 'files' | 'shipping-labels' | 'form-answers' | 'form-invitations' | 'form-files' | 'chat-conversations' | 'page-visits' | 'found-people' | 'reviews' | 'text-records';

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
  /** Their numbers another person's row still holds, masked: a shared or reassigned line. */
  sharedNumbers?: string[] | undefined;
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

/** "Download everything" for a person known only by phone. The number goes in the body, never in an address or a query key. */
export async function requestPhoneExport(phone: string): Promise<PrivacyExport> {
  return (await api.post<{ data: PrivacyExport }>('/api/v1/privacy/phone/exports', { phone })).data;
}

/** Where a ready download is fetched: the signed-in person's own, by its id (never the address). */
export function exportDownloadHref(id: string): string {
  return `/api/v1/privacy/exports/${encodeURIComponent(id)}/download`;
}

// --- how long we keep things ----------------------------------------------------

export interface KeepingRow {
  key: string;
  fixed: boolean;
  keptFor: 'forever' | 'until-erased' | 'until-removed' | 'ninety-days' | number;
  options: number[];
  /** A row an add-on keeps (its form answers): the add-on, whose own settings say how long. */
  addOn?: { key: string; name: string };
}

export function keepingQuery() {
  return queryOptions({
    queryKey: ['privacy', 'keeping'] as const,
    queryFn: async () => (await api.get<{ data: { rows: KeepingRow[] } }>('/api/v1/privacy/keeping')).data.rows,
  });
}

// --- "Can visitors reach your public pages?" ------------------------------------

export interface PublicReach {
  state: ReachabilityState;
  /** This server's public address, as the answer read it; null when none is set. */
  origin: string | null;
  /** When the facts were read (ms). */
  checkedAt: number;
  /**
   * True when the check cannot tell whether visitors come through a proxy:
   * the server trusts none, and this request came straight. Worded under
   * "reachable", since such visitors would be refused.
   */
  proxyUnchecked: boolean;
}

export const PRIVACY_REACH_QUERY_KEY = ['privacy', 'reach'] as const;

export function reachQuery() {
  return queryOptions({
    queryKey: PRIVACY_REACH_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PublicReach }>('/api/v1/privacy/reach')).data,
  });
}

// --- "Your websites" -------------------------------------------------------------

export interface ListedWebsite {
  origin: string;
  /** Who listed it; null once they are no longer known. */
  addedBy: { id: string; name: string } | null;
  addedAt: number;
}

export interface WebsitesList {
  websites: ListedWebsite[];
  max: number;
}

export const PRIVACY_WEBSITES_QUERY_KEY = ['privacy', 'websites'] as const;

/** A word of a manifest: one text, or the same in several languages. */
export type EmbedWords = string | Record<string, string>;

export interface EmbedScreen {
  path: string;
  label: EmbedWords | null;
  choose: { query: string; title: EmbedWords | null; any: EmbedWords | null; values: { value: string; label: string }[] } | null;
}

/** An installed app with screens a website may show. */
export interface EmbedApp {
  /** What `data-adminium-app` says. */
  app: string;
  name: EmbedWords;
  mount: string;
  screens: EmbedScreen[];
  modes: ('inline' | 'button' | 'floating')[];
}

export function embedsQuery() {
  return queryOptions({
    queryKey: ['privacy', 'embeds'] as const,
    queryFn: async () => (await api.get<{ data: { apps: EmbedApp[] } }>('/api/v1/privacy/embeds')).data.apps,
  });
}

export function websitesQuery() {
  return queryOptions({
    queryKey: PRIVACY_WEBSITES_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: WebsitesList }>('/api/v1/privacy/websites')).data,
  });
}

/** Several at once, all or none: a 422 names each line's code (`details.lines`). */
export async function addWebsites(lines: string[]): Promise<WebsitesList> {
  return (await api.post<{ data: WebsitesList }>('/api/v1/privacy/websites', { lines })).data;
}

export async function removeWebsite(origin: string): Promise<WebsitesList> {
  return (await api.post<{ data: WebsitesList }>('/api/v1/privacy/websites/remove', { origin })).data;
}

/** The rows a person may change: each one's months, all or none. */
export async function putKeeping(rows: { key: string; months: number }[]): Promise<KeepingRow[]> {
  return (await api.put<{ data: { rows: KeepingRow[] } }>('/api/v1/privacy/keeping', { rows })).data.rows;
}

// --- visitor counting ------------------------------------------------------------

export type TrackingLevel = 'off' | 'counts' | 'visitor';

/** The `/x/` pages' eight languages, as the banner's words are kept. */
export const BANNER_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'ar-EG', 'zh-CN', 'zh-TW'] as const;
export type BannerLocale = (typeof BANNER_LOCALES)[number];

export interface BannerWords {
  title?: string;
  text?: string;
  yes?: string;
  no?: string;
}

export interface CountingState {
  level: TrackingLevel;
  /** When counting last started (epoch ms). */
  countingSince: number | null;
  viewCountsMonths: number;
  visitsMonths: number;
  /** The owner's words per language; null: the defaults everywhere. */
  banner: Partial<Record<BannerLocale, BannerWords>> | null;
  /** The engine's default words per language (the editor's placeholders). */
  defaults: Partial<Record<BannerLocale, Required<BannerWords>>>;
  noticeReady: boolean;
  /** What going down from Per visitor would delete now. */
  kept: { visitors: number; visits: number };
  /** What the last change deleted. */
  deleted?: { visitors: number; visits: number } | null;
}

export const PRIVACY_COUNTING_QUERY_KEY = ['privacy', 'counting'] as const;

export function countingQuery() {
  return queryOptions({
    queryKey: PRIVACY_COUNTING_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: CountingState }>('/api/v1/privacy/counting')).data,
  });
}

export async function putCounting(body: { level: TrackingLevel; banner?: Partial<Record<BannerLocale, BannerWords>> | null }): Promise<CountingState> {
  return (await api.put<{ data: CountingState }>('/api/v1/privacy/counting', body)).data;
}
