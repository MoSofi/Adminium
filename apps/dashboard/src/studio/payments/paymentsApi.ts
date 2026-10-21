// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Studio → Payments: the setup read and its saves.
 *
 * Mirrors `apps/server/src/routes/payments/schema.ts`. Nothing here ever
 * holds a saved key: the server sends a hint (`rk_test_…a1B2`) and a date,
 * and a field the person types is sent once and dropped.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError, csrfHeaders } from '../../app/api.js';

export type PaymentMode = 'test' | 'live';

export const REACHABILITY_STATES = [
  'network-off',
  'desktop',
  'not-set',
  'this-computer',
  'private-network',
  'dot-local',
  'not-https',
  'proxy-hidden',
  'reachable',
] as const;
export type ReachabilityState = (typeof REACHABILITY_STATES)[number];

export const CHECKLIST_STEPS = ['path', 'test-key', 'test-webhook', 'test-payment', 'live-key', 'live-webhook', 'live-payment'] as const;
export type ChecklistStep = (typeof CHECKLIST_STEPS)[number];

/** Why a paste was refused before anything was saved (`paste-checks.ts`), or why nothing can connect here. */
export const SAVE_REFUSALS = [
  'SECRET_KEY',
  'PUBLISHABLE_KEY',
  'WEBHOOK_SECRET_IN_KEY_FIELD',
  'KEY_IN_SECRET_FIELD',
  'LIVE_KEY_IN_TEST_FIELD',
  'TEST_KEY_IN_LIVE_FIELD',
  'NOT_A_RESTRICTED_KEY',
  'NOT_A_SIGNING_SECRET',
  'HAS_SPACES',
  'EMPTY',
  'network-off',
  'desktop',
] as const;
export type SaveRefusal = (typeof SAVE_REFUSALS)[number];

export interface I18nMessage {
  key: string;
  fallback: string;
}

export interface FieldView {
  key: string;
  label: I18nMessage | null;
  help: I18nMessage | null;
  webhook: boolean;
  set: boolean;
  hint: string | null;
  setAt: number | null;
}

export interface CheckView {
  at: number;
  ok: boolean;
  code: string | null;
  message: string | null;
  missing: string[];
}

export interface ModeView {
  fields: FieldView[];
  check: CheckView | null;
  accountId: string | null;
  webhookUrl: string | null;
  firstEventAt: number | null;
  firstPaymentAt: number | null;
  /** Absent from a server one step behind: read as "nothing known yet". */
  health?: WebhookHealth;
}

export interface WebhookHealth {
  lastEventAt: number | null;
  lastBadAt: number | null;
  badThisHour: number;
  caughtAt: number | null;
  slowed: boolean;
}

export interface ServiceView {
  key: string;
  name: string;
  description: I18nMessage;
  status: string;
  loaded: boolean;
  hasPaths: boolean;
  webhookEvents: string[];
  path: 'app' | 'by-hand' | null;
  stopped: boolean;
  liveOn: boolean;
  test: ModeView;
  live: ModeView;
  checklist: { step: ChecklistStep; done: boolean }[];
}

export interface Reachability {
  state: ReachabilityState;
  origin: string | null;
  notPort443: boolean;
}

export interface MoneyAlarm {
  what: 'account' | 'bank' | 'pay-address';
  service: string | null;
  from: string | null;
  to: string | null;
  by: string;
  at: number;
}

export interface PaymentsSetup {
  reachability: Reachability;
  canManage: boolean;
  services: ServiceView[];
  /** Absent from a server one step behind. */
  alarms?: MoneyAlarm[];
}

export const PAYMENTS_SETUP_QUERY_KEY = ['payments', 'setup'] as const;

export function paymentsSetupQuery() {
  return queryOptions({
    queryKey: PAYMENTS_SETUP_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PaymentsSetup }>('/api/v1/payments/setup')).data,
    retry: false,
  });
}

const service = (key: string) => `/api/v1/payments/services/${encodeURIComponent(key)}`;

export async function saveField(key: string, mode: PaymentMode, field: string, value: string): Promise<ServiceView> {
  return (await api.put<{ data: ServiceView }>(`${service(key)}/modes/${mode}/fields/${encodeURIComponent(field)}`, { value })).data;
}

