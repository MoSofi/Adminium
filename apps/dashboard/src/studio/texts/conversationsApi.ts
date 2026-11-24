// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The dashboard side of Texts → Conversations, mirroring
 * `apps/server/src/sms/threads/routes.ts`.
 *
 * A thread is one phone number's conversation with one app. The list is what
 * the page reads again whenever its realtime connection opens: a notice on
 * `texts` or `texts:<app>` says only that some thread changed, and a notice
 * missed while the page was away would otherwise leave it wrong for good.
 *
 * Every read and every answer is audited by the server. No reply here holds a
 * number in full unless this person may see it; the list shows the mask.
 */
import { queryOptions } from '@tanstack/react-query';

import { api, ApiError } from '../../app/api.js';
import { holdsSystemAction, type BootstrapData } from '../../app/bootstrap.js';
import { TEXTS_QUERY_KEY } from './textsApi.js';

export type ThreadKind = 'message' | 'help' | 'stop' | 'start' | 'reply' | 'text';
export type ThreadDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'unknown' | 'skipped' | 'not-sent';
export type ReplyBlock = 'not-allowed' | 'stopped' | 'not-connected' | 'no-consent' | 'cannot-receive-text' | 'country-blocked';
/** `not-heard`: set up, but no signed reply has reached this server yet. */
export type ReplyReach = 'reachable' | 'unreachable' | 'unknown' | 'not-connected' | 'key-unreadable' | 'not-heard' | string;

export interface ThreadPerson {
  id: string;
  label: string;
}

export interface Thread {
  id: string;
  /** Null for a thread no app owns. */
  app: string | null;
  /** In full only for someone who may see it; else null and `masked` holds `+1 ••• 161`. */
  phone: string | null;
  masked: string | null;
  /** `masked-for-you`: the number exists, but this person's role shows only its mask. Nothing here asks for more. */
  phoneHidden: 'masked-for-you' | null;
  /** The business number this conversation runs on, when it is a number. */
  line: string | null;
  record: { connectionId: string; table: string; key: string } | null;
  lastAt: number;
  lastDirection: 'in' | 'out';
  lastKind: ThreadKind;
  preview: string | null;
  unread: number;
  readAt: number | null;
  readBy: ThreadPerson | null;
  stopped: boolean;
  /** A text from here can be answered: a number sends it, and their country carries replies. */
  theyCanReply: boolean;
}

export interface ThreadItem {
  id: string;
  /** `app`: a text an app sent, shown by its template, because its words are never kept. */
  source: 'message' | 'app';
  direction: 'in' | 'out';
  kind: ThreadKind | 'template';
  body: string | null;
  template: string | null;
  at: number;
  by: ThreadPerson | null;
  delivery: { status: ThreadDeliveryStatus; reason: string | null } | null;
  /** A STOP's one confirmation was asked for. */
  confirmed: boolean | null;
  refused: string | null;
}

export interface ThreadList {
  threads: Thread[];
  next: string | null;
  unread: number;
  replies: { canArrive: boolean; state: ReplyReach };
}

export interface ThreadDetail {
  thread: Thread;
  items: ThreadItem[];
  next: string | null;
  /** They wrote within the answer window, so an answer needs no yes of its own. */
  answering: boolean;
  canReply: { ok: boolean; reason: ReplyBlock | null };
}

export interface SendOutcome {
  outcome: 'queued' | 'held' | 'refused';
  deliveryId: string | null;
  opensAt: number | null;
  reason: string | null;
}

export interface RepliesSwitch {
  app: string;
  name: string;
  replies: 'on' | 'off';
  starts: 'on' | 'off';
  changedAt: number | null;
  changedBy: ThreadPerson | null;
}

// ─── who may read ───────────────────────────────────────────────────────────

export interface TextReader {
  /** The console-wide keys: every conversation. */
  everything: 'read' | 'reply' | null;
  /** One app's own, from an app role. */
  apps: ReadonlyMap<string, 'read' | 'reply'>;
}

/** What the bootstrap says this person may do with conversations. Discovery only: every route checks again. */
export function textReaderOf(bootstrap: BootstrapData): TextReader {
  const everything = holdsSystemAction(bootstrap, 'texts.reply') ? 'reply' : holdsSystemAction(bootstrap, 'texts.read') ? 'read' : null;
  return { everything, apps: new Map((bootstrap.textApps ?? []).map((one) => [one.app, one.may] as const)) };
}

export const readsAnyTexts = (reader: TextReader): boolean => reader.everything !== null || reader.apps.size > 0;

export const mayAnswer = (reader: TextReader, app: string | null): boolean => reader.everything === 'reply' || (app !== null && reader.apps.get(app) === 'reply');

// ─── reads ──────────────────────────────────────────────────────────────────

const BASE = '/api/v1/texts';
export const threadsKey = [...TEXTS_QUERY_KEY, 'threads'] as const;
export const switchesKey = [...TEXTS_QUERY_KEY, 'replies'] as const;

export interface ThreadFilter {
  /** Undefined: every app this person reads; `''`: threads no app owns. */
  app?: string | undefined;
  unread: boolean;
}

export const threadsQuery = (filter: ThreadFilter) =>
  queryOptions({
    queryKey: [...threadsKey, 'list', filter.app ?? '*', filter.unread] as const,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filter.app !== undefined) params.set('app', filter.app);
      if (filter.unread) params.set('unread', 'true');
      const query = params.toString();
      return (await api.get<{ data: ThreadList }>(`${BASE}/threads${query === '' ? '' : `?${query}`}`)).data;
    },
  });

export const threadQuery = (id: string) =>
  queryOptions({
    queryKey: [...threadsKey, 'one', id] as const,
    queryFn: async () => (await api.get<{ data: ThreadDetail }>(`${BASE}/threads/${encodeURIComponent(id)}`)).data,
  });

export async function olderItems(id: string, cursor: string): Promise<ThreadDetail> {
  return (await api.get<{ data: ThreadDetail }>(`${BASE}/threads/${encodeURIComponent(id)}?cursor=${encodeURIComponent(cursor)}`)).data;
}

export const switchesQuery = () =>
  queryOptions({ queryKey: switchesKey, queryFn: async () => (await api.get<{ data: { apps: RepliesSwitch[]; noApp: 'on' | 'off' } }>(`${BASE}/replies`)).data });

// ─── writes ─────────────────────────────────────────────────────────────────

/** A key made once per message: the same key again sends nothing twice. */
export function newClientKey(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function sendReply(id: string, body: string, clientKey: string): Promise<{ threadId: string | null; item: ThreadItem | null; result: SendOutcome }> {
  return (await api.post<{ data: { threadId: string | null; item: ThreadItem | null; result: SendOutcome } }>(`${BASE}/threads/${encodeURIComponent(id)}/replies`, { body, clientKey })).data;
}

export async function markRead(id: string): Promise<void> {
  await api.post(`${BASE}/threads/${encodeURIComponent(id)}/read`);
}

export async function setReplies(app: string, replies: 'on' | 'off'): Promise<RepliesSwitch> {
  return (await api.put<{ data: RepliesSwitch }>(`${BASE}/replies/${encodeURIComponent(app)}`, { replies })).data;
}

/** A 403 from a conversation route: this person may not do that here. */
export const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403;
