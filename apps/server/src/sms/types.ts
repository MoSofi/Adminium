// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the SMS layer promises its callers, whichever provider carries the text.
 *
 * ─── THE FOUR ANSWERS ───────────────────────────────────────────────────────
 *
 *   accepted   the provider took the message and gave it an id
 *   not-taken  the provider certainly did not take it: safe to try again
 *   refused    it never will, as things stand: the reason says what to fix
 *   unknown    it may have gone. NEVER a failure to retry
 *
 * `unknown` is the answer this layer exists for. A text sent twice is charged
 * twice and reaches a person twice, so anything not proved to be one of the
 * other three is `unknown`, and its `resend` says the only thing a caller may
 * do: `same-key` (the provider de-duplicates on the key) or `check-first`
 * (a person, or the provider's own record, must settle it).
 *
 * No answer carries the message body or a provider's own words, which can
 * quote the body, the number or a key. Only stable reasons and the provider's
 * numeric code.
 */

export const SMS_PROVIDERS = ['twilio', 'telnyx'] as const;
export type SmsProviderKey = (typeof SMS_PROVIDERS)[number];

/** What a provider allows after a timeout. Twilio has no idempotency key; Telnyx honours one for 24 hours. */
export type TimeoutRetry = 'never' | 'same-key';

/** Why the provider certainly did not take the message. */
export const SMS_NOT_TAKEN_REASONS = [
  'rate-limited',
  /** The sender's queue at the provider is full (Twilio 21611, Telnyx 40318). */
  'queue-full',
  /** The provider calls this sender temporarily unusable (Telnyx 40320). */
  'sender-busy',
  /** No connection was ever made: refused, no route, no such name, a bad certificate. */
  'no-connection',
  /** The caller stopped before anything was sent. */
  'cancelled',
] as const;
export type SmsNotTakenReason = (typeof SMS_NOT_TAKEN_REASONS)[number];

/** Why the message will not go as things stand. Stable: the send path logs them and the console words them. */
export const SMS_REFUSAL_REASONS = [
  /** The person opted out at the provider (Twilio 21610, Telnyx 40300). This belongs on the stop list. */
  'opted-out',
  /** No texts go to mainland China. */
  'country-blocked-cn',
  /** The number could not be read (`detail` holds the phone module's reason). */
  'bad-number',
  /** The number reads, but cannot receive a text: a landline, a toll-free number, an extension. */
  'cannot-receive-text',
  /** The provider says the number is invalid (Twilio 21211, Telnyx 40310, 40012). */
  'invalid-number',
  /** The provider says the number is not a mobile (Twilio 21614). */
  'not-mobile',
  /** The destination cannot be reached from this sender (Twilio 21612, Telnyx 40001). */
  'unreachable',
  /** This account may not text that country (Twilio 21408, Telnyx 40309, 40331). */
  'country-not-enabled',
  /** The sender is not a valid sender (Twilio 21212, Telnyx 40305, 40013). */
  'invalid-sender',
  /** The sender cannot send texts (Twilio 21606, Telnyx 40100, 40315, 40321). */
  'sender-cannot-text',
  /** The sender name is not set up or not allowed (Telnyx 40306, 40307, 40325). */
  'sender-name-refused',
  /** US registration is missing (Twilio 30034, Telnyx 40010, 40329, 40330). */
  'sender-not-registered',
  'body-empty',
  /** Over the provider's limit (Twilio 21617, Telnyx 40302, 40328, or the layer's 1,600). */
  'body-too-long',
  /** The provider blocked the content (Telnyx 40322). */
  'content-blocked',
  /** The account's spend limit is reached (Telnyx 40333). */
  'spend-limit',
  /** The account or profile is disabled (Telnyx 40312, 40314). */
  'account-disabled',
  /** The key was refused. */
  'credentials',
  /** No account is connected, or its key no longer opens (the server's secret changed). */
  'not-connected',
  /** No sender is set. */
  'no-sender',
  /** The caller's request is malformed: a bad idempotency key or callback address. */
  'bad-request',
  /** The provider said no, with a code this layer does not know. */
  'provider-refused',
] as const;
export type SmsRefusalReason = (typeof SMS_REFUSAL_REASONS)[number];

/** Why nobody can say whether the message went. */
export const SMS_UNKNOWN_REASONS = [
  'timeout',
  'connection-lost',
  /** The provider answered 5xx, a redirect or a status with no settled meaning. */
  'server-error',
  /** A success with no readable message id. */
  'unreadable-reply',
  /** Telnyx 409: the same key is still being processed. */
  'in-progress',
  /** Telnyx 422 on a keyed request with no message code: the key was used with another body. */
  'key-reused',
  /** An earlier attempt ended unknown, and this provider cannot be retried safely. */
  'earlier-attempt-unknown',
  /** An earlier attempt ended unknown, and the provider's 24-hour replay window has passed. */
  'replay-window-passed',
] as const;
export type SmsUnknownReason = (typeof SMS_UNKNOWN_REASONS)[number];

export interface SmsPrice {
  /** As the provider wrote it, a decimal string. */
  amount: string;
  currency: string;
}

export interface SmsAccepted {
  outcome: 'accepted';
  provider: SmsProviderKey;
  messageId: string;
  /** The provider's status word, bounded (`queued`, `sending`, …), or null. */
  status: string | null;
  segments: number | null;
  price: SmsPrice | null;
  /** Telnyx answered from its replay store: this is the earlier send, not a new one. */
  replayed: boolean;
}

export interface SmsNotTaken {
  outcome: 'not-taken';
  provider: SmsProviderKey;
  reason: SmsNotTakenReason;
  retryAfterMs: number | null;
  providerCode: string | null;
}

export interface SmsRefused {
  outcome: 'refused';
  /** Null when the layer refused before any provider was involved. */
  provider: SmsProviderKey | null;
  reason: SmsRefusalReason;
  /** The phone module's reason, for `bad-number`. */
  detail: string | null;
  providerCode: string | null;
}

export interface SmsUnknown {
  outcome: 'unknown';
  provider: SmsProviderKey;
  reason: SmsUnknownReason;
  /** The only thing a caller may do next. */
  resend: 'same-key' | 'check-first';
  providerCode: string | null;
}

export type SmsProviderResult = SmsAccepted | SmsNotTaken | SmsRefused | SmsUnknown;

/** A send's answer, with the exact number it was for (null when the number could not be read). */
export type SmsSendResult = SmsProviderResult & { to: string | null };

/** A sender. A `name` is one-way: it cannot receive STOP. */
export type SmsSender =
  | { kind: 'number'; value: string }
  | { kind: 'name'; value: string }
  /** Twilio's Messaging Service, or Telnyx's number pool on the messaging profile. */
  | { kind: 'pool'; value: string };

/** What the provider's check concluded about a key. */
export const SMS_CHECK_REASONS = [
  'credentials-refused',
  'profile-not-found',
  'account-suspended',
  'account-closed',
  'account-disabled',
  /** The provider could not be asked, or did not answer sensibly. Nothing is known about the key. */
  'unreachable',
] as const;
export type SmsCheckReason = (typeof SMS_CHECK_REASONS)[number];

export type SmsCheckResult =
  | {
      ok: true;
      /** Already masked: this layer never holds the account's plain name past the provider's reply. */
      accountName: string | null;
      accountType: 'full' | 'trial' | null;
    }
  | { ok: false; reason: SmsCheckReason; providerCode: string | null };

/** A provider's answer about the destination, sender and body, as the layer hands them over. */
export interface SmsOutgoing {
  /** Exact E.164, from the phone module. */
  to: string;
  sender: SmsSender;
  body: string;
  idempotencyKey: string;
  /** Where delivery reports for this message go (https). */
  callbackUrl: string | null;
}
