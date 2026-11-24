// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Studio → Texts.
 *
 * Mirrors `apps/server/src/sms/routes.ts` (the provider card) and
 * `apps/server/src/sms/console-routes.ts` (limits, Activity, the do-not-text
 * list, text templates).
 *
 * A KEY IS NEVER KEPT HERE. `saveAccount` is a plain call, not a react-query
 * mutation, because a mutation keeps its variables in the cache for minutes.
 * No reply holds a key: the server sends a masked hint.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';
import type { ReachabilityState } from '../payments/paymentsApi.js';

export type SmsProvider = 'twilio' | 'telnyx';
export type SenderKind = 'number' | 'name' | 'pool';
export type CheckReason = 'credentials-refused' | 'profile-not-found' | 'account-suspended' | 'account-closed' | 'account-disabled' | 'unreachable';

export interface SmsSender {
  kind: SenderKind;
  value: string;
}

export interface SmsAccount {
  provider: SmsProvider;
  /** Masked by the server: `ow•••le`. */
  accountName: string | null;
  accountHint: string;
  accountType: 'full' | 'trial' | null;
  /** False when the server's secret changed: the key must be pasted again. */
  keyReadable: boolean;
  sender: SmsSender | null;
  senderTakesReplies: 'yes' | 'no' | 'depends' | null;
  defaultCountry: string | null;
  check: { ok: boolean; reason: CheckReason | null; at: number };
  savedAt: number;
  timeoutRetry: 'never' | 'same-key';
}

export interface SmsSetup {
  reachability: { state: ReachabilityState; origin: string | null; notPort443: boolean };
  /** False: texts can go, but STOP replies and delivery reports cannot arrive. */
  repliesCanArrive: boolean;
  account: SmsAccount | null;
}

export interface SendingLimits {
  dailyLimit: number;
  serviceHours: { from: string; to: string };
  usedToday: number;
  warnAt: number;
  day: string;
  dayZone: string;
}

