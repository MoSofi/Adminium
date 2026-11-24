// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WORDS OF MARKETING TEXTS: what a run, a person it reaches and a
 * confirmation can say, and every reason one does not go. Each reason is a
 * stable word the console words itself, and safe to log: none holds a number
 * or a word of the message.
 *
 * ─── A RUN'S STATES ─────────────────────────────────────────────────────────
 *
 *   scheduled   made, waiting for its time
 *   running     its people are written down and being handed to the send path
 *   waiting     today's text limit is used: it goes on the next day (`waitingUntil`)
 *   done        every person was handed over or left out. The texts may still be
 *               waiting for their sending hours; each delivery says how it ended
 *   cancelled   a person stopped it. Nothing more is handed over, and a text still
 *               waiting for its hours is not sent
 *   failed      the run could not go on, with its reason
 *
 * ─── A PERSON'S STATES ──────────────────────────────────────────────────────
 *
 *   queued      waiting for its turn
 *   sending     a batch holds it now
 *   handed      its text was given to the send path: the delivery says the rest
 *   skipped     left out, with its reason
 *   cancelled   the run was cancelled before its turn
 */
import type { TextPrepareSkipReason } from '../send/types.js';

export const TEXT_RUN_STATES = ['scheduled', 'running', 'waiting', 'done', 'cancelled', 'failed'] as const;
export type TextRunState = (typeof TEXT_RUN_STATES)[number];

/** States in which a run still has work to do. */
export const TEXT_RUN_OPEN: readonly TextRunState[] = ['scheduled', 'running', 'waiting'];

export const TEXT_RECIPIENT_STATES = ['queued', 'sending', 'handed', 'skipped', 'cancelled'] as const;
export type TextRecipientState = (typeof TEXT_RECIPIENT_STATES)[number];

/**
 * Why a run cannot go at all. Checked when it is made, when it starts and at
 * every batch: the same check the console's preflight shows.
 */
export const TEXT_RUN_REFUSALS = [
  /** This release does not offer marketing texts yet (`availability.ts`). */
  'marketing-not-yet-available',
  /** The operator switched texts off on this server. */
  'off-by-operator',
  /** The operator switched marketing off on this server. */
  'marketing-off-by-operator',
  /** No provider is connected, or its key cannot be read. */
  'not-connected',
  'no-sender',
  /** The sender is a name (or a pool that may hold names), which cannot receive STOP. */
  'marketing-from-name',
  /** No STOP can reach this server: no public https address, network features off, or the desktop app. */
  'marketing-without-replies',
  /** The template is gone, or every language of it is switched off. */
  'template-off',
  /** The template itself cannot go: it reads a code or a sign-in link, or asks for YES. */
  'template-refused',
] as const;
export type TextRunRefusal = (typeof TEXT_RUN_REFUSALS)[number];

/** Why the people table itself cannot be sent to, as the person making the run reaches it. */
export const TEXT_AUDIENCE_REFUSALS = [
  /** Not a people table an installed app declares with a mobile column. */
  'not-people',
  /** The person may no longer send marketing (`system:settings:manage` and `sms.manage`), or is no longer active. */
  'cannot-send',
  /** They cannot read the table. */
  'cannot-read',
  /** Their role hides the mobile column. */
  'phones-hidden',
  /** They see the mobile column masked. */
  'phones-masked',
  'view-gone',
  'view-search',
  'view-hidden-column',
] as const;
export type TextAudienceRefusal = (typeof TEXT_AUDIENCE_REFUSALS)[number];

/**
 * Why one person is left out. The send path's own reasons (`TextPrepareSkipReason`)
 * keep their names, so a reason reads the same in the run and in the activity.
 */
export type TextRecipientSkip =
  | TextPrepareSkipReason
  /** No number on their row. */
  | 'no-phone'
  /** A row of the app's sample data: nobody agreed to anything. */
  | 'sample'
  /** A person a lead finder found: never texted marketing, whatever the log says. */
  | 'found-lead'
  /** Two rows hold one number: it gets one text. */
  | 'same-number'
  /** At a later batch: the row is gone, or out of the sender's reach now. */
  | 'out-of-reach'
  /** At a later batch: the row holds another number now. */
  | 'phone-changed'
  /** The run could not go on (its reason is the run's). */
  | 'run-failed'
  /** The template has no language this person can be written to in. */
  | 'no-template-language';

/** One person, as the console lists them. Never the number: its mask. */
export interface TextRecipientView {
  id: string;
  name: string | null;
  phone: string | null;
  country: string | null;
  state: TextRecipientState;
  reason: TextRecipientSkip | null;
  /** How the text ended, from its delivery; null until it was handed over. */
  delivery: { id: string; state: string; reason: string | null; providerStatus: string | null; segments: number | null } | null;
}

/** A run's numbers, as the results page shows them. */
export interface TextRunTotals {
  /** Every person written down. */
  people: number;
  /** Waiting for their turn. */
  queued: number;
  /** Handed to the send path, and not ended yet: in flight or waiting for their hours. */
  sending: number;
  /** The provider took it. */
  sent: number;
  /** The provider reported it delivered. */
  delivered: number;
  failed: number;
  /** Might have gone: a person checks before anything is sent again. */
  unknown: number;
  /** Left out, by reason: at the start, at its turn, or by the send path at the last moment. */
  skipped: Record<string, number>;
  cancelled: number;
  /** Numbers that asked for no more texts after this run's text reached the provider. */
  optOuts: number;
}

export interface TextRunView {
  id: string;
  name: string;
  templateKey: string;
  connectionId: string;
  table: string;
  viewId: string | null;
  status: TextRunState;
  reason: string | null;
  scheduledAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Today's limit is used: the run goes on at this moment. */
  waitingUntil: number | null;
  createdBy: string;
  cancelledBy: string | null;
  createdAt: number;
  totals: TextRunTotals;
}
