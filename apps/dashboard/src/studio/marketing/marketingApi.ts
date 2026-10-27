// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The marketing mail settings' API client: the senders' DKIM keys and DNS
 * checks, the reply and postal addresses, the bounce card's notice addresses,
 * the do-not-email list, and a people table's e-mail sheet. Mirrors the
 * replies in `apps/server/src/routes/mail-settings/schema.ts`,
 * `routes/consent/schema.ts`, `routes/privacy/schema.ts` and
 * `routes/email-templates/audience.ts` (copied-mirror convention: change both
 * together).
 *
 * No read here ever carries a private key, a pasted signing key or a
 * password; Postmark's and Brevo's made credentials come once, in the reply
 * that makes them.
 */
import { queryOptions } from '@tanstack/react-query';

import { api } from '../../app/api.js';

// --- the senders --------------------------------------------------------------

export interface DkimKey {
  domain: string;
  selector: string;
  record: { name: string; type: 'TXT'; value: string; text: string };
  createdAt: number;
  /** False when the key no longer opens: "Make a key" makes a new one. */
  usable: boolean;
}

export interface MarketingSender {
  address: string;
  name: string | null;
  implicit: boolean;
  domain: string | null;
  freeMail: boolean;
  key: DkimKey | null;
}

export interface MarketingSettings {
  postalAddress: string | null;
  replyTo: string | null;
  publicOrigin: string | null;
  senders: MarketingSender[];
}

export const MARKETING_QUERY_KEY = ['email', 'marketing'] as const;

export function marketingQuery() {
  return queryOptions({
    queryKey: MARKETING_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: MarketingSettings }>('/api/v1/email/marketing')).data,
  });
}

/** The refusal codes a marketing send meets (`email/sender/refusals.ts`). */
export type MarketingRefusal = 'no-postal-address' | 'free-mail-from' | 'dns-unchecked' | 'no-dmarc' | 'not-aligned' | 'no-public-address';

export interface SenderCheck {
  dmarc: { policy: 'none' | 'quarantine' | 'reject' | null; recordDomain: string | null } | 'unchecked' | null;
  dkim: 'found' | 'other-key' | 'not-found' | 'unchecked' | null;
  refusals: MarketingRefusal[];
}

export function senderCheckQuery(address: string) {
  return queryOptions({
    queryKey: [...MARKETING_QUERY_KEY, 'check', address] as const,
    queryFn: async () => (await api.post<{ data: SenderCheck }>('/api/v1/email/marketing/check', { address })).data,
    staleTime: 60_000,
    retry: false,
  });
}

export async function makeDkimKey(domain: string): Promise<DkimKey> {
  return (await api.post<{ data: { key: DkimKey } }>('/api/v1/email/marketing/dkim-keys', { domain })).data.key;
}

export async function putMarketingReplyTo(replyTo: string | null): Promise<string | null> {
  return (await api.put<{ data: { replyTo: string | null } }>('/api/v1/email/marketing/reply-to', { replyTo })).data.replyTo;
}

export async function putPostalAddress(postalAddress: string | null): Promise<string | null> {
  return (await api.put<{ data: { postalAddress: string | null } }>('/api/v1/privacy/postal-address', { postalAddress })).data.postalAddress;
}

// --- bounces and spam reports --------------------------------------------------

export type NoticeService = 'ses' | 'postmark' | 'mailgun' | 'brevo' | 'sendgrid' | 'other';
export const NOTICE_SERVICES: readonly NoticeService[] = ['ses', 'postmark', 'mailgun', 'brevo', 'sendgrid', 'other'];

export interface NoticeEndpoint {
  service: NoticeService;
  opened: boolean;
  secretRow: 'signing-key' | 'verification-key' | 'topic-arn' | 'copy-credentials';
  ready: boolean;
  secretSetAt: number | null;
  confirmedAt: number | null;
  lastNoticeAt: number | null;
  noticeCount: number;
  address: string | null;
}

export interface NoticeEndpoints {
  publicOrigin: string | null;
  suggested: NoticeService | null;
  services: NoticeEndpoint[];
}

export interface MadeCredentials {
  user: string;
  pass: string;
}

export const NOTICE_ENDPOINTS_QUERY_KEY = ['email', 'notice-endpoints'] as const;

export function noticeEndpointsQuery() {
  return queryOptions({
    queryKey: NOTICE_ENDPOINTS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: NoticeEndpoints }>('/api/v1/email/notice-endpoints')).data,
  });
}

