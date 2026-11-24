// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHERE A PERSON STANDS ON TEXTS FROM ONE APP, as an app's staff page and the
 * person's own Prefs read it (`GET /texts/consent`, `GET /public/texts/standing`).
 *
 * Per purpose (service, marketing), one word:
 *  - `stopped`: the number is on the stop list. Nothing is texted, whatever
 *    the log says, and no yes lifts it. `stopped.liftBy` says who can:
 *    `start` (they replied STOP, or told the provider: only they can, by
 *    texting START to the business's number), `business` (staff put it there
 *    on their word: staff take it off), `never` (an erased person's entry).
 *  - `yes`: a yes this app's texts may count (`TextConsentScope`).
 *  - `no`: their latest answer is no.
 *  - `not-asked`: nobody asked them, or only another app did.
 *  - `no-phone`: no number a text can be read from.
 * A yes or no names when, how and from where (`form`, `staff`, `person`,
 * `reply`, `provider`), the staff member who took it, and its wording's
 * version: never the number in full, never a network address or a browser.
 */
import type { ConsentPerson } from '@adminium/meta';

import { parsePhone } from '../../phone/index.js';
import { maskPhone } from './redact.js';
import type { TextConsentEvent, TextConsentService, TextPurpose, TextStopReason } from './types.js';

export const TEXT_STANDING_STATES = ['yes', 'no', 'not-asked', 'stopped', 'no-phone'] as const;
export type TextStandingState = (typeof TEXT_STANDING_STATES)[number];

/** Who may lift a stop-list entry. */
export const TEXT_STOP_LIFTS = ['start', 'business', 'never'] as const;

export interface TextAnswerView {
  at: number;
  source: string;
  how: string | null;
  by: { id: string; label: string } | null;
  wordingVersion: string | null;
}

export interface TextPurposeView {
  state: TextStandingState;
  /** The answer that makes it so: null for `not-asked`, `no-phone`, and a stop with no answer of its own. */
  answer: TextAnswerView | null;
}

export interface TextStandingView {
  /** The number as `+49 ••• 789`; null when there is none to read. */
  masked: string | null;
  service: TextPurposeView;
  marketing: TextPurposeView;
  stopped: { since: number; reason: TextStopReason; liftBy: (typeof TEXT_STOP_LIFTS)[number] } | null;
}

function answerOf(event: TextConsentEvent | null): TextAnswerView | null {
  if (event === null) return null;
  return {
    at: event.at,
    source: event.source,
    how: event.how,
    by: event.staffId === null ? null : { id: event.staffId, label: event.staffLabel ?? '' },
    wordingVersion: event.wordingVersion,
  };
}

const liftOf = (reason: TextStopReason): (typeof TEXT_STOP_LIFTS)[number] => (reason === 'text-stop' || reason === 'provider-opt-out' ? 'start' : reason === 'staff' ? 'business' : 'never');

/** One person's standing on texts from one app: the number on their row, the row, and the app (null for none). */
export async function textStandingOf(
  consent: Pick<TextConsentService, 'standing' | 'stop'>,
  input: { phone: unknown; country: string | null; person: ConsentPerson; app: string | null },
): Promise<TextStandingView> {
  const parsed = parsePhone(input.phone, input.country);
  if (!parsed.ok) {
    const none: TextPurposeView = { state: 'no-phone', answer: null };
    return { masked: null, service: none, marketing: none, stopped: null };
  }
  const entry = await consent.stop.entryFor(parsed.e164, input.country);
  const scope = { app: input.app ?? '', record: input.person };
  const purpose = async (which: TextPurpose): Promise<TextPurposeView> => {
    const standing = await consent.standing({ phone: parsed.e164, country: input.country, person: input.person }, which, scope);
    if (entry !== null) return { state: 'stopped', answer: standing.state === 'no' ? answerOf(standing.event) : null };
    return { state: standing.state, answer: answerOf(standing.event) };
  };
  return {
    masked: maskPhone(parsed.e164),
    service: await purpose('text-service'),
    marketing: await purpose('text-marketing'),
    stopped: entry === null ? null : { since: entry.addedAt, reason: entry.reason, liftBy: liftOf(entry.reason) },
  };
}
