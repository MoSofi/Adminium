// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Delivery reports: which status a text is in, whatever order they arrive in.
 *
 * Providers say plainly that callbacks can arrive out of order and more than
 * once, so a report is a claim to compare with what is held:
 *
 *   queued < sending < sent < any final status
 *
 * A final status never moves back to a non-final one. Among final ones, only
 * stronger evidence replaces weaker: `unconfirmed` can become `failed`,
 * `undelivered` or `delivered`; a failure can become `delivered`, since a
 * handset receipt proves it arrived; `delivered` is never replaced.
 *
 * This file holds the rule alone. The send path's store applies it to the row,
 * and keeps the provider's own word, so nothing is translated twice.
 */
import type { SmsProviderKey } from '../types.js';

export const SMS_DELIVERY_STATUSES = ['queued', 'sending', 'sent', 'unconfirmed', 'undelivered', 'failed', 'delivered'] as const;
export type SmsDeliveryStatus = (typeof SMS_DELIVERY_STATUSES)[number];

const RANK: Readonly<Record<SmsDeliveryStatus, number>> = { queued: 10, sending: 20, sent: 30, unconfirmed: 40, undelivered: 50, failed: 50, delivered: 60 };

/** Each provider's words. A word not listed is not a delivery status, and is ignored. */
const WORDS: Readonly<Record<SmsProviderKey, Readonly<Record<string, SmsDeliveryStatus>>>> = {
  twilio: { accepted: 'queued', scheduled: 'queued', queued: 'queued', sending: 'sending', sent: 'sent', delivered: 'delivered', read: 'delivered', undelivered: 'undelivered', failed: 'failed', canceled: 'failed' },
  telnyx: { queued: 'queued', sending: 'sending', sent: 'sent', delivered: 'delivered', sending_failed: 'failed', delivery_failed: 'undelivered', delivery_unconfirmed: 'unconfirmed' },
};

export function deliveryStatusOf(provider: SmsProviderKey, word: unknown): SmsDeliveryStatus | null {
  if (typeof word !== 'string') return null;
  const words = WORDS[provider];
  return Object.hasOwn(words, word) ? (words[word] as SmsDeliveryStatus) : null;
}

export const isFinalStatus = (status: SmsDeliveryStatus): boolean => RANK[status] >= RANK.unconfirmed;

/** Whether a report may replace what is held. An equal rank keeps the first. */
export function deliveryMoves(current: SmsDeliveryStatus, incoming: SmsDeliveryStatus): boolean {
  return RANK[incoming] > RANK[current];
}
