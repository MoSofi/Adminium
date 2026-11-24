// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of Texts → Conversations: why an answer can't go, what became of
 * one that was sent, and how a text in a thread stands. Every label is a
 * literal `t()` key, so each can be found and translated.
 */
import { ApiError } from '../../app/api.js';
import { t } from '../../i18n/t.js';
import type { ReplyBlock, ThreadDeliveryStatus } from './conversationsApi.js';
import { cnSentence, reasonWords, type StatusTone } from './textsWords.js';

/** Why the reply box is not offered, in a sentence. */
export function blockWords(reason: ReplyBlock | null): string {
  switch (reason) {
    case 'not-allowed':
      return t('studio:texts.conv.block.notAllowed', 'You can read this conversation, but not answer it. Ask the owner for the right to answer.');
    case 'stopped':
      return t('studio:texts.conv.block.stopped', 'This person asked for no more texts. You can’t reply here.');
    case 'not-connected':
      return t('studio:texts.conv.block.notConnected', 'No provider is connected, so nothing can be sent. Connect one in Setup.');
    case 'no-consent':
      return t('studio:texts.conv.block.noConsent', 'This person has not given this app a yes to texts and has not written in the last 7 days, so an answer can’t go.');
    case 'cannot-receive-text':
      return t('studio:texts.conv.block.cannotReceive', 'This number can’t receive texts.');
    case 'country-blocked':
      return cnSentence();
    default:
      return t('studio:texts.conv.block.other', 'An answer can’t go from here now.');
  }
}

/** Why an answer that was written did not go. */
export function refusedWords(reason: string | null): string {
  switch (reason) {
    case 'not-allowed':
      return t('studio:texts.conv.refused.notAllowed', 'Not sent. You may read this conversation, but not answer it.');
    case 'no-consent':
      return t('studio:texts.conv.refused.noConsent', 'Not sent. This person has not given this app a yes to texts.');
    case 'earlier-send-open':
      return t('studio:texts.conv.refused.earlierOpen', 'Not sent. The same answer is still on its way. Wait for it before sending again.');
    default:
      return reasonWords(reason) ?? t('studio:texts.conv.refused.other', 'Not sent.');
  }
}

/** A request that failed before the server judged the answer. */
export function failureWords(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return t('studio:texts.conv.fail.forbidden', 'You may not answer this conversation.');
    if (error.status === 404) return t('studio:texts.conv.fail.gone', 'This conversation is no longer there.');
    return error.message;
  }
  return t('studio:texts.conv.fail.network', 'The server could not be reached. Nothing was sent. Try again.');
}

export const DELIVERY_TONE: Readonly<Record<ThreadDeliveryStatus, StatusTone>> = {
  sending: 'neutral',
  sent: 'info',
  delivered: 'pos',
  failed: 'danger',
  unknown: 'warn',
  skipped: 'neutral',
  'not-sent': 'neutral',
};

/** "Sent" is never called delivered: delivered shows only when the provider reports it. */
export function deliveryLabel(status: ThreadDeliveryStatus): string {
  switch (status) {
    case 'sending':
      return t('studio:texts.status.waiting', 'Waiting');
    case 'sent':
      return t('studio:texts.status.sent', 'Handed to the provider');
    case 'delivered':
      return t('studio:texts.status.delivered', 'Delivered');
    case 'failed':
      return t('studio:texts.status.failed', 'Failed');
    case 'unknown':
      return t('studio:texts.status.unknown', 'Unknown, check before resending');
    case 'skipped':
      return t('studio:texts.status.skipped', 'Skipped');
    case 'not-sent':
      return t('studio:texts.status.notSent', 'Not sent');
  }
}

/** The heading over `reachWords`: a server that is set up but not yet heard from is not called unreachable. */
export function reachTitle(state: string): string {
  return state === 'not-heard' ? t('studio:texts.conv.reach.notHeardTitle', 'No reply has reached this server yet') : t('studio:texts.conv.reach.title', 'Replies can’t reach this server');
}

/** Where the replies of this server stand, when they cannot arrive. */
export function reachWords(state: string): string {
  if (state === 'not-heard') return t('studio:texts.conv.reach.notHeard', 'Set up, but no reply has arrived yet. In Setup, choose “Show the reply address”, give it to your provider, then send a test reply. Customers’ replies show here once one arrives.');
  if (state === 'not-connected') return t('studio:texts.conv.reach.notConnected', 'No provider is connected, so no reply can arrive here. Connect one in Setup.');
  if (state === 'desktop') return t('studio:texts.conv.reach.desktop', 'The desktop app can send texts, but replies and STOP can’t reach it, so no new message will arrive here.');
  if (state === 'key-unreadable') return t('studio:texts.conv.reach.keyUnreadable', 'The provider key can’t be read on this server, so no reply can arrive here. Paste it again in Setup.');
  return t('studio:texts.conv.reach.noDoor', 'This server has no public https address. It can send texts, but replies and STOP can’t reach it, so no new message will arrive here.');
}
