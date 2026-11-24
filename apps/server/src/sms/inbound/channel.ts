// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS channel on the inbound core: proving a delivery, and what each stored
 * event does.
 *
 *   a reply     STOP goes on the stop list for every sender of this business,
 *               START lifts a person's own stop and never records a yes, and
 *               anything else goes to the replies store when there is one. A
 *               STOP or START is told to that store too, once it is done, as
 *               a note it may keep: a store that cannot keep it changes
 *               nothing about the STOP
 *   a report    moves the message's status, and a provider's "this person opted
 *               out" also goes on the stop list
 *   an opt-out  found by the catch-up: on the stop list
 *
 * If the stop list cannot be written the job throws, so the event is retried
 * and ends on the failed list. It is never dropped.
 *
 * Twilio retries a failed webhook only on a connection failure by default, so a
 * 503 here would lose a STOP. The address it is given carries its documented
 * retry override, in a `#` part that Twilio leaves out of the signature. The
 * sweep also runs a short catch-up, for whatever outlasts those retries.
 */
import type { MetaDb } from '@adminium/meta';

import { storedPublicOrigin } from '../../email/door-reach.js';
import { ValidationFailedError } from '../../errors.js';
import { InboundFailedError, InboundRetryError, inboundAddress, inboundToken, type InboundAccept, type InboundChannel, type InboundHandled, type InboundOpened, type InboundProof } from '../../inbound/index.js';
import { reachability, type ReachabilityState } from '../../payments/reachability.js';
import type { TextConsentService } from '../consent/index.js';
import { accountRefOf, type SmsCredentials } from '../credentials.js';
import type { TextReport } from '../send/store.js';
import type { SmsService } from '../service.js';
import { TELNYX_CODES } from '../telnyx.js';
import { TWILIO_CODES } from '../twilio.js';
import { SMS_PROVIDERS, type SmsProviderKey } from '../types.js';
import { createSmsCatchUp, type SmsCatchUp, type SmsCatchUpResult } from './catch-up.js';
import { readControlWord } from './control-words.js';
import { deliveryStatusOf } from './delivery.js';
import { SMS_INBOUND_CHANNEL, readTelnyxBody, readTwilioForm, smsEventBody, type SmsEventBody } from './payload.js';
import { verifyTelnyx, verifyTwilio } from './signature.js';
import { SMS_STOP_CONFIRMATION, decideStopConfirmation, type SmsStopConfirmation } from './stop-reply.js';

export { SMS_INBOUND_CHANNEL };
/** A text's webhook is a few kilobytes. Far above that is not one. */
export const SMS_INBOUND_BODY_LIMIT = 64 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * A STOP or START row outlives the rest. Twilio's signature has no time in it,
 * so this row is what refuses a recorded START sent again long after.
 */
export const SMS_CONTROL_RETAIN_MS = 400 * DAY_MS;

/**
 * Twilio's connection override: retry on any failure, five times (its most).
 * Its default retries only a failed connection, once, so a 503 would be final.
 */
export const TWILIO_RETRY_OVERRIDE = '#rp=all&rc=5';

/** How often the sweep's catch-up asks the provider, and how far back. A run that could not finish is tried at the next sweep. */
export const SMS_SWEEP_CATCH_UP_EVERY_MS = 30 * 60 * 1000;
export const SMS_SWEEP_CATCH_UP_LOOKBACK_MS = 2 * DAY_MS;
export const SMS_SWEEP_CATCH_UP_MAX_PAGES = 3;

/** An empty TwiML answer: Twilio reads a webhook's reply as instructions, and this one says "send nothing". */
const TWIML_NOTHING = { contentType: 'text/xml', body: '<?xml version="1.0" encoding="UTF-8"?><Response></Response>' };

export type SmsReplyState = ReachabilityState | 'not-connected' | 'key-unreadable';

export interface SmsReplyReach {
  state: SmsReplyState;
  /** The answer for the marketing check's `repliesReachUs`, and the card. */
  canReceiveStop: boolean;
  origin: string | null;
  /** The address to give the provider. It holds the door's token: only for whoever manages SMS. */
  address: string | null;
}

