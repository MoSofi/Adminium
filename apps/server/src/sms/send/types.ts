// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of the text send path: what a delivery record can say, and every
 * reason a text did not go. Each reason is safe to log: none holds a number or
 * a word of the message.
 *
 * ─── A DELIVERY'S STATES ────────────────────────────────────────────────────
 *
 *   prepared         queued, no try made
 *   retrying         a try certainly did not arrive, or may be repeated under its key
 *   handing-over     THE MARKER: saved before the provider is called. A row found
 *                    here after a crash may have gone
 *   accepted         the provider took it
 *   provider-failed  the provider took it and reports it failed
 *   refused          the provider refused it, and nothing earlier may have gone
 *   unknown          it may have gone: never resent, a person checks first
 *   skipped          a rule stopped it before any hand-over
 *   not-sent         given up, and certainly never handed over
 *   checked-went     a person checked an unknown: it went
 *   checked-not-sent a person checked an unknown: it did not go
 */
import type { AddressHash, ConsentPerson } from '@adminium/meta';

import type { TextClass, TextOptOut, TextRefusal } from '../consent/types.js';
import type { SmsNotTakenReason, SmsPrice, SmsProviderKey, SmsRefusalReason, SmsSender, SmsUnknownReason } from '../types.js';

export const TEXT_DELIVERY_STATES = ['prepared', 'retrying', 'handing-over', 'accepted', 'provider-failed', 'refused', 'unknown', 'skipped', 'not-sent', 'checked-went', 'checked-not-sent'] as const;
export type TextDeliveryState = (typeof TEXT_DELIVERY_STATES)[number];

/** States a job may still act on. Every other state is final. */
export const TEXT_OPEN_STATES: readonly TextDeliveryState[] = ['prepared', 'retrying', 'handing-over'];

/** States that hold the message's one open slot: it may still go, or may have gone and nobody has checked. */
export const TEXT_UNSETTLED_STATES: readonly TextDeliveryState[] = [...TEXT_OPEN_STATES, 'unknown'];

/** How a text is timed: `waiting` is one the customer is waiting for right now, and may go at any hour. */
export type TextTiming = 'service' | 'waiting' | 'marketing';

/** Why a template or a filled text cannot go. */
export type TextComposeRefusal =
  | 'template-empty'
  /** It reads a sign-in link, a survey or other minted link, a code or a QR value. */
  | 'credential-in-template'
  /** It asks the customer to reply YES, which a provider reads as an opt-in. */
  | 'asks-for-yes'
  | 'unfilled-placeholder'
  | 'value-too-long'
  /** A filled value carries a link. Links belong in the template's own words. */
  | 'value-has-link'
  /** Over the most segments or characters a text may run to. */
  | 'too-long'
  /** A sender that cannot take replies, and no way to reach the business was given. */
  | 'no-opt-out-contact'
  /** A sender that cannot take replies, and a filled value still tells the reader to reply with a stop word. */
  | 'promises-reply';

export type TextSkipReason =
  | TextRefusal
  | TextComposeRefusal
  | 'not-connected'
  | 'no-sender'
  | 'off-by-operator'
  | 'daily-limit'
  /** The send window would hold it past the moment it is about. */
  | 'past-its-moment'
  /** No moment within two weeks has the window open in every time zone. */
  | 'no-send-window'
  /** The way to opt out changed after the text was written, so its last line would be wrong. */
  | 'opt-out-changed'
  /** What it is about was called off while it waited for its window, or its row no longer holds this number. */
  | 'no-longer-needed';

export type TextNotSentReason = SmsNotTakenReason | 'envelope-unreadable' | 'could-not-check' | 'could-not-queue';

export type TextDeliveryReason = TextSkipReason | TextNotSentReason | SmsRefusalReason | SmsUnknownReason;

/** What one run of the `sms.send` job did. It is kept as the job's result, so it holds stable words only. */
export type SmsSendOutcome =
  | { outcome: 'accepted' | 'provider-failed' | 'refused' | 'unknown' | 'skipped' | 'not-sent' | 'checked-went' | 'checked-not-sent'; reason: TextDeliveryReason | null }
  | { outcome: 'waiting'; until: number }
  /** Another worker holds this message. This run did nothing. */
  | { outcome: 'busy' }
  | { outcome: 'missing' };

export interface TextDelivery {
  /** Also the idempotency key of every try. Holds nothing personal. */
  id: string;
  /** One claim of one message: a second queueing of the same claim finds this row. */
  claimHash: string;
  /** The message across claims. While a delivery is unsettled, the store holds this in a unique column, so a second cannot open. */
  messageHash: string;
  phone: AddressHash | null;
  /** `+49 ••• 789`. Never the number. */
  phoneMasked: string | null;
  textClass: TextClass;
  state: TextDeliveryState;
  reason: TextDeliveryReason | null;
  provider: SmsProviderKey | null;
  providerMessageId: string | null;
  providerStatus: string | null;
  /** The provider's numeric error code from its latest report. */
  providerErrorCode: string | null;
  segments: number | null;
  price: SmsPrice | null;
  estimatedSegments: number;
  encoding: 'gsm-7' | 'ucs-2';
  version: number;
  attempts: number;
  /** The marker: when the try now in flight was handed over. */
  attemptStartedAt: number | null;
  attemptAccount: string | null;
  /** When the first try that may have gone was handed over. */
  mayHaveGoneAt: number | null;
  mayHaveGoneAccount: string | null;
  /** The business day whose limit this message holds a slot of. */
  slotDay: string | null;
  /** A provider said this person opted out, and the stop list has not been written yet. */
  stopOwedAt: number | null;
  /** The source row this delivery reports to. Holds its key, never a number or the words. */
  reportTarget: TextSendReport | null;
  /** This delivery ended (or moved) and the source row has not been told yet. */
  settleOwedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** The source row a delivery reports to. Its key, never a number or the words. */
export interface TextSendReport {
  app: string;
  connectionId: string;
  table: string;
  pk: Record<string, string | number>;
  /** When the source row was claimed: a row sent again since is another message's. */
  sentAt?: number | undefined;
}

/** What is sealed into the job: the only place the number and the words are held. */
export interface SealedText {
  to: string;
  body: string;
  textClass: TextClass;
  timing: TextTiming;
  /** The country of the number. */
  country: string;
  /** The business's clock. */
  zone: string | null;
  /** The moment the text is about: it is not sent after this. */
  notAfter: number | null;
  sender: SmsSender;
  /** The opt-out its last line was written for. */
  optOut: TextOptOut;
  person: ConsentPerson | null;
}
