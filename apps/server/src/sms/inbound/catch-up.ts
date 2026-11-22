// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Catch-up after downtime: asks the provider what arrived while this server
 * could not hear it, so a STOP is not lost.
 *
 * Bounded (a fixed look-back and page budget) and safe to repeat: everything
 * goes through the store-once table, so what is already held is a duplicate and
 * does nothing. It keeps no cursor on purpose. A cursor moved by a webhook that
 * arrived right after a restart would hide the gap before it.
 *
 *   Twilio   the account's inbound messages, newest first, by `DateSent`
 *   Telnyx   the opt-out list. Telnyx documents no way to list inbound
 *            messages, so an ordinary reply missed there stays missed
 *
 * A provider failure ends the run as `partial`, with what was read so far kept.
 * It never throws for the provider's sake, because it runs during start-up and
 * from the sweep.
 *
 * Twilio is asked for every inbound message on the account, not those to the
 * current sender: a STOP sent to an earlier or a second number still counts.
 *
 * In a Telnyx opt-out record `to` is the person and `from` the sender. A wrong
 * reading would put the business's own number on its stop list, so a record
 * whose `to` is one of its senders is read by its `from`, and one that names no
 * customer is counted in `unreadable`, never dropped unseen.
 */
import type { InboundAccept, InboundCandidate } from '../../inbound/index.js';
import { accountRefOf, type SmsCredentials, type TelnyxCredentials, type TwilioCredentials } from '../credentials.js';
import { SMS_CALL_TIMEOUT_MS, asRecord, callProvider, type SmsCallContext } from '../http.js';
import type { SmsService } from '../service.js';
import { SMS_INBOUND_CHANNEL, optOutCandidate, replyCandidate, replyProviderId } from './payload.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SMS_CATCH_UP_LOOKBACK_MS = 7 * DAY_MS;
export const SMS_CATCH_UP_MAX_PAGES = 10;
const TWILIO_PAGE_SIZE = 200;
const TELNYX_PAGE_SIZE = 250;

const TWILIO_API = 'https://api.twilio.com';
const TELNYX_API = 'https://api.telnyx.com/v2';
const TWILIO_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9][0-9]{6,14}$/;

export interface SmsCatchUpResult {
  outcome: 'done' | 'partial' | 'not-connected' | 'already-running';
  stored: number;
  duplicates: number;
  pages: number;
  /** The page budget ran out with more to read: the oldest of the window was not seen. */
  truncated: boolean;
  /** Entries the provider gave with no customer's number that can be read (a redacted one, or only the business's own). */
  unreadable: number;
  /** Opt-outs stamped with another messaging profile and no sender of this business: not applied, and counted so a person can look. */
  otherProfile: number;
  reason: 'provider-unreachable' | 'provider-refused' | 'unreadable-reply' | 'store-failed' | null;
}

export interface SmsCatchUpDeps {
  core: { accept: InboundAccept };
  sms: Pick<SmsService, 'credentials' | 'view'>;
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
  lookbackMs?: number | undefined;
  maxPages?: number | undefined;
  timeoutMs?: number | undefined;
}

interface Collected {
  events: InboundCandidate[];
  pages: number;
  truncated: boolean;
  unreadable: number;
  otherProfile: number;
  reason: SmsCatchUpResult['reason'];
}

function failureOf(call: Awaited<ReturnType<typeof callProvider>>): SmsCatchUpResult['reason'] | null {
  if (call.kind !== 'answered') return 'provider-unreachable';
  if (call.status < 200 || call.status >= 300) return 'provider-refused';
  return asRecord(call.json) === null ? 'unreadable-reply' : null;
}