export interface SmsReplyReceived {
  eventId: string;
  from: string;
  to: string | null;
  text: string;
  /** `stop` and `start` come once the stop list has them, as a note for the conversation. */
  kind: 'help' | 'message' | 'stop' | 'start';
  at: number;
  /** The provider answered this message itself (its own HELP or STOP reply). */
  answered: boolean;
  /** A STOP's one confirmation was asked for. */
  confirmed?: boolean | undefined;
}

export interface SmsInboundDeps {
  meta: MetaDb;
  /** `ADMINIUM_SECRET`. */
  secret: string;
  sms: Pick<SmsService, 'credentials' | 'view'>;
  consent: { stop: Pick<TextConsentService['stop'], 'add' | 'start' | 'entryFor'> };
  /** The send path's `applyReport`, given the provider's own word. Answers null when no message has that id. */
  reports: (report: TextReport) => Promise<unknown>;
  /** The send path's `confirmStop`: the one plain confirmation. */
  confirmations: (request: SmsStopConfirmation) => Promise<unknown>;
  /**
   * Where an ordinary reply is kept. With none, its text goes when the event
   * finishes. A throw retries the event, so it must be safe to call twice with
   * one `eventId`.
   */
  replies?: ((reply: SmsReplyReceived) => Promise<unknown>) | undefined;
  networkFeatures: boolean;
  desktop: boolean;
  trustProxy: boolean;
  /** Trial mode: the operator switched SMS off. */
  operatorOff?: (() => boolean) | undefined;
  /** How each of the sweep's catch-ups ended, for the card. Holds counts and stable words only. */
  onCatchUp?: ((result: SmsCatchUpResult) => void) | undefined;
  /** For the catch-up's calls to the provider. */
  fetch?: typeof globalThis.fetch | undefined;
  now?: (() => number) | undefined;
}

export interface SmsInboundChannel extends InboundChannel {
  /** Whether this server can hear a STOP, and why not. */
  replyReach(): Promise<SmsReplyReach>;
}

const isProvider = (source: string): source is SmsProviderKey => (SMS_PROVIDERS as readonly string[]).includes(source);

