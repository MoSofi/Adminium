// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words the Texts tabs share: a delivery's state and reason, a check's
 * result, a stop entry's why, and the one sentence about mainland China.
 *
 * Every label is a literal `t()` key, never assembled from a reason, so each
 * one can be found, translated and checked in all eight languages. A reason
 * this version does not know reads as the plain "the provider refused it".
 */
import { getI18nInstance, t } from '../../i18n/t.js';
import type { CheckReason, Delivery, StopReason } from './textsApi.js';

export function activeLocale(): string {
  return getI18nInstance()?.language ?? 'en-US';
}

/** A moment, as this person's language writes a date and time. */
export function stamp(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** The exact +86 sentence (console rules). */
export const cnSentence = (): string =>
  t('studio:texts.cn.sentence', 'Adminium does not send texts to mainland China (+86). Neither provider can promise delivery, replies or a working opt-out there. Taiwan and Hong Kong are not affected.');

export const notAffiliated = (): string => t('studio:texts.notAffiliated', 'Adminium is not affiliated with Twilio, Telnyx or any carrier.');

export const providerName = (provider: 'twilio' | 'telnyx'): string => (provider === 'twilio' ? 'Twilio' : 'Telnyx');

// ─── a delivery ─────────────────────────────────────────────────────────────

export type StatusTone = 'pos' | 'info' | 'warn' | 'danger' | 'neutral';

/** What the row reads as: the comp's statuses. "Sent" is never called delivered. */
export type StatusWord = 'delivered' | 'sent' | 'waiting' | 'unknown' | 'undelivered' | 'failed' | 'skipped' | 'not-sent' | 'checked-went' | 'checked-not-sent';

export const STATUS_WORDS: readonly StatusWord[] = ['delivered', 'sent', 'waiting', 'unknown', 'undelivered', 'failed', 'skipped', 'not-sent', 'checked-went', 'checked-not-sent'];

const UNDELIVERED: ReadonlySet<string> = new Set(['undelivered', 'delivery_failed', 'delivery_unconfirmed']);

export function statusOf(row: Pick<Delivery, 'state' | 'providerStatus'>): StatusWord {
  switch (row.state) {
    case 'accepted':
      return row.providerStatus === 'delivered' ? 'delivered' : 'sent';
    case 'provider-failed':
      return row.providerStatus !== null && UNDELIVERED.has(row.providerStatus) ? 'undelivered' : 'failed';
    case 'refused':
      return 'failed';
    case 'prepared':
    case 'retrying':
    case 'handing-over':
      return 'waiting';
    case 'unknown':
      return 'unknown';
    case 'skipped':
      return 'skipped';
    case 'not-sent':
      return 'not-sent';
    case 'checked-went':
      return 'checked-went';
    case 'checked-not-sent':
      return 'checked-not-sent';
    default:
      return 'failed';
  }
}

export const STATUS_TONE: Readonly<Record<StatusWord, StatusTone>> = {
  delivered: 'pos',
  sent: 'info',
  waiting: 'neutral',
  unknown: 'warn',
  undelivered: 'danger',
  failed: 'danger',
  skipped: 'neutral',
  'not-sent': 'neutral',
  'checked-went': 'pos',
  'checked-not-sent': 'neutral',
};

export function statusLabel(word: StatusWord): string {
  switch (word) {
    case 'delivered':
      return t('studio:texts.status.delivered', 'Delivered');
    case 'sent':
      return t('studio:texts.status.sent', 'Handed to the provider');
    case 'waiting':
      return t('studio:texts.status.waiting', 'Waiting');
    case 'unknown':
      return t('studio:texts.status.unknown', 'Unknown, check before resending');
    case 'undelivered':
      return t('studio:texts.status.undelivered', 'Not delivered');
    case 'failed':
      return t('studio:texts.status.failed', 'Failed');
    case 'skipped':
      return t('studio:texts.status.skipped', 'Skipped');
    case 'not-sent':
      return t('studio:texts.status.notSent', 'Not sent');
    case 'checked-went':
      return t('studio:texts.status.checkedWent', 'Checked: it was sent');
    case 'checked-not-sent':
      return t('studio:texts.status.checkedNotSent', 'Checked: it was not sent');
  }
}

/** The plain line under a status: what it means, and what to do. */
export function statusLine(word: StatusWord, provider: string): string {
  switch (word) {
    case 'delivered':
      return t('studio:texts.statusLine.delivered', 'The provider reports it reached the phone.');
    case 'sent':
      return t('studio:texts.statusLine.sent', '{provider} took it. It is not known yet whether it reached the phone.', { provider });
    case 'waiting':
      return t('studio:texts.statusLine.waiting', 'Queued. It goes when the sending hours open and today’s limit has room.');
    case 'unknown':
      return t('studio:texts.statusLine.unknown', 'We didn’t get an answer from {provider}. It may have sent this text. Adminium won’t send it again by itself.', { provider });
    case 'undelivered':
      return t('studio:texts.statusLine.undelivered', 'The carrier could not deliver it. Check the number with the person before sending again.');
    case 'failed':
      return t('studio:texts.statusLine.failed', 'It was not sent. The reason below says what to fix.');
    case 'skipped':
      return t('studio:texts.statusLine.skipped', 'A rule stopped it before anything was sent.');
    case 'not-sent':
      return t('studio:texts.statusLine.notSent', 'It was certainly not handed to the provider.');
    case 'checked-went':
      return t('studio:texts.statusLine.checkedWent', 'Someone checked with the provider: it was sent.');
    case 'checked-not-sent':
      return t('studio:texts.statusLine.checkedNotSent', 'Someone checked with the provider: it was not sent. The app may send it again, after every check runs again.');
  }
}

/** Why a text did not go, in one sentence; null for a reason that needs no words. */
export function reasonWords(reason: string | null): string | null {
  if (reason === null) return null;
  switch (reason) {
    case 'country-blocked':
    case 'country-blocked-cn':
      return t('studio:texts.reason.noCn', 'Not sent. Adminium does not send texts to mainland China (+86).');
    case 'stopped':
    case 'opted-out':
      return t('studio:texts.reason.stopped', 'Not sent. This person asked for no more texts.');
    case 'no-consent':
      return t('studio:texts.reason.noConsent', 'Not sent. This person has not agreed to texts.');
    case 'unconfirmed-consent':
      return t('studio:texts.reason.needsConfirm', 'Not sent. This country needs the person to confirm first.');
    case 'country-blocked-for-marketing':
      return t('studio:texts.reason.marketingCountry', 'Not sent. Marketing texts can’t go to this country because people there can’t reply STOP.');
    case 'marketing-from-name':
      return t('studio:texts.reason.marketingName', 'Not sent. Marketing can’t go from a sender name because it can’t receive STOP.');
    // Said so it holds both when the server has no public address and when no reply has been heard yet.
    case 'marketing-without-replies':
      return t('studio:texts.reason.noDoor', 'Not sent. Replies can’t reach this server yet, so STOP can’t be received and marketing texts are off.');
    case 'sender-not-registered':
      return t('studio:texts.reason.waitingRegistration', 'Not sent. Your registration for this country is still waiting.');
    case 'past-its-moment':
    case 'no-send-window':
      return t('studio:texts.reason.tooLate', 'Not sent. The next sending hours fall after the moment this text was for.');
    case 'daily-limit':
      return t('studio:texts.reason.dailyLimit', 'Not sent. Today’s limit was reached.');
    case 'unreadable-phone':
    case 'bad-number':
    case 'invalid-number':
      return t('studio:texts.reason.badNumber', 'Not sent. The number can’t be read as a real phone number.');
    case 'cannot-receive-text':
    case 'not-mobile':
    case 'unreachable':
      return t('studio:texts.reason.cannotReceive', 'Not sent. This number can’t receive texts.');
    case 'country-not-enabled':
      return t('studio:texts.reason.countryNotEnabled', 'Not sent. Your provider account can’t text this country yet. Switch it on in the provider’s console.');
    case 'unfilled-placeholder':
      return t('studio:texts.reason.missingValue', 'Not sent. A placeholder had no value.');
    case 'template-empty':
    case 'credential-in-template':
    case 'asks-for-yes':
    case 'value-too-long':
    case 'value-has-link':
    case 'too-long':
    case 'promises-reply':
    case 'body-empty':
    case 'body-too-long':
    case 'content-blocked':
      return t('studio:texts.reason.words', 'Not sent. The template, or a value in it, can’t be sent as a text.');
    case 'no-opt-out-contact':
    case 'opt-out-changed':
      return t('studio:texts.reason.noOptOut', 'Not sent. No way to opt out could be given for this sender. Add the business’s phone or e-mail.');
    case 'not-connected':
    case 'no-sender':
    case 'credentials':
    case 'account-disabled':
      return t('studio:texts.reason.notConnected', 'Not sent. No working provider account or sender. Check Setup.');
    case 'invalid-sender':
    case 'sender-cannot-text':
    case 'sender-name-refused':
      return t('studio:texts.reason.sender', 'Not sent. The provider refused the sender. Check it in the provider’s console.');
    case 'spend-limit':
      return t('studio:texts.reason.spendLimit', 'Not sent. Your provider account’s spending limit is reached.');
    case 'off-by-operator':
      return t('studio:texts.reason.operatorOff', 'Not sent. Texts are switched off on this server.');
    case 'marketing-not-yet-available':
      return t('studio:texts.reason.marketingLocked', 'Not sent. Marketing texts are not yet available in this version.');
    case 'sender-changed':
      return t('studio:texts.reason.senderChanged', 'Not sent. The sender changed while it waited for its hours, and its opt-out line was written for the old one.');
    case 'no-longer-needed':
      return t('studio:texts.reason.noLongerNeeded', 'Not sent. What it was about was called off while it waited.');
    case 'rate-limited':
    case 'queue-full':
    case 'sender-busy':
    case 'no-connection':
    case 'cancelled':
    case 'could-not-check':
    case 'could-not-queue':
    case 'envelope-unreadable':
      return t('studio:texts.reason.notReached', 'Not sent. The provider could not be reached, and nothing was handed over.');
    case 'timeout':
    case 'connection-lost':
    case 'server-error':
    case 'unreadable-reply':
    case 'in-progress':
    case 'key-reused':
    case 'earlier-attempt-unknown':
    case 'replay-window-passed':
      return null;
    default:
      return t('studio:texts.reason.other', 'Not sent. The provider refused it.');
  }
}

// ─── the key check ──────────────────────────────────────────────────────────

export interface CheckWords {
  tone: StatusTone;
  title: string;
  line: string;
}

/** A failed check, by the server's reason (comp X08). */
export function checkFailedWords(reason: CheckReason | null): CheckWords {
  switch (reason) {
    case 'unreachable':
      return { tone: 'danger', title: t('studio:texts.check.unreachable.title', 'We couldn’t reach the provider'), line: t('studio:texts.check.unreachable.line', 'Your saved key has not changed. Check this server’s internet connection and try again.') };
    case 'profile-not-found':
      return { tone: 'danger', title: t('studio:texts.check.profile.title', 'This messaging profile was not found'), line: t('studio:texts.check.profile.line', 'Copy the messaging profile id again from Telnyx.') };
    case 'account-suspended':
    case 'account-closed':
    case 'account-disabled':
      return { tone: 'danger', title: t('studio:texts.check.closed.title', 'The provider has closed or paused this account'), line: t('studio:texts.check.closed.line', 'Sort it out in the provider’s console, then check again.') };
    default:
      return { tone: 'danger', title: t('studio:texts.check.bad.title', 'The provider did not accept this key'), line: t('studio:texts.check.bad.line', 'Copy the key again from your provider’s console.') };
  }
}

// ─── the do-not-text list ───────────────────────────────────────────────────

export function stopWhy(reason: StopReason): string {
  switch (reason) {
    case 'text-stop':
      return t('studio:texts.stop.why.reply', 'Replied STOP');
    case 'provider-opt-out':
      return t('studio:texts.stop.why.provider', 'Reported by the provider');
    case 'staff':
      return t('studio:texts.stop.why.hand', 'Asked the business');
    case 'erased':
      return t('studio:texts.stop.why.erased', 'Erased person');
  }
}

/** Where an entry came from, in words. */
export function stopFrom(entry: { reason: StopReason; origin: string | null; addedBy: string | null }): string {
  if (entry.reason === 'erased') return t('studio:texts.stop.from.erased', 'Erased on request');
  if (entry.reason === 'text-stop') return t('studio:texts.stop.from.reply', 'Replied STOP to a text');
  if (entry.reason === 'provider-opt-out') return t('studio:texts.stop.from.provider', '{provider} reported an opt-out', { provider: entry.origin === 'telnyx' ? 'Telnyx' : 'Twilio' });
  const by = entry.addedBy ?? '—';
  if (entry.origin === 'email') return t('studio:texts.stop.from.email', 'Asked by e-mail. Recorded by {name}', { name: by });
  if (entry.origin === 'in-person') return t('studio:texts.stop.from.inPerson', 'Asked in person. Recorded by {name}', { name: by });
  return t('studio:texts.stop.from.phone', 'Asked by phone. Recorded by {name}', { name: by });
}