export async function removeField(key: string, mode: PaymentMode, field: string): Promise<ServiceView> {
  return (await api.delete<{ data: ServiceView }>(`${service(key)}/modes/${mode}/fields/${encodeURIComponent(field)}`)).data;
}

export async function checkKeys(key: string, mode: PaymentMode): Promise<ServiceView> {
  return (await api.post<{ data: ServiceView }>(`${service(key)}/modes/${mode}/check`)).data;
}

export async function choosePath(key: string, path: 'app' | 'by-hand'): Promise<ServiceView> {
  return (await api.put<{ data: ServiceView }>(`${service(key)}/path`, { path })).data;
}

export async function setStopped(key: string, stopped: boolean): Promise<ServiceView> {
  return (await api.put<{ data: ServiceView }>(`${service(key)}/stopped`, { stopped })).data;
}

/** The refusal reason a save came back with, when it is one this page words. */
export function saveRefusalOf(error: unknown): SaveRefusal | null {
  if (!(error instanceof ApiError)) return null;
  const reason = (error.details as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' && (SAVE_REFUSALS as readonly string[]).includes(reason) ? (reason as SaveRefusal) : null;
}

/** The two first-party services, by their add-on key. Any other is named by its manifest. */
export type KnownProvider = 'stripe' | 'paypal' | null;

export function knownProvider(key: string): KnownProvider {
  if (key === 'payments-stripe') return 'stripe';
  if (key === 'payments-paypal') return 'paypal';
  return null;
}

/** How many steps are done, out of how many. */
export function checklistProgress(view: ServiceView): { done: number; total: number } {
  return { done: view.checklist.filter((step) => step.done).length, total: view.checklist.length };
}

// ─── Ways to pay ────────────────────────────────────────────────────────────

/** Mirrors `paymentRulesSchema`: empty lists mean "any". */
export interface WayRules {
  countries: string[];
  currencies: string[];
  min: string | null;
  max: string | null;
  /** Payable profile ids, `shape`, `document`; empty means every payable. */
  onlyFor: string[];
}

export const NO_RULES: WayRules = { countries: [], currencies: [], min: null, max: null, onlyFor: [] };

export interface BankAccount {
  currency: string;
  holder: string;
  iban: string | null;
  accountNumber: string | null;
  bic: string | null;
  sortCode: string | null;
  bank: string | null;
}

export interface ManualDetails {
  accounts?: BankAccount[];
  note?: string | null;
}

export interface WayView {
  source: string;
  method: string;
  label: Record<string, string> | null;
  enabled: boolean;
  rules: WayRules;
  details: unknown;
  position: number;
}

export interface WaysList {
  ways: WayView[];
  manualMethods: string[];
}

export interface ProviderMethod {
  id: string;
  label: string;
  delayed: boolean;
}

export interface WayOffer {
  source: string;
  method: string;
  label: Record<string, string> | null;
  details: unknown;
}

export const PAYMENTS_WAYS_QUERY_KEY = ['payments', 'ways'] as const;

export function paymentsWaysQuery() {
  return queryOptions({
    queryKey: PAYMENTS_WAYS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: WaysList }>('/api/v1/payments/ways')).data,
    retry: false,
  });
}

export function providerMethodsQuery(source: string) {
  return queryOptions({
    queryKey: ['payments', 'methods', source] as const,
    queryFn: async () => (await api.get<{ data: { mode: PaymentMode; methods: ProviderMethod[] } }>(`${service(source)}/methods`)).data,
    retry: false,
  });
}

const way = (source: string, method: string) => `/api/v1/payments/ways/${encodeURIComponent(source)}/${encodeURIComponent(method)}`;

export interface WayInput {
  enabled: boolean;
  rules: WayRules;
  label: Record<string, string> | null;
  details: ManualDetails | null;
  position: number;
}

export async function saveWay(source: string, method: string, input: WayInput): Promise<WayView> {
  return (await api.put<{ data: WayView }>(way(source, method), input)).data;
}

export async function removeWay(source: string, method: string): Promise<void> {
  await api.delete(way(source, method));
}

export interface PreviewInput {
  country: string | null;
  currency: string;
  amount: string;
  kind: 'shape' | 'profile' | 'document';
  profileId: string | null;
}

export async function previewWays(input: PreviewInput): Promise<WayOffer[]> {
  return (await api.post<{ data: WayOffer[] }>('/api/v1/payments/ways/preview', input)).data;
}