export async function openNoticeEndpoint(service: NoticeService): Promise<{ endpoint: NoticeEndpoint; credentials: MadeCredentials | null }> {
  return (await api.post<{ data: { endpoint: NoticeEndpoint; credentials: MadeCredentials | null } }>(`/api/v1/email/notice-endpoints/${service}`)).data;
}

export async function replaceNoticeCredentials(service: NoticeService): Promise<{ endpoint: NoticeEndpoint; credentials: MadeCredentials | null }> {
  return (await api.post<{ data: { endpoint: NoticeEndpoint; credentials: MadeCredentials | null } }>(`/api/v1/email/notice-endpoints/${service}/credentials`)).data;
}

export async function putNoticeSecret(service: NoticeService, secret: string): Promise<NoticeEndpoint> {
  return (await api.put<{ data: { endpoint: NoticeEndpoint } }>(`/api/v1/email/notice-endpoints/${service}/secret`, { secret })).data.endpoint;
}

// --- the do-not-email list ------------------------------------------------------

export type StopReason = 'link' | 'spam' | 'bounce' | 'hand' | 'relay-unsubscribe' | 'old-mark' | 'lead-finder' | 'erased';
export const STOP_REASONS: readonly StopReason[] = ['link', 'spam', 'bounce', 'hand', 'relay-unsubscribe', 'old-mark', 'lead-finder', 'erased'];

export interface StopEntry {
  id: string;
  /** Null once its person was erased. */
  address: string | null;
  reason: StopReason;
  origin: string | null;
  addedAt: number;
  addedBy: { id: string; label: string } | null;
  erasedAt: number | null;
  mayRemove: boolean;
}

export interface StopListPage {
  entries: StopEntry[];
  next: string | null;
  total: number;
}

export const STOP_LIST_QUERY_KEY = ['consent', 'stop-list'] as const;

export function stopListQuery(input: { q: string; reason: StopReason | null; cursor?: string | null }) {
  const params = new URLSearchParams({ limit: '100' });
  if (input.q.trim() !== '') params.set('q', input.q.trim());
  if (input.reason !== null) params.set('reason', input.reason);
  if (input.cursor != null) params.set('cursor', input.cursor);
  return queryOptions({
    queryKey: [...STOP_LIST_QUERY_KEY, input.q.trim(), input.reason, input.cursor ?? null] as const,
    queryFn: async () => (await api.get<{ data: StopListPage }>(`/api/v1/consent/stop-list?${params.toString()}`)).data,
  });
}

export async function addToStopList(addresses: string[]): Promise<{ added: number; already: number; invalid: string[] }> {
  return (await api.post<{ data: { added: number; already: number; invalid: string[] } }>('/api/v1/consent/stop-list', { addresses })).data;
}

export async function removeFromStopList(id: string): Promise<void> {
  await api.delete(`/api/v1/consent/stop-list/${encodeURIComponent(id)}`);
}

// --- a people table's e-mail sheet ----------------------------------------------

export interface TableEmailSheetData {
  connectionId: string;
  table: string;
  label: string;
  appName: string;
  kind: 'people' | 'companies';
  canEmail: boolean;
  email: string;
  name: string | null;
  columns: { name: string; label: string; address: boolean }[];
  customer: { column: string; label: string } | null;
  existingCustomers: { offered: boolean; on: boolean; at: number | null; by: { id: string; name: string } | null };
}

export const TABLE_SHEET_QUERY_KEY = ['email-audience', 'table-settings'] as const;

export function tableSheetQuery(connectionId: string, table: string) {
  const params = new URLSearchParams({ connectionId, table });
  return queryOptions({
    queryKey: [...TABLE_SHEET_QUERY_KEY, connectionId, table] as const,
    queryFn: async () => (await api.get<{ sheet: TableEmailSheetData }>(`/api/v1/email-audience/table-settings?${params.toString()}`)).sheet,
  });
}

export async function putTableSheet(input: { connectionId: string; table: string; canEmail: boolean; email: string; name: string | null }): Promise<TableEmailSheetData> {
  return (await api.put<{ sheet: TableEmailSheetData }>('/api/v1/email-audience/table-settings', input)).sheet;
}

export async function putExistingCustomers(input: { connectionId: string; table: string; on: boolean; optOutOffered: boolean }): Promise<TableEmailSheetData['existingCustomers']> {
  return (await api.put<{ existingCustomers: TableEmailSheetData['existingCustomers'] }>('/api/v1/email-audience/existing-customers', input)).existingCustomers;
}
