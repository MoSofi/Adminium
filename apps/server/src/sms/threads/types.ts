// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of a conversation: what a thread and its messages hold, and every
 * reason a reply or a text from a record does not go. Each reason is safe to
 * log: none holds a number or a word of a message.
 */
import type { AddressHash } from '@adminium/meta';

import type { TextPrepareSkipReason } from '../send/types.js';

export const TEXT_THREAD_DIRECTIONS = ['in', 'out'] as const;
export type TextThreadDirection = (typeof TEXT_THREAD_DIRECTIONS)[number];

/**
 * In: `message`, `help`, and the `stop` and `start` the stop list read.
 * Out: `reply`, written in the conversation, and `text`, sent from a record's page.
 */
export const TEXT_THREAD_KINDS = ['message', 'help', 'stop', 'start', 'reply', 'text'] as const;
export type TextThreadKind = (typeof TEXT_THREAD_KINDS)[number];

/** The record a staff text was sent from: its key, never its words. */
export interface TextThreadRecordRef {
  connectionId: string;
  table: string;
  key: string;
}

export interface TextThreadRecord {
  id: string;
  phone: AddressHash;
  /** `''` for a thread no app owns. */
  appKey: string;
  phoneEncrypted: string | null;
  phoneMasked: string | null;
  line: string | null;
  record: TextThreadRecordRef | null;
  lastAt: number;
  lastDirection: TextThreadDirection;
  lastKind: TextThreadKind;
  unread: number;
  readAt: number | null;
  readBy: { id: string; label: string } | null;
  createdAt: number;
}

export interface TextThreadMessageRecord {
  id: string;
  threadId: string;
  direction: TextThreadDirection;
  kind: TextThreadKind;
  sealedBody: string | null;
  eventId: string | null;
  deliveryId: string | null;
  /** For an outgoing message: `queued`, `held`, or why it did not go. For a STOP: whether its confirmation was asked for. */
  outcome: string | null;
  by: { id: string; label: string } | null;
  at: number;
}

/** Why a person's text does not go before the send path is asked. */
export type TextSendRefusal =
  /** The role may not reply in this app's conversations. */
  | 'not-allowed'
  /** No text provider, or the send path is not joined. */
  | 'not-connected'
  /** The words could not be checked, or the text queued: nothing went. */
  | 'could-not-check'
  | 'could-not-queue'
  /** An earlier send with this key is still open. */
  | 'earlier-send-open';

export type TextSendOutcome =
  | { outcome: 'queued'; deliveryId: string }
  /** Outside the sending hours: it goes when they open. */
  | { outcome: 'held'; deliveryId: string; opensAt: number }
  | { outcome: 'refused'; reason: TextPrepareSkipReason | TextSendRefusal };

/** How a reply in a conversation stands before anything is typed. */
export type TextReplyBlock = 'not-allowed' | 'stopped' | 'not-connected' | 'no-consent' | 'cannot-receive-text' | 'country-blocked';

/** What happened to a reply that arrived. Stable words, for the event's own reason. */
/** `not-ours`: found by the catch-up, to another number of the account and from someone this business never texted. */
export type TextReceived = 'kept' | 'already-kept' | 'noted' | 'not-noted' | 'answered-not-read' | 'not-read' | 'own-sender' | 'not-ours';