// ─── What can be paid ───────────────────────────────────────────────────────

export const PAYABLE_ISSUES = [
  'TABLE_UNAVAILABLE',
  'NO_SUCH_COLUMN',
  'NOT_A_MONEY_COLUMN',
  'NEEDS_UNIT',
  'TOO_FEW_DECIMALS',
  'NO_CURRENCY',
  'REFERENCE_NOT_UNIQUE',
  'NO_METHOD_VALUES',
  'METHOD_VALUE_UNKNOWN',
  'STATUS_NOT_A_CHOICE',
  'STATUS_NOT_WRITABLE',
  'STATUS_VALUE_UNKNOWN',
  'FIELD_PERSONAL',
] as const;
export type PayableIssueCode = (typeof PAYABLE_ISSUES)[number];

export interface PayableIssue {
  code: PayableIssueCode;
  path: string;
  column: string | null;
}

/** Mirrors `payableMappingSchema` (packages/meta/src/repos/payment-setup.ts). */
export interface OwnPaymentsMapping {
  kind: 'table';
  table: string;
  link: string;
  amount: string;
  date: string;
  method: { column: string; values: Record<string, string> };
  note: string | null;
  voided: string | null;
  reference: string;
  amountUnit: 'units' | 'minor';
}

export interface PayableMapping {
  label: string | null;
  amount: { column: string; unit: 'units' | 'minor' | null };
  currency: { column: string } | { fixed: string } | { connection: true };
  due: { column: string } | null;
  payments: { kind: 'kept' } | OwnPaymentsMapping;
  status: { column: string; paid: string; refunded: string | null } | null;
  customerEmail: string | null;
  customerCountry: string | null;
  pageFields: string[];
}

export interface PayableProfileView {
  id: string;
  connectionId: string;
  tableName: string;
  enabled: boolean;
  valid: boolean;
  payments: 'kept' | 'table' | null;
  updatedAt: number;
}

export interface PayablesList {
  profiles: PayableProfileView[];
  shapes: { connectionId: string; tableName: string; version: number }[];
}

export interface PayableCheck {
  issues: PayableIssue[];
  mayMark: { ok: boolean; reason: 'read' | 'update' | 'row-limit' | 'column-limit' | 'payments-create' | null };
  preview: { rowKey: string; label: string; currency: string; due: string; refusal: { code: string; message: string } | null }[];
}

export const PAYMENTS_PAYABLES_QUERY_KEY = ['payments', 'payables'] as const;

export function paymentsPayablesQuery() {
  return queryOptions({
    queryKey: PAYMENTS_PAYABLES_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PayablesList }>('/api/v1/payments/payables')).data,
    retry: false,
  });
}

export async function checkPayable(connectionId: string, tableId: string, mapping: PayableMapping): Promise<PayableCheck> {
  return (await api.post<{ data: PayableCheck }>('/api/v1/payments/payables/check', { connectionId, tableId, mapping })).data;
}

export async function markPayable(connectionId: string, tableId: string, mapping: PayableMapping): Promise<PayableProfileView> {
  return (await api.post<{ data: PayableProfileView }>('/api/v1/payments/payables', { connectionId, tableId, mapping })).data;
}

export async function patchPayable(id: string, patch: { mapping?: PayableMapping; enabled?: boolean }): Promise<PayableProfileView> {
  return (await api.patch<{ data: PayableProfileView }>(`/api/v1/payments/payables/${encodeURIComponent(id)}`, patch)).data;
}

export async function stopPayable(id: string): Promise<void> {
  await api.delete(`/api/v1/payments/payables/${encodeURIComponent(id)}`);
}

/**
 * The mapping issues a refused save came back with (`details.issues`), or
 * null. A request the schema refused also carries `details.issues`, in its
 * own shape (`{ path, message, code: 'too_small' }`): only issues with a code
 * of ours count, so that refusal reads as its message instead.
 */
