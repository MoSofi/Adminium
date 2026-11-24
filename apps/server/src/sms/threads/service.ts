// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TWO-WAY TEXT CONVERSATIONS: the replies customers send, and the answers.
 *
 *   received      the inbound channel's `replies` hook: a reply is kept in its
 *                 thread, or answered "not read" when its app's replies are off
 *   list, thread  what a person may read, newest first
 *   reply         an answer in a thread, through the send path
 *   sendToRecord  a text a person writes on a record's page (Sales CRM's
 *                 "Send a text"), through the send path
 *
 * ─── ONE THREAD PER NUMBER AND APP ─────────────────────────────────────────
 * A reply belongs to the app that texted the number last, as the delivery
 * records say; with none, to no app. So a clinic's patient and a hotel's guest
 * on one server never share a thread, and a role given one app's
 * conversations reads that app's alone. The texts an app sent appear in its
 * thread by template, from the delivery records, because their words are
 * never kept.
 *
 * ─── REPLIES OFF ───────────────────────────────────────────────────────────
 * Each app has a switch, starting where its manifest's `textReplies` says
 * (Clinic: off, because patients may text symptoms). A reply to an app whose
 * replies are off is not kept here at all, and the sender gets the one fixed
 * "this number is not read" answer: at most once in {@link NOT_READ_EVERY_MS}
 * for a number, never to a number on the stop list, never to the business's
 * own sender, and through the send path like any text, so the daily limit
 * holds. A reply to no app is off when any installed app's replies are off: a
 * server that runs a clinic keeps no stranger's symptoms either.
 *
 * ─── EVERY TEXT GOES THROUGH THE SEND PATH ─────────────────────────────────
 * Consent, the stop list, +86, the words, the length, the sending hours and
 * the daily limit are `texts.prepare`'s. One thing is said here: a person who
 * wrote to the business in the last {@link TEXT_ANSWER_WINDOW_MS} has asked for
 * an answer, so a service text to them needs no yes of its own
 * (`answering`). A STOP, or a later no, still refuses it.
 *
 * ─── WHAT IS KEPT ──────────────────────────────────────────────────────────
 * The number and every message's words are sealed under keys taken from the
 * address keys. Nothing here logs a number or a word. A message is kept
 * {@link TEXT_THREAD_RETAIN_MS}; an erasure by the number takes its threads and
 * messages at once.
 */
import type { AddressHash, MetaDb } from '@adminium/meta';

import { decryptSecret, encryptSecret, SecretFormatError, SecretIntegrityError } from '../../config/secrets.js';
import { AddressKeysLockedError, addressKeyRing, TEXT_THREAD_BODY_PURPOSE, TEXT_THREAD_PHONE_PURPOSE } from '../../consent/keys.js';
import { parsePhone } from '../../phone/index.js';
import { maskPhone } from '../consent/redact.js';
import { NO_REPLY_COUNTRIES } from '../consent/rules.js';
import { textSubject } from '../consent/service.js';
import type { TextConsentService } from '../consent/types.js';
import type { SmsReplyReceived } from '../inbound/channel.js';
import type { BusinessContact } from '../send/opt-out.js';
import type { TextPrepared, TextSendPath } from '../send/path.js';
import type { SmsService } from '../service.js';
import type { SmsSender } from '../types.js';
import { notReadText } from './not-read.js';
import { createTextThreadStore, type TextReplySwitchRecord, type TextThreadStore } from './store.js';
import type { TextReceived, TextReplyBlock, TextSendOutcome, TextThreadKind, TextThreadMessageRecord, TextThreadRecord, TextThreadRecordRef } from './types.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A message is kept this long. */
export const TEXT_THREAD_RETAIN_MS = 365 * DAY_MS;
/** A person who wrote within this long has asked for the answer, so it needs no yes of its own. */
export const TEXT_ANSWER_WINDOW_MS = 7 * DAY_MS;
/** A person who wrote within this long is waiting for the answer, so it may go outside the sending hours. */
export const TEXT_WAITING_MS = 60 * MINUTE_MS;
/** A number gets the "not read" answer at most once in this long, so two automatic answerers cannot keep each other going. */
export const NOT_READ_EVERY_MS = 30 * DAY_MS;
/** The longest message a person may write here; the send path's segment limit refuses well before. */
export const TEXT_BODY_MAX = 1600;
/** How much of the last line a list shows. */
const PREVIEW_MAX = 120;
/** Rows one sweep step removes. */
const SWEEP_BATCH = 500;