async function collectTwilio(credentials: TwilioCredentials, since: number, maxPages: number, context: SmsCallContext): Promise<Collected> {
  const out: Collected = { events: [], pages: 0, truncated: false, unreadable: 0, otherProfile: 0, reason: null };
  const base = `/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`;
  const query = new URLSearchParams({ PageSize: String(TWILIO_PAGE_SIZE), 'DateSent>': new Date(since).toISOString().slice(0, 10) });
  let path: string | null = `${base}?${query.toString()}`;
  const authorization = `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken.reveal()}`).toString('base64')}`;

  while (path !== null) {
    if (out.pages >= maxPages) {
      out.truncated = true;
      break;
    }
    const call = await callProvider(context, { url: `${TWILIO_API}${path}`, method: 'GET', headers: { authorization, accept: 'application/json' } });
    out.reason = failureOf(call);
    if (out.reason !== null || call.kind !== 'answered') break;
    out.pages += 1;
    const reply = asRecord(call.json);
    const messages: unknown[] = Array.isArray(reply?.['messages']) ? (reply['messages'] as unknown[]) : [];
    let reachedOlder = false;
    for (const raw of messages) {
      const message = asRecord(raw);
      if (message === null || message['direction'] !== 'inbound') continue;
      const at = Date.parse(String(message['date_sent'] ?? message['date_created'] ?? ''));
      const when = Number.isFinite(at) ? at : since;
      if (Number.isFinite(at) && at < since) {
        reachedOlder = true;
        continue;
      }
      const sid = message['sid'];
      const from = message['from'];
      const body = message['body'];
      if (typeof sid !== 'string' || !TWILIO_SID.test(sid) || typeof body !== 'string') continue;
      if (typeof from !== 'string' || !E164.test(from)) {
        out.unreadable += 1;
        continue;
      }
      const to = typeof message['to'] === 'string' ? message['to'] : null;
      out.events.push(replyCandidate({ providerId: replyProviderId(sid), from, to, text: body, answered: false, via: 'catch-up', occurredAt: when }));
    }
    if (reachedOlder) break;
    const next: unknown = reply?.['next_page_uri'];
    if (next === null || next === undefined || next === '') break;
    // The key travels with this call: only ever to this account's own list, on the fixed host.
    if (typeof next !== 'string' || !next.startsWith(`${base}?`) || /[\s#\\]/.test(next)) {
      out.reason = 'unreadable-reply';
      break;
    }
    path = next;
  }
  return out;
}

/** The customer in an opt-out record; null when it names none but the business's own numbers. */
function optedOutNumber(to: unknown, from: unknown, senders: readonly string[]): string | null {
  const customer = (value: unknown): value is string => typeof value === 'string' && E164.test(value) && !senders.includes(value);
  if (customer(to)) return to;
  return typeof to === 'string' && senders.includes(to) && customer(from) ? from : null;
}

async function collectTelnyx(credentials: TelnyxCredentials, senders: readonly string[], since: number, maxPages: number, context: SmsCallContext): Promise<Collected> {
  const out: Collected = { events: [], pages: 0, truncated: false, unreadable: 0, otherProfile: 0, reason: null };
  for (let page = 1; ; page += 1) {
    if (page > maxPages) {
      out.truncated = true;
      break;
    }
    const query = new URLSearchParams({
      'filter[messaging_profile_id]': credentials.messagingProfileId,
      'created_at[gte]': new Date(since).toISOString(),
      'page[number]': String(page),
      'page[size]': String(TELNYX_PAGE_SIZE),
      redaction_enabled: 'false',
    });
    const call = await callProvider(context, {
      url: `${TELNYX_API}/messaging_optouts?${query.toString()}`,
      method: 'GET',
      headers: { authorization: `Bearer ${credentials.apiKey.reveal()}`, accept: 'application/json' },
    });
    out.reason = failureOf(call);
    if (out.reason !== null || call.kind !== 'answered') break;
    out.pages += 1;
    const reply = asRecord(call.json);
    const entries: unknown[] = Array.isArray(reply?.['data']) ? (reply['data'] as unknown[]) : [];
    for (const raw of entries) {
      const entry = asRecord(raw);
      if (entry === null) continue;
      const profile = entry['messaging_profile_id'];
      const sentFrom = entry['from'];
      if (typeof profile === 'string' && profile.toLowerCase() !== credentials.messagingProfileId && !(typeof sentFrom === 'string' && senders.includes(sentFrom))) {
        out.otherProfile += 1;
        continue;
      }
      const phone = optedOutNumber(entry['to'], sentFrom, senders);
      const createdAt = entry['created_at'];
      const at = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
      if (phone === null || typeof createdAt !== 'string' || !Number.isFinite(at)) {
        out.unreadable += 1;
        continue;
      }
      out.events.push(optOutCandidate({ phone, createdAt, occurredAt: at }));
    }
    const totalPages = asRecord(reply?.['meta'])?.['total_pages'];
    if (typeof totalPages !== 'number' || page >= totalPages || entries.length === 0) break;
  }
  return out;
}

export interface SmsCatchUp {
  run(): Promise<SmsCatchUpResult>;
}

export function createSmsCatchUp(deps: SmsCatchUpDeps): SmsCatchUp {
  const now = deps.now ?? Date.now;
  let running = false;

  async function once(credentials: SmsCredentials): Promise<SmsCatchUpResult> {
    const since = now() - (deps.lookbackMs ?? SMS_CATCH_UP_LOOKBACK_MS);
    const maxPages = deps.maxPages ?? SMS_CATCH_UP_MAX_PAGES;
    const context: SmsCallContext = { fetch: deps.fetch ?? globalThis.fetch, timeoutMs: deps.timeoutMs ?? SMS_CALL_TIMEOUT_MS };
    let collected: Collected;
    if (credentials.provider === 'twilio') {
      collected = await collectTwilio(credentials, since, maxPages, context);
    } else {
      const sender = (await deps.sms.view())?.sender ?? null;
      collected = await collectTelnyx(credentials, sender?.kind === 'number' ? [sender.value] : [], since, maxPages, context);
    }

    // Oldest first, so a STOP and a later START are queued in the order they were sent.
    const ordered = [...collected.events].sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
    const base = { pages: collected.pages, truncated: collected.truncated, unreadable: collected.unreadable, otherProfile: collected.otherProfile };
    try {
      const { stored, duplicates } = await deps.core.accept({ channel: SMS_INBOUND_CHANNEL, account: accountRefOf(credentials), source: credentials.provider, events: ordered });
      const incomplete = collected.reason !== null || collected.truncated;
      return { outcome: incomplete ? 'partial' : 'done', stored, duplicates, ...base, reason: collected.reason };
    } catch {
      return { outcome: 'partial', stored: 0, duplicates: 0, ...base, reason: 'store-failed' };
    }
  }

  return {
    async run() {
      const idle = { stored: 0, duplicates: 0, pages: 0, truncated: false, unreadable: 0, otherProfile: 0, reason: null };
      if (running) return { outcome: 'already-running', ...idle };
      running = true;
      try {
        const credentials = await deps.sms.credentials();
        if (credentials === null) return { outcome: 'not-connected', ...idle };
        return await once(credentials);
      } finally {
        running = false;
      }
    },
  };
}
