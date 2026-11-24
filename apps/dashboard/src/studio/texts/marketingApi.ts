// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Texts → Marketing, mirroring
 * `apps/server/src/sms/marketing/routes.ts`. Every route needs
 * `system:settings:manage`, as e-mail campaigns do, and a signed-in person.
 *
 * A refusal is a stable reason the console words itself. No reply holds a
 * number: a mask at most.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';
import { TEXTS_QUERY_KEY } from './textsApi.js';

export type RunRefusalReason =
  | 'off-by-operator'
  | 'marketing-off-by-operator'
  /** This version ships marketing texts locked until their wording is reviewed. */
  | 'marketing-not-yet-available'
  | 'not-connected'
  | 'no-sender'
  | 'marketing-from-name'
  | 'marketing-without-replies'
  | 'template-off'
  | 'template-refused';

export interface RunRefusal {
  reason: RunRefusalReason | string;
  detail: string | null;
}

export interface Preflight {
  ok: boolean;
  refusals: RunRefusal[];
  sender: { kind: 'number' | 'name' | 'pool'; value: string } | null;
  replies: { canReceiveStop: boolean; state: string };
}

export interface AudienceTable {
  connectionId: string;
  table: string;
  label: string;
  appKey: string;
  appName: string;
  phones: 'readable' | 'masked' | 'hidden';
}

export interface MarketingSetup {
  preflight: Preflight;
  hours: { from: string; to: string; days: 'monday-to-saturday' };
  daily: { limit: number; used: number };
  countries: { noReplies: string[]; blockedCallingCodes: string[]; doubleOptIn: string[] };
  tables: AudienceTable[];
  templates: { key: string; name: string; languages: string[] }[];
}

export interface Audience {
  connectionId: string;
  table: string;
  viewId?: string | null | undefined;
}

export interface RunPreview {
  preflight: Preflight;
  template: { refusals: RunRefusal[]; unfilled: string[]; languages: string[] };
  people: number;
  canSend: number;
  skipped: Record<string, number>;
  countries: { country: string; people: number; canSend: number; opensAt: number | null; noWindow: boolean }[];
  daily: { limit: number; used: number; left: number; days: number };
}

export interface GroupPerson {
  key: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  reason: string | null;
}

export const RUN_STATES = ['scheduled', 'running', 'waiting', 'done', 'cancelled', 'failed'] as const;
export type RunState = (typeof RUN_STATES)[number];

export interface RunTotals {
  people: number;
  queued: number;
  sending: number;
  sent: number;
  delivered: number;
  failed: number;
  unknown: number;
  skipped: Record<string, number>;
  cancelled: number;
  optOuts: number;
}

export interface Run {
  id: string;
  name: string;
  templateKey: string;
  connectionId: string;
  table: string;
  viewId: string | null;
  status: RunState;
  reason: string | null;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  waitingUntil: number | null;
  createdBy: string;
  createdByName: string | null;
  cancelledBy: string | null;
  createdAt: number;
  totals: RunTotals;
}

export interface RunPerson {
  id: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  state: 'queued' | 'sending' | 'handed' | 'skipped' | 'cancelled';
  reason: string | null;
  delivery: { id: string; state: string; reason: string | null; providerStatus: string | null; segments: number | null } | null;
}

export interface SavedView {
  id: string;
  name: string;
  shared: boolean;
  refused: 'view-search' | 'view-hidden-column' | null;
}

export type ConfirmRequestOutcome = 'sent' | 'not-yet-available' | 'held' | 'do-not-email' | 'not-needed' | 'already-confirmed' | 'no-consent' | 'stopped' | 'no-phone' | 'no-row' | 'no-email' | 'no-public-origin' | 'no-mail-server' | string;
export type InPersonOutcome = 'confirmed' | 'already' | 'not-needed' | 'no-consent' | 'stopped' | 'no-phone' | 'no-row' | 'superseded' | string;
export type ConsentHow = 'in-person' | 'phone' | 'email' | 'paper';

export interface PersonRef {
  connectionId: string;
  table: string;
  key: string;
}

// ─── reads ──────────────────────────────────────────────────────────────────

const BASE = '/api/v1/sms/marketing';
export const marketingKey = [...TEXTS_QUERY_KEY, 'marketing'] as const;

export const marketingSetupQuery = () => queryOptions({ queryKey: [...marketingKey, 'setup'], queryFn: async () => (await api.get<{ data: MarketingSetup }>(`${BASE}/setup`)).data });