const THREAD_PHONE_PURPOSE = TEXT_THREAD_PHONE_PURPOSE;
const THREAD_BODY_PURPOSE = TEXT_THREAD_BODY_PURPOSE;

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** What one person may do with conversations, from their grants. */
export interface TextViewer {
  /** Every conversation: Super Admin, `texts.read` or `texts.reply`. */
  everything: 'read' | 'reply' | null;
  /** One app's own: `texts:<app>:read` or `texts:<app>:reply`. */
  apps: ReadonlyMap<string, 'read' | 'reply'>;
}

export const mayReadApp = (viewer: TextViewer, app: string): boolean => viewer.everything !== null || (app !== '' && viewer.apps.has(app));
export const mayReplyApp = (viewer: TextViewer, app: string): boolean => viewer.everything === 'reply' || (app !== '' && viewer.apps.get(app) === 'reply');
/** Whether this person may read any conversation at all. */
export const readsAny = (viewer: TextViewer): boolean => viewer.everything !== null || viewer.apps.size > 0;

/** An installed app, and where its manifest starts its replies. */
export interface TextApp {
  key: string;
  name: string;
  replies: 'on' | 'off';
}

export interface TextThreadsDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`, which opens the address keys. */
  secret: string;
  consent: { stop: Pick<TextConsentService['stop'], 'has'>; standing: TextConsentService['standing'] };
  sms: Pick<SmsService, 'view'>;
  /** The send path, once it is joined. */
  texts: () => TextSendPath | null;
  /** Who a text is from, for its opt-out line and the "not read" answer. */
  business: (app: string | null) => Promise<BusinessContact>;
  /** The business's clock, for the sending hours. */
  zone: (app: string | null) => Promise<string | null>;
  /** The language the business writes to people in. */
  locale: () => Promise<string | null>;
  /** The installed apps. */
  apps: () => Promise<readonly TextApp[]>;
  /** A thread changed: a realtime notice, holding no number and no word. */
  notify?: ((change: { threadId: string; app: string | null }) => void) | undefined;
  store?: TextThreadStore | undefined;
  now?: (() => number) | undefined;
}

export type TextDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'failed' | 'unknown' | 'skipped' | 'not-sent';

export interface TextThreadView {
  id: string;
  /** Null for a thread no app owns. */
  app: string | null;
  phone: string | null;
  masked: string | null;
  line: string | null;
  record: TextThreadRecordRef | null;
  lastAt: number;
  lastDirection: 'in' | 'out';
  lastKind: TextThreadKind;
  /** The start of the last message's words. */
  preview: string | null;
  unread: number;
  readAt: number | null;
  readBy: { id: string; label: string } | null;
  /** They asked for no more texts. */
  stopped: boolean;
  /** A text from here can be answered by them: a number sends it, and their country carries replies. */
  theyCanReply: boolean;
}

export interface TextItemView {
  id: string;
  /** `message`: kept here. `app`: a text an app sent, shown by its template. */
  source: 'message' | 'app';
  direction: 'in' | 'out';
  kind: TextThreadKind | 'template';
  body: string | null;
  template: string | null;
  at: number;
  by: { id: string; label: string } | null;
  delivery: { status: TextDeliveryStatus; reason: string | null } | null;
  /** A STOP's one confirmation was asked for. */
  confirmed: boolean | null;
  /** Why a person's text did not go. */
  refused: string | null;
}

export interface TextThreadDetail {
  thread: TextThreadView;
  items: TextItemView[];
  next: string | null;
  /** They wrote within the answer window: a reply needs no yes of its own. */
  answering: boolean;
  canReply: { ok: boolean; reason: TextReplyBlock | null };
}

export interface TextSwitchView {
  app: string;
  name: string;
  replies: 'on' | 'off';
  /** What the app's manifest starts it as. */
  starts: 'on' | 'off';
  changedAt: number | null;
  changedBy: { id: string; label: string } | null;
}

export interface TextSendInput {
  body: string;
  /** Made once per message by the page: the same key again sends nothing twice. */
  clientKey: string;
  by: { id: string; label: string };
}

export interface TextThreads {
  /** The inbound channel's `replies` hook. Safe to call twice for one event. */
  received(reply: SmsReplyReceived): Promise<TextReceived>;
  list(viewer: TextViewer, query: { app?: string | null | undefined; unreadOnly?: boolean | undefined; limit: number; cursor?: string | null | undefined }): Promise<{ threads: TextThreadView[]; next: string | null; unread: number }>;
  /** Null when there is none, or this person may not read it. */
  thread(viewer: TextViewer, id: string, opts: { limit: number; cursor?: string | null | undefined }): Promise<TextThreadDetail | null>;
  /** Null when there is none, or this person may not read it. */
  reply(viewer: TextViewer, id: string, input: TextSendInput): Promise<{ thread: TextThreadRecord; outcome: TextSendOutcome; item: TextItemView | null } | null>;
  markRead(viewer: TextViewer, id: string, by: { id: string; label: string }): Promise<TextThreadRecord | null>;
  /** A text to the number on a record, written by a person who reaches that record. */
  sendToRecord(input: TextSendInput & { app: string | null; phone: unknown; country: string | null; record: TextThreadRecordRef }): Promise<{ threadId: string | null; outcome: TextSendOutcome; masked: string | null }>;
  switches(): Promise<{ apps: TextSwitchView[]; noApp: 'on' | 'off' }>;
  setReplies(app: string, replies: 'on' | 'off', by: { id: string; label: string } | null): Promise<TextSwitchView | null>;
  /** Whether replies to this app (`''`: to none) are kept. */
  repliesOf(app: string): Promise<'on' | 'off'>;
  /** Old messages, threads left empty, and answer marks past their period. */
  sweep(): Promise<{ messages: number; threads: number; answers: number }>;
  /** Every thread and message of this number. */
  eraseFor(e164: string): Promise<{ threads: number; messages: number }>;
  countFor(e164: string): Promise<{ threads: number; messages: number }>;
  /** Whether any thread or answer mark is kept, so the clean-up has work. */
  any(): Promise<boolean>;
}

function cursorOf(value: { at: number; id: string }): string {
  return Buffer.from(JSON.stringify([value.at, value.id])).toString('base64url');
}

function readCursor(cursor: string | null | undefined): { at: number; id: string } | undefined | null {
  if (cursor === null || cursor === undefined || cursor === '') return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === 'number' && typeof parsed[1] === 'string') return { at: parsed[0], id: parsed[1] };
  } catch {
    // Not one of ours.
  }
  return null;
}

/** What a delivery's state means to a reader of the conversation. */
export function deliveryStatusFor(state: string, providerStatus: string | null): TextDeliveryStatus {
  switch (state) {
    case 'prepared':
    case 'retrying':
    case 'handing-over':
      return 'sending';
    case 'accepted':
      return providerStatus === 'delivered' ? 'delivered' : 'sent';
    case 'checked-went':
      return 'sent';
    case 'provider-failed':
    case 'refused':
      return 'failed';
    case 'unknown':
      return 'unknown';
    case 'skipped':
      return 'skipped';
    default:
      return 'not-sent';
  }
}

export class TextCursorError extends Error {
  constructor() {
    super('That page cursor is not one this list gave.');
  }
}

export function createTextThreads(deps: TextThreadsDeps): TextThreads {
  const now = deps.now ?? Date.now;
  const store = deps.store ?? createTextThreadStore(deps.meta);
  const ring = addressKeyRing(deps.meta, deps.secret);

  async function seal(value: string, purpose: string): Promise<string> {
    return encryptSecret(value, Buffer.from(await ring.derivedForWrite(purpose), 'hex'));
  }

  async function open(sealed: string | null, purpose: string): Promise<string | null> {
    if (sealed === null) return null;
    for (const key of await ring.derivedAll(purpose)) {
      try {
        return decryptSecret(sealed, Buffer.from(key, 'hex'));
      } catch (error) {
        if (!(error instanceof SecretIntegrityError || error instanceof SecretFormatError)) throw error;
      }
    }
    throw new AddressKeysLockedError();
  }

  const hashesOf = (e164: string): Promise<AddressHash[]> => ring.hashesOf(textSubject(e164));

  /** An exact number from the provider or a row, or null. */
  function exact(value: unknown, country: string | null): string | null {
    const phone = parsePhone(value, country);
    if (phone.ok) return phone.e164;
    return typeof value === 'string' && E164.test(value) ? value : null;
  }

  async function repliesOf(app: string): Promise<'on' | 'off'> {
    const [apps, switches] = await Promise.all([deps.apps(), store.switches()]);
    const switched = new Map(switches.map((one) => [one.appKey, one.replies]));
    const of = (key: string, starts: 'on' | 'off'): 'on' | 'off' => switched.get(key) ?? starts;
    if (app !== '') return of(app, apps.find((one) => one.key === app)?.replies ?? 'on');
    // No app texted them: off as soon as any app here keeps its replies unread.
    return apps.some((one) => of(one.key, one.replies) === 'off') ? 'off' : 'on';
  }

  async function threadFor(e164: string, hashes: readonly AddressHash[], app: string, line: string | null, at: number): Promise<TextThreadRecord> {
    const found = await store.findThread(hashes, app);
    if (found !== null) return found;
    return store.createThread({ phone: await ring.hashForWrite(textSubject(e164)), appKey: app, phoneEncrypted: await seal(e164, THREAD_PHONE_PURPOSE), phoneMasked: maskPhone(e164), line, at }, hashes);
  }

  function changed(thread: TextThreadRecord): void {
    try {
      deps.notify?.({ threadId: thread.id, app: thread.appKey === '' ? null : thread.appKey });
    } catch {
      // A notice is a nicety: the next read finds the change.
    }
  }

  const senderOf = (line: string | null): SmsSender | undefined => (line !== null && E164.test(line) ? { kind: 'number', value: line } : undefined);

  /** The fixed answer, once in its period, never to a stopped number. Every way it can fail ends quietly: nothing is retried. */
  async function answerNotRead(e164: string, hashes: readonly AddressHash[], app: string, reply: SmsReplyReceived): Promise<TextReceived> {
    const texts = deps.texts();
    if (texts === null) return 'not-read';
    if (await deps.consent.stop.has(e164, null)) return 'not-read';
    const at = now();
    if (!(await store.takeAnswer(await ring.hashForWrite(textSubject(e164)), hashes, at - NOT_READ_EVERY_MS, at))) return 'not-read';
    try {
      const business = await deps.business(app === '' ? null : app);
      const sender = senderOf(reply.to);
      const locale = await deps.locale();
      const prepared = await texts.prepare({
        phone: e164,
        textClass: 'service',
        // They wrote a moment ago and are waiting: this answers them, at any hour.
        waiting: true,
        answering: true,
        template: notReadText({ locale, business, to: e164 }),
        language: locale,
        values: {},
        zone: await deps.zone(app === '' ? null : app),
        business,
        ...(sender === undefined ? {} : { sender }),
      });
      if (prepared.action !== 'send') return 'not-read';
      const queued = await texts.queue(prepared, { messageKey: `texts-not-read:${reply.eventId}`, claimKey: 'answer' });
      return queued.queued ? 'answered-not-read' : 'not-read';
    } catch {
      return 'not-read';
    }
  }

  function viewOfMessage(message: TextThreadMessageRecord, body: string | null, delivery: { state: string; reason: string | null; providerStatus: string | null } | undefined): TextItemView {
    const queued = message.outcome === 'queued' || message.outcome === 'held';
    return {
      id: message.id,
      source: 'message',
      direction: message.direction,
      kind: message.kind,
      body,
      template: null,
      at: message.at,
      by: message.by,
      delivery: delivery === undefined ? null : { status: deliveryStatusFor(delivery.state, delivery.providerStatus), reason: delivery.reason },
      confirmed: message.kind === 'stop' ? message.outcome === 'confirmation-asked' : null,
      refused: message.direction === 'out' && !queued && message.outcome !== null ? message.outcome : null,
    };
  }

  async function threadView(thread: TextThreadRecord, latest: TextThreadMessageRecord | undefined, senderKind: 'number' | 'name' | null): Promise<TextThreadView> {
    const phone = await open(thread.phoneEncrypted, THREAD_PHONE_PURPOSE);
    const parsed = phone === null ? null : parsePhone(phone, null);
    const body = latest === undefined ? null : await open(latest.sealedBody, THREAD_BODY_PURPOSE);
    return {
      id: thread.id,
      app: thread.appKey === '' ? null : thread.appKey,
      phone,
      masked: thread.phoneMasked,
      line: thread.line,
      record: thread.record,
      lastAt: thread.lastAt,
      lastDirection: thread.lastDirection,
      lastKind: thread.lastKind,
      preview: body === null ? null : [...body].slice(0, PREVIEW_MAX).join(''),
      unread: thread.unread,
      readAt: thread.readAt,
      readBy: thread.readBy,
      stopped: phone === null ? true : await deps.consent.stop.has(phone, null),
      theyCanReply: senderKind === 'number' && parsed !== null && parsed.ok && !NO_REPLY_COUNTRIES.has(parsed.country),
    };
  }

  async function senderKindNow(): Promise<'number' | 'name' | null> {
    const sender = (await deps.sms.view())?.sender ?? null;
    return sender === null ? null : sender.kind === 'number' ? 'number' : 'name';
  }

  /** Prepare, queue, keep: the one way a person's text goes. */
  async function send(input: TextSendInput & { phone: unknown; country: string | null; app: string; answering: boolean; waiting: boolean; sender: SmsSender | undefined; messageKey: string; kind: 'reply' | 'text'; record?: TextThreadRecordRef | undefined }): Promise<{ thread: TextThreadRecord | null; outcome: TextSendOutcome; message: TextThreadMessageRecord | null }> {
    const texts = deps.texts();
    if (texts === null) return { thread: null, outcome: { outcome: 'refused', reason: 'not-connected' }, message: null };
    const app = input.app === '' ? null : input.app;
    let prepared: TextPrepared;
    try {
      const business = await deps.business(app);
      prepared = await texts.prepare({
        phone: input.phone,
        country: input.country,
        textClass: 'service',
        waiting: input.waiting,
        answering: input.answering,
        template: input.body,
        language: await deps.locale(),
        values: {},
        zone: await deps.zone(app),
        business,
        ...(input.sender === undefined ? {} : { sender: input.sender }),
      });
    } catch {
      return { thread: null, outcome: { outcome: 'refused', reason: 'could-not-check' }, message: null };
    }
    if (prepared.action === 'fail') return { thread: null, outcome: { outcome: 'refused', reason: 'could-not-check' }, message: null };
    if (prepared.action === 'skip') return { thread: null, outcome: { outcome: 'refused', reason: prepared.reason }, message: null };

    const e164 = prepared.text.to;
    let queued;
    try {
      queued = await texts.queue(prepared, { messageKey: input.messageKey, claimKey: input.clientKey, ...(app === null ? {} : { about: { app, template: null } }) });
    } catch {
      return { thread: null, outcome: { outcome: 'refused', reason: 'could-not-queue' }, message: null };
    }
    if (!queued.queued) return { thread: null, outcome: { outcome: 'refused', reason: queued.reason }, message: null };

    const at = now();
    const thread = await threadFor(e164, await hashesOf(e164), input.app, input.sender?.value ?? null, at);
    const outcome: TextSendOutcome = prepared.opensAt === null ? { outcome: 'queued', deliveryId: queued.deliveryId } : { outcome: 'held', deliveryId: queued.deliveryId, opensAt: prepared.opensAt };
    // The same key again finds its delivery, and its message: nothing is kept twice.
    const kept = await store.addMessage({
      threadId: thread.id,
      direction: 'out',
      kind: input.kind,
      sealedBody: await seal(prepared.text.body, THREAD_BODY_PURPOSE),
      deliveryId: queued.deliveryId,
      outcome: outcome.outcome,
      by: input.by,
      at,
    });
    if (kept.added) {
      await store.touch(thread.id, { at, direction: 'out', kind: input.kind, unread: false, ...(input.record === undefined ? {} : { record: input.record }) });
      // Whoever answers has read what they answered.
      if (input.kind === 'reply') await store.markRead(thread.id, input.by, at);
      changed(thread);
    }
    return { thread, outcome, message: kept.message };
  }

  async function canReplyOf(viewer: TextViewer, thread: TextThreadRecord, phone: string | null, answering: boolean): Promise<{ ok: boolean; reason: TextReplyBlock | null }> {
    const no = (reason: TextReplyBlock) => ({ ok: false, reason });
    if (!mayReplyApp(viewer, thread.appKey)) return no('not-allowed');
    if (phone === null || (await deps.consent.stop.has(phone, null))) return no('stopped');
    const view = await deps.sms.view();
    if (view === null || !view.keyReadable || deps.texts() === null) return no('not-connected');
    const parsed = parsePhone(phone, null);
    if (parsed.ok && parsed.callingCode === '86') return no('country-blocked');
    if (parsed.ok && parsed.receivesText === 'no') return no('cannot-receive-text');
    if (!answering && (await deps.consent.standing({ phone }, 'text-service')).state !== 'yes') return no('no-consent');
    return { ok: true, reason: null };
  }

  return {
    repliesOf,

    async received(reply) {
      const e164 = exact(reply.from, null);
      // Not a number a text can go back to (a short code): nothing to keep or answer.
      if (e164 === null) return 'not-noted';
      const hashes = await hashesOf(e164);

      if (reply.kind === 'stop' || reply.kind === 'start') {
        // A note in the conversation it ends or reopens. It never starts one.
        const app = (await store.lastAppOf(hashes)) ?? '';
        const thread = (await store.findThread(hashes, app)) ?? (await store.threadsOf(hashes)).sort((a, b) => b.lastAt - a.lastAt)[0] ?? null;
        if (thread === null) return 'not-noted';
        const kept = await store.addMessage({
          threadId: thread.id,
          direction: 'in',
          kind: reply.kind,
          sealedBody: await seal(reply.text, THREAD_BODY_PURPOSE),
          eventId: reply.eventId,
          outcome: reply.kind === 'stop' ? (reply.confirmed === true ? 'confirmation-asked' : 'no-confirmation') : null,
          at: reply.at,
        });
        if (kept.added) {
          await store.touch(thread.id, { at: reply.at, direction: 'in', kind: reply.kind, unread: true });
          changed(thread);
        }
        return kept.added ? 'noted' : 'already-kept';
      }

      // The business's own number writing to itself would answer itself for ever.
      const own = (await deps.sms.view())?.sender;
      if (own?.kind === 'number' && own.value === e164) return 'own-sender';

      const app = (await store.lastAppOf(hashes)) ?? '';
      if ((await repliesOf(app)) === 'off') {
        // The provider already answered its own HELP: a second answer would only repeat it.
        if (reply.kind === 'help' && reply.answered) return 'not-read';
        return answerNotRead(e164, hashes, app, reply);
      }

      const thread = await threadFor(e164, hashes, app, reply.to !== null && E164.test(reply.to) ? reply.to : null, reply.at);
      const kept = await store.addMessage({ threadId: thread.id, direction: 'in', kind: reply.kind, sealedBody: await seal(reply.text, THREAD_BODY_PURPOSE), eventId: reply.eventId, at: reply.at });
      if (kept.added) {
        await store.touch(thread.id, { at: reply.at, direction: 'in', kind: reply.kind, unread: true, line: reply.to !== null && E164.test(reply.to) ? reply.to : null });
        changed(thread);
      }
      return kept.added ? 'kept' : 'already-kept';
    },

    async list(viewer, query) {
      if (!readsAny(viewer)) return { threads: [], next: null, unread: 0 };
      const after = readCursor(query.cursor);
      if (after === null) throw new TextCursorError();
      const apps = viewer.everything !== null ? 'all' : [...viewer.apps.keys()];
      const app = query.app === undefined ? undefined : (query.app ?? '');
      const rows = await store.page({ apps, ...(app === undefined ? {} : { app }), unreadOnly: query.unreadOnly, limit: query.limit + 1, after: after === undefined ? undefined : { lastAt: after.at, id: after.id } });
      const shown = rows.slice(0, query.limit);
      const latest = await store.latestMessages(shown.map((row) => row.id));
      const senderKind = await senderKindNow();
      const threads = [];
      for (const row of shown) threads.push(await threadView(row, latest.get(row.id), senderKind));
      let unread = 0;
      for (const [key, count] of await store.unreadByApp()) if (mayReadApp(viewer, key)) unread += count;
      const last = shown.at(-1);
      return { threads, next: rows.length > query.limit && last !== undefined ? cursorOf({ at: last.lastAt, id: last.id }) : null, unread };
    },

    async thread(viewer, id, opts) {
      const thread = await store.threadById(id);
      if (thread === null || !mayReadApp(viewer, thread.appKey)) return null;
      const before = readCursor(opts.cursor);
      if (before === null) throw new TextCursorError();
      const messages = await store.messages(thread.id, { limit: opts.limit + 1, before });
      const phone = await open(thread.phoneEncrypted, THREAD_PHONE_PURPOSE);
      // Under every key version: a delivery written before the keys were renewed is still this number's.
      const sent = await store.sentByApp(phone === null ? [thread.phone] : await hashesOf(phone), thread.appKey, { limit: opts.limit + 1, before: before?.at });
      const states = await store.deliveryStates(messages.flatMap((message) => (message.deliveryId === null ? [] : [message.deliveryId])));
      const items: TextItemView[] = [];
      for (const message of messages) items.push(viewOfMessage(message, await open(message.sealedBody, THREAD_BODY_PURPOSE), message.deliveryId === null ? undefined : states.get(message.deliveryId)));
      const seen = new Set(items.map((item) => item.id));
      for (const one of sent) {
        if (seen.has(one.deliveryId)) continue;
        seen.add(one.deliveryId);
        items.push({ id: one.deliveryId, source: 'app', direction: 'out', kind: 'template', body: null, template: one.template, at: one.at, by: null, delivery: { status: deliveryStatusFor(one.state, one.providerStatus), reason: one.reason }, confirmed: null, refused: null });
      }
      const ordered = items
        .filter((item) => before === undefined || item.at < before.at || (item.at === before.at && item.id < before.id))
        .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      const page = ordered.slice(0, opts.limit);
      const last = page.at(-1);
      const lastIn = await store.lastIn(thread.id);
      const answering = lastIn !== null && now() - lastIn <= TEXT_ANSWER_WINDOW_MS;
      const view = await threadView(thread, messages[0], await senderKindNow());
      return {
        thread: view,
        items: page,
        next: ordered.length > opts.limit && last !== undefined ? cursorOf({ at: last.at, id: last.id }) : null,
        answering,
        canReply: await canReplyOf(viewer, thread, view.phone, answering),
      };
    },

    async reply(viewer, id, input) {
      const thread = await store.threadById(id);
      if (thread === null || !mayReadApp(viewer, thread.appKey)) return null;
      if (!mayReplyApp(viewer, thread.appKey)) return { thread, outcome: { outcome: 'refused', reason: 'not-allowed' }, item: null };
      const phone = await open(thread.phoneEncrypted, THREAD_PHONE_PURPOSE);
      if (phone === null) return { thread, outcome: { outcome: 'refused', reason: 'stopped' }, item: null };
      const lastIn = await store.lastIn(thread.id);
      const since = lastIn === null ? null : now() - lastIn;
      const sent = await send({
        ...input,
        phone,
        country: null,
        app: thread.appKey,
        answering: since !== null && since <= TEXT_ANSWER_WINDOW_MS,
        waiting: since !== null && since <= TEXT_WAITING_MS,
        sender: senderOf(thread.line),
        messageKey: `texts-reply:${thread.id}:${input.clientKey}`,
        kind: 'reply',
      });
      const message = sent.message;
      const states = message?.deliveryId == null ? new Map() : await store.deliveryStates([message.deliveryId]);
      return {
        thread: sent.thread ?? thread,
        outcome: sent.outcome,
        item: message === null ? null : viewOfMessage(message, await open(message.sealedBody, THREAD_BODY_PURPOSE), message.deliveryId === null ? undefined : states.get(message.deliveryId)),
      };
    },

    async markRead(viewer, id, by) {
      const thread = await store.threadById(id);
      if (thread === null || !mayReadApp(viewer, thread.appKey)) return null;
      await store.markRead(thread.id, by, now());
      changed(thread);
      return store.threadById(thread.id);
    },

    async sendToRecord(input) {
      const app = input.app ?? '';
      // A local number is read in the account's own country first, as the send path reads it.
      const country = (await deps.sms.view())?.defaultCountry ?? input.country;
      const e164 = exact(input.phone, country);
      if (e164 === null) return { threadId: null, outcome: { outcome: 'refused', reason: 'unreadable-phone' }, masked: null };
      const existing = await store.findThread(await hashesOf(e164), app);
      const lastIn = existing === null ? null : await store.lastIn(existing.id);
      const since = lastIn === null ? null : now() - lastIn;
      const sent = await send({
        ...input,
        phone: e164,
        country,
        app,
        answering: since !== null && since <= TEXT_ANSWER_WINDOW_MS,
        waiting: since !== null && since <= TEXT_WAITING_MS,
        sender: senderOf(existing?.line ?? null),
        messageKey: `texts-record:${input.record.connectionId}:${input.record.table}:${input.record.key}:${input.clientKey}`,
        kind: 'text',
        record: input.record,
      });
      return { threadId: sent.thread?.id ?? existing?.id ?? null, outcome: sent.outcome, masked: maskPhone(e164) };
    },

    async switches() {
      const [apps, switches] = await Promise.all([deps.apps(), store.switches()]);
      const byKey = new Map<string, TextReplySwitchRecord>(switches.map((one) => [one.appKey, one]));
      const views = apps.map((app) => {
        const switched = byKey.get(app.key);
        return { app: app.key, name: app.name, replies: switched?.replies ?? app.replies, starts: app.replies, changedAt: switched?.changedAt ?? null, changedBy: switched?.changedBy ?? null };
      });
      return { apps: views, noApp: views.some((view) => view.replies === 'off') ? 'off' : 'on' };
    },

    async setReplies(app, replies, by) {
      const known = (await deps.apps()).find((one) => one.key === app);
      if (known === undefined) return null;
      const at = now();
      await store.setSwitch(app, replies, by, at);
      return { app, name: known.name, replies, starts: known.replies, changedAt: at, changedBy: by };
    },

    async sweep() {
      const at = now();
      return store.sweep(at - TEXT_THREAD_RETAIN_MS, at - NOT_READ_EVERY_MS, SWEEP_BATCH);
    },

    async eraseFor(e164) {
      return store.eraseFor(await hashesOf(e164));
    },

    async countFor(e164) {
      return store.countFor(await hashesOf(e164));
    },

    async any() {
      const db = deps.meta.db;
      const thread = await db.selectFrom('adminium_text_threads').select('id').limit(1).executeTakeFirst();
      if (thread !== undefined) return true;
      return (await db.selectFrom('adminium_text_auto_answers').select('id').limit(1).executeTakeFirst()) !== undefined;
    },
  };
}
