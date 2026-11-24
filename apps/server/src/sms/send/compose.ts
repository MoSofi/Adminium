// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One finished text: the template filled, its opt-out line in place, and its
 * length counted on the result. Pure.
 */
import type { TextOptOut } from '../consent/types.js';
import type { SmsSender } from '../types.js';
import { estimateLength, limitsFor, TEXT_MAX_SEGMENTS, type TextEstimate } from './length.js';
import { optOutLine, repliesWithStopWord, saysStop, withoutStopSentence, type BusinessContact } from './opt-out.js';
import { textWordsFor } from '../words.js';
import { asksForYes, checkTextTemplate, fillText } from './template.js';
import type { TextComposeRefusal } from './types.js';

export interface ComposeInput {
  template: string;
  values: Readonly<Record<string, string>>;
  /** Columns the app declares as codes. */
  codeNames?: readonly string[] | undefined;
  /** From the consent decision. */
  optOut: TextOptOut;
  /** The country of the number. */
  country: string;
  sender: SmsSender;
  business: BusinessContact;
  /** The template's language, for the opt-out line. US English when not given. */
  language?: string | null | undefined;
}

export type ComposeResult = { ok: true; body: string; estimate: TextEstimate } | { ok: false; reason: TextComposeRefusal };

export function composeText(input: ComposeInput): ComposeResult {
  const checked = checkTextTemplate(input.template, input.codeNames);
  if (!checked.ok) return { ok: false, reason: checked.reason };

  const words = input.optOut === 'through-business' ? withoutStopSentence(input.template) : input.template;
  const filled = fillText(words, input.values);
  if (!filled.ok) return filled;
  if (filled.body === '') return { ok: false, reason: 'template-empty' };
  // The template's own sentence is gone. A value can still bring one in, and a name cannot take the reply it promises.
  if (input.optOut === 'through-business' && repliesWithStopWord(filled.body)) return { ok: false, reason: 'promises-reply' };

  const line = optOutLine(input.optOut, input.country, input.business, input.language);
  if (line === null) return { ok: false, reason: 'no-opt-out-contact' };
  const body = input.optOut === 'reply-stop' && saysStop(input.template) ? filled.body : `${filled.body}${textWordsFor(input.language).gap}${line}`;
  // Again on the result: a value can supply the half of the sentence the template did not.
  if (asksForYes(body)) return { ok: false, reason: 'asks-for-yes' };

  const estimate = estimateLength(body, limitsFor(input.country, input.sender));
  // Six segments is well inside the 1,600 characters the SMS layer allows.
  if (estimate.segments > TEXT_MAX_SEGMENTS) return { ok: false, reason: 'too-long' };
  return { ok: true, body, estimate };
}