export const runsQuery = () => queryOptions({ queryKey: [...marketingKey, 'runs'], queryFn: async () => api.get<{ data: Run[]; next: string | null }>(`${BASE}/runs?limit=50`) });

export const runQuery = (id: string) => queryOptions({ queryKey: [...marketingKey, 'run', id], queryFn: async () => (await api.get<{ data: Run }>(`${BASE}/runs/${encodeURIComponent(id)}`)).data });

export const runPeopleQuery = (id: string) =>
  queryOptions({ queryKey: [...marketingKey, 'run', id, 'people'], queryFn: async () => api.get<{ data: RunPerson[]; next: string | null }>(`${BASE}/runs/${encodeURIComponent(id)}/people?limit=100`) });

/** A people table's saved views, as e-mail campaigns choose them: the same filters narrow a text run. */
export const savedViewsQuery = (connectionId: string, table: string) =>
  queryOptions({
    queryKey: [...marketingKey, 'views', connectionId, table],
    queryFn: async () => (await api.get<{ views: SavedView[] }>(`/api/v1/email-audience/views?${new URLSearchParams({ connectionId, table }).toString()}`)).views,
    retry: false,
  });

export async function previewRun(input: { templateKey: string; audience: Audience; scheduleAt?: number | undefined }): Promise<RunPreview> {
  return (await api.post<{ data: RunPreview }>(`${BASE}/preview`, input)).data;
}

export async function groupPeople(input: { audience: Audience; reason: string; offset: number }): Promise<{ people: GroupPerson[]; more: boolean }> {
  return (await api.post<{ data: { people: GroupPerson[]; more: boolean } }>(`${BASE}/preview/people`, { ...input, limit: 50 })).data;
}

// ─── writes ─────────────────────────────────────────────────────────────────

export async function createRun(input: { name: string; templateKey: string; audience: Audience; scheduleAt?: number | undefined }): Promise<Run> {
  return (await api.post<{ data: Run }>(`${BASE}/runs`, input)).data;
}

export async function cancelRun(id: string): Promise<Run> {
  return (await api.post<{ data: Run }>(`${BASE}/runs/${encodeURIComponent(id)}/cancel`)).data;
}

export async function recordMarketingYes(input: PersonRef & { how: ConsentHow; wording: { text: string; version: string }; note?: string | undefined }): Promise<void> {
  await api.post(`${BASE}/consent`, input);
}

export async function askToConfirm(person: PersonRef): Promise<ConfirmRequestOutcome> {
  return (await api.post<{ data: { outcome: ConfirmRequestOutcome } }>(`${BASE}/consent/confirm-request`, person)).data.outcome;
}

export async function confirmedInPerson(person: PersonRef, how: 'in-person' | 'paper'): Promise<InPersonOutcome> {
  return (await api.post<{ data: { outcome: InPersonOutcome } }>(`${BASE}/consent/confirm-in-person`, { ...person, how })).data.outcome;
}

// ─── refusals ───────────────────────────────────────────────────────────────

/** Every reason a run was refused when it was made, from a 409 `TEXT_RUN_REFUSED`. */
export function runRefusalsOf(error: unknown): RunRefusal[] | null {
  if (!(error instanceof ApiError) || error.code !== 'TEXT_RUN_REFUSED') return null;
  const refusals = (error.details as { refusals?: unknown } | null)?.refusals;
  return Array.isArray(refusals) ? (refusals as RunRefusal[]) : null;
}

/** Why the chosen table can't be texted, from `AUDIENCE_REFUSED`. */
export function audienceRefusalOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.code !== 'AUDIENCE_REFUSED') return null;
  const reason = (error.details as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? reason : null;
}

/** The placeholders nothing fills, from `PLACEHOLDER_UNFILLED`. */
export function unfilledOf(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.code !== 'PLACEHOLDER_UNFILLED') return null;
  const names = (error.details as { placeholders?: unknown } | null)?.placeholders;
  return Array.isArray(names) ? names.filter((one): one is string => typeof one === 'string') : [];
}

/** The lock this version ships with: marketing can be looked at, never scheduled. */
export const LOCKED: RunRefusalReason = 'marketing-not-yet-available';
export const isLocked = (preflight: Pick<Preflight, 'refusals'>): boolean => preflight.refusals.some((one) => one.reason === LOCKED);
