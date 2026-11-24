// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an outbox row says about its text. Every sentence is fixed: none holds
 * a number or a word of the message, because a row's error column is read by
 * staff and copied into exports.
 */
import type { TextDelivery, TextDeliveryReason } from '../sms/send/index.js';

export const TEXT_NO_NUMBER = 'No mobile number on file';
export const TEXT_NOT_CONNECTED = 'No text provider is connected';
export const TEXT_SAMPLE = 'Sample data (never sent)';
export const TEXT_REHEARSAL = 'A rehearsal sends no real text';
export const TEXT_NO_WORDS = 'The text is switched off, or has no words';
export const TEXT_NOT_PREPARED = 'The text could not be prepared';
export const TEXT_NOT_QUEUED = 'The text could not be queued';
export const TEXT_NOT_CHECKED = 'Not sent: the stop list or the settings could not be read';
export const TEXT_EARLIER_OPEN = 'An earlier send is still open: check it before resending';
export const TEXT_UNKNOWN = 'Unknown: check with the provider before resending';
const PROVIDER_FAILED = 'Not delivered: the provider reports it failed';
const CHECKED_NOT_SENT = 'Checked with the provider: it did not go';

/** A prefix every waiting row's line starts with, so a page can tell a wait from a failure. */
export const TEXT_WAITING_PREFIX = 'Waiting for the sending hours';

/**
 * Said while the text is held for its sending hours: the row reads `sent`
 * (it is claimed, and must not be queued again), and this says it has not
 * gone yet. Cleared when the provider takes it; replaced if it ends otherwise.
 */
export function textWaitingSentence(opensAt: number): string {
  return `${TEXT_WAITING_PREFIX}: goes at ${new Date(opensAt).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

const REASONS: Partial<Record<TextDeliveryReason, string>> = {
  'unreadable-phone': 'Not sent: the mobile number cannot be read',
  'bad-number': 'Not sent: the mobile number cannot be read',
  'invalid-number': 'Not sent: the provider says the number is invalid',
  'cannot-receive-text': 'Not sent: this number cannot receive a text',
  'not-mobile': 'Not sent: this number is not a mobile',
  'country-blocked': 'Not sent: no texts go to this country',
  'country-blocked-cn': 'Not sent: no texts go to this country',
  'country-blocked-for-marketing': 'Not sent: no marketing texts go to this country',
  'marketing-from-name': 'Not sent: a sender name cannot send marketing',
  'marketing-without-replies': 'Not sent: this server cannot read a STOP reply',
  stopped: 'Not sent: this person replied STOP',
  'opted-out': 'Not sent: this person opted out at the provider',
  'no-consent': 'Not sent: this person has not agreed to texts',
  'unconfirmed-consent': 'Not sent: this person has not confirmed their yes',
  'not-connected': TEXT_NOT_CONNECTED,
  'no-sender': 'No sender is set for texts',
  'off-by-operator': 'Texts are switched off on this server',
  'daily-limit': 'Not sent: the daily text limit is reached',
  'marketing-not-yet-available': 'Not sent: marketing texts are not available in this release',
  'sender-changed': 'Not sent: the sender changed while it waited for its hours',
  'past-its-moment': 'Not sent: the send window would hold it past its moment',
  'no-send-window': 'Not sent: no send window opens soon',
  'opt-out-changed': 'Not sent: the way to opt out changed after it was written',
  'no-longer-needed': 'No longer needed',
  'template-empty': 'Not sent: the text has no words',
  'credential-in-template': 'Not sent: the text reads a link or a code',
  'asks-for-yes': 'Not sent: the text asks for a YES',
  'unfilled-placeholder': 'Not sent: a value the text prints is empty',
  'value-too-long': 'Not sent: a value the text prints is too long',
  'value-has-link': 'Not sent: a value the text prints holds a link',
  'too-long': 'Not sent: the text is too long',
  'no-opt-out-contact': 'Not sent: the business has no phone or email to stop by',
  'promises-reply': 'Not sent: the text promises a reply this sender cannot take',
  'could-not-check': TEXT_NOT_CHECKED,
  'could-not-queue': TEXT_NOT_QUEUED,
  'envelope-unreadable': 'Not sent: the queued text could not be read',
};

export function textReasonSentence(reason: TextDeliveryReason | null): string {
  return (reason === null ? undefined : REASONS[reason]) ?? 'Not sent';
}

/** What a delivery's end asks of its source row. Null for a state with nothing to say. */
export type TextRowMark = { mark: 'went' } | { mark: 'unknown'; error: string } | { mark: 'dropped'; error: string } | { mark: 'failed'; error: string };

export function textRowMark(delivery: Pick<TextDelivery, 'state' | 'reason'>): TextRowMark | null {
  switch (delivery.state) {
    case 'accepted':
    case 'checked-went':
      return { mark: 'went' };
    case 'unknown':
      return { mark: 'unknown', error: TEXT_UNKNOWN };
    case 'skipped':
      if (delivery.reason === 'no-longer-needed') return { mark: 'dropped', error: textReasonSentence(delivery.reason) };
      return { mark: 'failed', error: textReasonSentence(delivery.reason) };
    case 'refused':
    case 'not-sent':
      return { mark: 'failed', error: textReasonSentence(delivery.reason) };
    case 'provider-failed':
      return { mark: 'failed', error: PROVIDER_FAILED };
    case 'checked-not-sent':
      return { mark: 'failed', error: CHECKED_NOT_SENT };
    default:
      return null;
  }
}

/**
 * The code an outbox's `textReason` column holds beside each line above, for
 * an app to read instead of the sentence: `queued` (handed to the send path),
 * `waiting` (held for the sending hours), `sent`, `unknown`, `no-number`,
 * `not-set-up` (no provider, no sender, or texts switched off), `sample`,
 * `rehearsal`, `no-words`, `not-prepared`, `earlier-send-open`,
 * `provider-failed`, `checked-not-sent`, or a send path reason
 * (`no-consent`, `stopped`, `opted-out`, `daily-limit`, …).
 */
export type TextReasonCode = string;

/** A send path reason, as the column keeps it: the three of "not set up" as one. */
export function textReasonCode(reason: TextDeliveryReason | null): TextReasonCode {
  if (reason === null) return 'not-sent';
  if (reason === 'not-connected' || reason === 'no-sender' || reason === 'off-by-operator') return 'not-set-up';
  return reason;
}

const LINE_CODES: ReadonlyMap<string, TextReasonCode> = new Map<string, TextReasonCode>([
  [TEXT_NO_NUMBER, 'no-number'],
  [TEXT_SAMPLE, 'sample'],
  [TEXT_REHEARSAL, 'rehearsal'],
  [TEXT_NO_WORDS, 'no-words'],
  [TEXT_NOT_PREPARED, 'not-prepared'],
  [TEXT_EARLIER_OPEN, 'earlier-send-open'],
  [TEXT_UNKNOWN, 'unknown'],
  [PROVIDER_FAILED, 'provider-failed'],
  [CHECKED_NOT_SENT, 'checked-not-sent'],
  ...(Object.entries(REASONS) as [TextDeliveryReason, string][]).map(([reason, line]): [string, TextReasonCode] => [line, textReasonCode(reason)]).reverse(),
]);

/** The code of one of the lines above (a waiting line too); `not-sent` for any other. */
export function textLineCode(line: string | null): TextReasonCode {
  if (line === null) return 'sent';
  if (line.startsWith(TEXT_WAITING_PREFIX)) return 'waiting';
  return LINE_CODES.get(line) ?? 'not-sent';
}
