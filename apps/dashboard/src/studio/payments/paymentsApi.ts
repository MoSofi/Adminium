// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Studio → Payments: the setup read and its saves.
 *
 * Mirrors `apps/server/src/routes/payments/schema.ts`. Nothing here ever
 * holds a saved key: the server sends a hint (`rk_test_…a1B2`) and a date,
 * and a field the person types is sent once and dropped.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';

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

export interface PaymentsSetup {
  reachability: Reachability;
  canManage: boolean;
  services: ServiceView[];
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