export const DELIVERY_STATES = ['prepared', 'retrying', 'handing-over', 'accepted', 'provider-failed', 'refused', 'unknown', 'skipped', 'not-sent', 'checked-went', 'checked-not-sent'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

export interface Delivery {
  id: string;
  createdAt: number;
  updatedAt: number;
  phoneMasked: string | null;
  textClass: 'service' | 'marketing';
  state: DeliveryState;
  reason: string | null;
  provider: SmsProvider | null;
  /** The provider's own word (`delivered`, `undelivered`). */
  providerStatus: string | null;
  providerErrorCode: string | null;
  segments: number | null;
  price: { amount: string; currency: string } | null;
  estimatedSegments: number;
  encoding: 'gsm-7' | 'ucs-2';
  attempts: number;
  mayHaveGoneAt: number | null;
  source: { app: string; table: string } | null;
}

export const STOP_REASONS = ['text-stop', 'provider-opt-out', 'staff', 'erased'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface StopEntry {
  id: string;
  /** Null once the person was erased. */
  phone: string | null;
  masked: string | null;
  reason: StopReason;
  /** `phone`, `email`, `in-person` for a staff record; the provider's key for its opt-out; the sender for a reply. */
  origin: string | null;
  addedAt: number;
  addedBy: string | null;
  erasedAt: number | null;
}

export type StopAsked = 'phone' | 'email' | 'in-person';

export interface TemplateLanguage {
  /** As the store spells it: `en_US`. */
  locale: string;
  body: string;
  enabled: boolean;
  /** No longer what the app shipped: an update of the app keeps these words. */
  edited: boolean;
  updatedAt: number;
}

export interface TextTemplate {
  key: string;
  name: string;
  /** The app that installed it; null for one added here. */
  app: string | null;
  languages: TemplateLanguage[];
}

export type TestOutcome = { outcome: 'accepted' | 'not-taken' | 'refused' | 'unknown'; reason: string | null; detail: string | null; resend: 'same-key' | 'check-first' | null; providerCode: string | null };

// ─── Reads ──────────────────────────────────────────────────────────────────

const BASE = '/api/v1/sms';
export const TEXTS_QUERY_KEY = ['studio-texts'] as const;
export const setupKey = [...TEXTS_QUERY_KEY, 'setup'] as const;
export const limitsKey = [...TEXTS_QUERY_KEY, 'limits'] as const;
export const deliveriesKey = [...TEXTS_QUERY_KEY, 'deliveries'] as const;
export const stopListKey = [...TEXTS_QUERY_KEY, 'stop-list'] as const;
export const templatesKey = [...TEXTS_QUERY_KEY, 'templates'] as const;

export const smsSetupQuery = () => queryOptions({ queryKey: setupKey, queryFn: async () => (await api.get<{ data: SmsSetup }>(`${BASE}/setup`)).data });
export const sendingLimitsQuery = () => queryOptions({ queryKey: limitsKey, queryFn: async () => (await api.get<{ data: SendingLimits }>(`${BASE}/sending-limits`)).data });

export const deliveriesQuery = () =>
  queryOptions({
    queryKey: deliveriesKey,
    queryFn: async () => {
      const page = await api.get<{ data: Delivery[]; next: string | null }>(`${BASE}/deliveries?limit=200`);
      return page;
    },
  });

export const stopListQuery = () => queryOptions({ queryKey: stopListKey, queryFn: async () => api.get<{ data: StopEntry[]; next: string | null }>(`${BASE}/stop-list`) });
export const textTemplatesQuery = () => queryOptions({ queryKey: templatesKey, queryFn: async () => api.get<{ data: TextTemplate[]; connected: boolean }>(`${BASE}/text-templates`) });

// ─── Writes ─────────────────────────────────────────────────────────────────

export type AccountKeys = { provider: 'twilio'; accountSid: string; authToken: string } | { provider: 'telnyx'; apiKey: string; publicKey: string; messagingProfileId: string };

/** Checked with the provider before it is saved. The values go out once, and the caller drops them. */
export async function saveAccount(keys: AccountKeys, confirmAccountChange: boolean): Promise<SmsAccount> {
  return (await api.put<{ data: SmsAccount }>(`${BASE}/account`, confirmAccountChange ? { ...keys, confirmAccountChange: true } : keys)).data;
}

export async function saveSending(sender: SmsSender, defaultCountry: string | null): Promise<SmsAccount> {
  return (await api.put<{ data: SmsAccount }>(`${BASE}/sending`, { sender, defaultCountry })).data;
}

export async function checkAccount(): Promise<SmsAccount> {
  return (await api.post<{ data: SmsAccount }>(`${BASE}/check`)).data;
}

export async function disconnectAccount(): Promise<void> {
  await api.delete(`${BASE}/account`);
}

export async function sendTestText(to: string): Promise<TestOutcome> {
  return (await api.post<{ data: TestOutcome }>(`${BASE}/test`, { to })).data;
}

export async function saveLimits(body: { dailyLimit: number; serviceHours: { from: string; to: string } }): Promise<SendingLimits> {
  return (await api.put<{ data: SendingLimits }>(`${BASE}/sending-limits`, body)).data;
}

export async function settleDelivery(id: string, answer: 'went' | 'not-sent'): Promise<Delivery> {
  return (await api.post<{ data: Delivery }>(`${BASE}/deliveries/${encodeURIComponent(id)}/settle`, { answer })).data;
}

export async function recordStop(phone: string, asked: StopAsked): Promise<{ data: StopEntry; added: boolean }> {
  return api.post<{ data: StopEntry; added: boolean }>(`${BASE}/stop-list`, { phone, asked });
}

export async function removeStop(id: string): Promise<void> {
  await api.delete(`${BASE}/stop-list/${encodeURIComponent(id)}`);
}

export async function saveTemplateLanguage(key: string, locale: string, body: string): Promise<TextTemplate> {
  return (await api.put<{ data: TextTemplate }>(`${BASE}/text-templates/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`, { body })).data;
}

export async function emptyTemplateLanguage(key: string, locale: string): Promise<TextTemplate> {
  return (await api.delete<{ data: TextTemplate }>(`${BASE}/text-templates/${encodeURIComponent(key)}/${encodeURIComponent(locale)}`)).data;
}

// ─── Refusals ───────────────────────────────────────────────────────────────

/** The stable reason a refusal carries in its details, or null. */
export function refusalReason(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const details = error.details as { reason?: unknown } | null | undefined;
  return typeof details?.reason === 'string' ? details.reason : null;
}

/** The masked account name another key would bill, when the server refused it until confirmed. */
export function changedAccountOf(error: unknown): { accountName: string | null } | null {
  if (!(error instanceof ApiError) || error.status !== 409 || refusalReason(error) !== 'account-changed') return null;
  const details = error.details as { accountName?: unknown };
  return { accountName: typeof details.accountName === 'string' ? details.accountName : null };
}