function headerOf(headers: Readonly<Record<string, string | string[] | undefined>>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isOptOutCode(provider: SmsProviderKey, code: string | null): boolean {
  if (code === null) return false;
  const table = provider === 'twilio' ? TWILIO_CODES : TELNYX_CODES;
  if (!Object.hasOwn(table, code)) return false;
  const meaning = table[code];
  return meaning?.kind === 'refused' && meaning.reason === 'opted-out';
}

export function createSmsInboundChannel(deps: SmsInboundDeps): SmsInboundChannel {
  const now = deps.now ?? Date.now;
  let sweepCatchUp: SmsCatchUp | null = null;
  let nextCatchUpAt = 0;

  async function connected(source: string): Promise<SmsCredentials | null> {
    const credentials = await deps.sms.credentials();
    return credentials !== null && credentials.provider === source ? credentials : null;
  }

  async function replyReach(): Promise<SmsReplyReach> {
    const origin = await storedPublicOrigin(deps.meta);
    const answer = reachability({
      operatorOff: deps.operatorOff?.() === true,
      networkFeatures: deps.networkFeatures,
      desktop: deps.desktop,
      trustProxy: deps.trustProxy,
      publicOrigin: origin,
      forwarded: false,
    });
    const closed = (state: SmsReplyState): SmsReplyReach => ({ state, canReceiveStop: false, origin: answer.origin, address: null });
    if (answer.state !== 'reachable') return closed(answer.state);
    const view = await deps.sms.view();
    if (view === null) return closed('not-connected');
    const credentials = view.keyReadable ? await deps.sms.credentials() : null;
    if (credentials === null || answer.origin === null) return closed('key-unreadable');
    const token = inboundToken(deps.secret, SMS_INBOUND_CHANNEL, credentials.provider, accountRefOf(credentials));
    const door = inboundAddress(answer.origin, SMS_INBOUND_CHANNEL, credentials.provider, token);
    return { state: 'reachable', canReceiveStop: true, origin: answer.origin, address: credentials.provider === 'twilio' ? `${door}${TWILIO_RETRY_OVERRIDE}` : door };
  }

  async function addStop(phone: string, reason: 'text-stop' | 'provider-opt-out', provider: SmsProviderKey, at: number): Promise<boolean> {
    // The business's own number on its stop list would stop nothing and hide a mistake: it goes to the failed list.
    const own = (await deps.sms.view())?.sender;
    if (own?.kind === 'number' && own.value === phone) throw new InboundFailedError('own-sender');
    try {
      return (await deps.consent.stop.add({ phone, reason, origin: provider, at })).added;
    } catch (error) {
      // Not a number this list can hold: retrying cannot change that. Anything else is retried by the job.
      if (error instanceof ValidationFailedError) throw new InboundFailedError('unreadable-number');
      throw error;
    }
  }

  async function onReply(event: InboundOpened, reply: Extract<SmsEventBody, { type: 'reply' }>, provider: SmsProviderKey): Promise<InboundHandled> {
    const current = now();
    // A signed time in the future must not outrank a real STOP or START.
    const at = Math.min(event.occurredAt ?? event.receivedAt, current);
    const control = readControlWord(reply.text);

    /** A STOP or START told to the replies store, after the fact. Its failure must never undo or repeat the stop list's work. */
    const note = async (kind: 'stop' | 'start', confirmed: boolean): Promise<void> => {
      try {
        await deps.replies?.({ eventId: event.id, from: reply.from, to: reply.to, text: reply.text, kind, at, answered: reply.answered, confirmed });
      } catch {
        // The conversation misses a line. The stop list, which is what counts, has it.
      }
    };

    if (control.kind === 'stop') {
      const added = await addStop(reply.from, 'text-stop', provider, at);
      const decision = decideStopConfirmation({ provider, added, answered: reply.answered, whole: control.whole, via: reply.via, occurredAt: at, now: current });
      if (!decision.send) {
        await note('stop', false);
        return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS, reason: decision.reason };
      }
      try {
        await deps.confirmations({ to: reply.from, from: reply.to, body: SMS_STOP_CONFIRMATION, language: control.language, sendBy: decision.sendBy, dedupeKey: `sms-stop-confirm:${event.id}` });
      } catch {
        // The STOP is on the list. A retry would see "already stopped", so at worst no confirmation goes.
        await note('stop', false);
        return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS, reason: 'confirmation-failed' };
      }
      await note('stop', true);
      return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS, reason: 'confirmation-asked' };
    }

    if (control.kind === 'start') {
      // Events arrive in any order: a START not clearly newer than the stop it would lift leaves it in place.
      const entry = await deps.consent.stop.entryFor(reply.from, null);
      if (entry !== null && entry.addedAt >= at) return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS, reason: 'older-than-stop' };
      const lifted = await deps.consent.stop.start({ phone: reply.from, at });
      await note('start', false);
      return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS, reason: `start-${lifted}` };
    }

    await deps.replies?.({ eventId: event.id, from: reply.from, to: reply.to, text: reply.text, kind: control.kind === 'help' ? 'help' : 'message', at, answered: reply.answered });
    return { outcome: 'processed' };
  }

  async function onStatus(event: InboundOpened, report: Extract<SmsEventBody, { type: 'status' }>, provider: SmsProviderKey): Promise<InboundHandled> {
    const at = Math.min(event.occurredAt ?? event.receivedAt, now());
    // First, and whatever the ledger says: the person opted out even if this message is not one of ours.
    if (report.to !== null && isOptOutCode(provider, report.errorCode)) await addStop(report.to, 'provider-opt-out', provider, at);
    const status = deliveryStatusOf(provider, report.word);
    if (status === null) return { outcome: 'ignored', reason: 'not-a-status' };
    const applied = await deps.reports({ provider, messageId: report.messageId, status: report.word, errorCode: report.errorCode, at });
    // It can outrun the send path writing the id down. After the tries, it is someone else's message on this account.
    if (applied === null) throw new InboundRetryError('no-such-message', { finally: 'ignored' });
    return { outcome: 'processed', reason: 'applied' };
  }

  return {
    channel: SMS_INBOUND_CHANNEL,
    bodyLimit: SMS_INBOUND_BODY_LIMIT,
    replyReach,

    async reach() {
      const answer = await replyReach();
      // Open on the address alone: an unconnected account is the next step's 503.
      const open = answer.state === 'reachable' || answer.state === 'not-connected' || answer.state === 'key-unreadable';
      return { open, origin: answer.origin };
    },

    async account(source) {
      if (!isProvider(source)) return { state: 'unknown' };
      const credentials = await connected(source);
      return credentials === null ? { state: 'unavailable' } : { state: 'ready', account: accountRefOf(credentials) };
    },

    async prove(delivery): Promise<InboundProof> {
      const credentials = await connected(delivery.source);
      if (credentials === null) return { genuine: false, answer: 503, reason: 'not-connected' };

      if (credentials.provider === 'twilio') {
        const valid = verifyTwilio({ address: delivery.publicUrl, rawBody: delivery.body, signature: headerOf(delivery.headers, 'x-twilio-signature'), authToken: credentials.authToken.reveal() });
        if (!valid) return { genuine: false, answer: 403, reason: 'bad-signature' };
        const form = new URLSearchParams(delivery.body.toString('utf8'));
        if (form.get('AccountSid') !== credentials.accountSid) return { genuine: false, answer: 403, reason: 'other-account' };
        const read = readTwilioForm(form);
        return read.ok ? { genuine: true, events: read.events, reply: TWIML_NOTHING } : { genuine: false, answer: 400, reason: read.reason };
      }

      const verdict = verifyTelnyx({
        rawBody: delivery.body,
        signature: headerOf(delivery.headers, 'telnyx-signature-ed25519'),
        timestamp: headerOf(delivery.headers, 'telnyx-timestamp'),
        publicKey: credentials.publicKey,
        now: delivery.now,
      });
      if (verdict !== 'genuine') return { genuine: false, answer: 403, reason: verdict };
      const sender = (await deps.sms.view())?.sender;
      const read = readTelnyxBody(delivery.body, credentials.messagingProfileId, sender?.kind === 'number' ? [sender.value] : []);
      return read.ok ? { genuine: true, events: read.events } : { genuine: false, answer: 400, reason: read.reason };
    },

    async catchUp(accept: InboundAccept) {
      // A server told not to reach out does not, whatever it may have missed.
      if (!deps.networkFeatures || deps.operatorOff?.() === true) return;
      const at = now();
      if (at < nextCatchUpAt) return;
      sweepCatchUp ??= createSmsCatchUp({ core: { accept }, sms: deps.sms, fetch: deps.fetch, now, lookbackMs: SMS_SWEEP_CATCH_UP_LOOKBACK_MS, maxPages: SMS_SWEEP_CATCH_UP_MAX_PAGES });
      const result = await sweepCatchUp.run();
      if (result.outcome === 'done') nextCatchUpAt = at + SMS_SWEEP_CATCH_UP_EVERY_MS;
      deps.onCatchUp?.(result);
    },

    hasSource: async () => (await deps.sms.view()) !== null,

    async handle(event) {
      if (!isProvider(event.source)) throw new InboundFailedError('unknown-source');
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.body) as unknown;
      } catch {
        throw new InboundFailedError('unreadable-event');
      }
      const body = smsEventBody.safeParse(parsed);
      if (!body.success) throw new InboundFailedError('unreadable-event');
      if (body.data.type === 'reply') return onReply(event, body.data, event.source);
      if (body.data.type === 'status') return onStatus(event, body.data, event.source);
      const at = Math.min(event.occurredAt ?? event.receivedAt, now());
      await addStop(body.data.phone, 'provider-opt-out', event.source, at);
      return { outcome: 'processed', retainMs: SMS_CONTROL_RETAIN_MS };
    },
  };
}