export function payableIssuesOf(error: unknown): PayableIssue[] | null {
  if (!(error instanceof ApiError)) return null;
  const issues = (error.details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return null;
  const ours = issues.filter(
    (issue): issue is PayableIssue => typeof issue === 'object' && issue !== null && (PAYABLE_ISSUES as readonly unknown[]).includes((issue as { code?: unknown }).code) && typeof (issue as { path?: unknown }).path === 'string',
  );
  return ours.length === 0 ? null : ours.map((issue) => ({ code: issue.code, path: issue.path, column: typeof issue.column === 'string' ? issue.column : null }));
}

// ─── Pay page ───────────────────────────────────────────────────────────────

export interface PayPageSettings {
  shopName: string;
  logoFileId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  shopCountry: string | null;
  showLines: boolean;
}

export const PAYMENTS_PAY_PAGE_QUERY_KEY = ['payments', 'pay-page'] as const;

export function payPageQuery() {
  return queryOptions({
    queryKey: PAYMENTS_PAY_PAGE_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PayPageSettings }>('/api/v1/payments/pay-page')).data,
    retry: false,
  });
}

export async function savePayPage(page: PayPageSettings): Promise<PayPageSettings> {
  return (await api.put<{ data: PayPageSettings }>('/api/v1/payments/pay-page', page)).data;
}

/** The logo types a public page may show: never an SVG. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Uploads the pay page's logo: the image bytes as the body (the server sniffs
 * them, so the declared type is only a hint). Answers the file id the pay page
 * settings then name. Not through `api`, which sends JSON only.
 */
export async function uploadPayPageLogo(file: File): Promise<string> {
  const name = file.name === '' ? 'logo' : file.name;
  const response = await fetch(`/api/v1/payments/pay-page/logo?filename=${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': file.type === '' ? 'application/octet-stream' : file.type, ...csrfHeaders() },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as { data?: { fileId?: unknown }; error?: { code?: unknown; message?: unknown; requestId?: unknown; details?: unknown } } | null;
  if (!response.ok || typeof body?.data?.fileId !== 'string') {
    const error = body?.error;
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'UPLOAD_FAILED',
      typeof error?.message === 'string' ? error.message : `Upload failed with status ${String(response.status)}.`,
      typeof error?.requestId === 'string' ? error.requestId : null,
      error?.details,
    );
  }
  return body.data.fileId;
}

// ─── Where customers pay ────────────────────────────────────────────────────

export interface PayAddress {
  /** The saved pay address, or null before one is chosen. */
  origin: string | null;
  /** The addresses it may be: this server's public address and its customer domains. */
  choices: string[];
  /** Which of them is the staff address (this server's public address). */
  staffOrigin?: string | null;
}

export const PAYMENTS_PAY_ADDRESS_QUERY_KEY = ['payments', 'pay-address'] as const;

export function payAddressQuery() {
  return queryOptions({
    queryKey: PAYMENTS_PAY_ADDRESS_QUERY_KEY,
    queryFn: async () => (await api.get<{ data: PayAddress }>('/api/v1/payments/pay-address')).data,
    retry: false,
  });
}

export async function savePayAddress(origin: string): Promise<PayAddress> {
  return (await api.put<{ data: PayAddress }>('/api/v1/payments/pay-address', { origin })).data;
}

// ─── Test payments and the full preview ─────────────────────────────────────

export interface StartedTestPayment {
  rowKey: string;
  label: string;
  url: string;
  amount: string;
  currency: string;
}

/** A throwaway payable for one service (`demo` for the full preview) and a test link to it. */
export async function startTestPayment(service: string): Promise<StartedTestPayment> {
  return (await api.post<{ data: StartedTestPayment }>('/api/v1/payments/test-payments', { service })).data;
}

export interface TestPaymentTrip {
  label: string;
  service: string;
  amount: string;
  currency: string;
  state: string | null;
  taken: { amount: string; currency: string } | null;
  paidWith: string | null;
  webhookArrived: boolean;
  recorded: boolean;
}

export function testPaymentQuery(rowKey: string | null) {
  return queryOptions({
    queryKey: ['payments', 'test-payment', rowKey] as const,
    queryFn: async () => (await api.get<{ data: TestPaymentTrip }>(`/api/v1/payments/test-payments/${encodeURIComponent(rowKey ?? '')}`)).data,
    enabled: rowKey !== null,
    // While the customer side is open in the other tab: ask again until it is recorded.
    refetchInterval: (query) => (query.state.data?.recorded === true || query.state.data?.state === 'failed' || query.state.data?.state === 'cancelled' ? false : 3000),
    retry: false,
  });
}
