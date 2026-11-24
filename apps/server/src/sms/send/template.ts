// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a text template is filled. What it may say is the manifest package's
 * one check (`text-messages.ts`), which an install and a save ask too.
 *
 * Filling is stricter than an e-mail's. There is no escaping (a text is not
 * HTML), an empty value counts as unfilled, and a value cannot bring a link or
 * a line break into a message that carries the business's name: on a public
 * form, that value was typed by a stranger.
 *
 * A phone makes a link of far more than `https://`: a bare domain
 * (`hotel-pay.io`), an e-mail address and a long run of digits are each one
 * tap away. So a value may carry none of them. Two exceptions, both values the
 * business writes itself, never a stranger:
 *  - a placeholder that prints the business's own name may hold a domain
 *    (a shop called `Wren.shop`);
 *  - a placeholder named for a number (`phone`, `reference`, `total`) may hold
 *    a long run of digits. A date or a time never counts as one.
 */
import { asksForYes, checkTextTemplate, placeholdersIn, readsCredential, type TextTemplateVerdict } from '@adminium/manifest';

import type { TextComposeRefusal } from './types.js';

export { asksForYes, checkTextTemplate, readsCredential };
export type TemplateVerdict = TextTemplateVerdict;

/** The longest one filled value may be. A name or a time is far shorter. */
export const TEXT_VALUE_MAX = 160;

const CONTROL = /[\p{Cc}‪-‮⁦-⁩]+/gu;
const LINK = /https?:\/\/|\bwww\.|[\p{L}\p{N}-]+\.\p{L}{2,}\//iu;
/** A bare domain: a label, a dot, then two or more letters, with or without a path. `St. Mary` and `e.g.` are not one. */
const DOMAIN = /[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.\p{L}{2,}(?![\p{L}\p{N}])/iu;
const ADDRESS = /[^\s@]@[^\s@]/u;
/**
 * Dates and times, taken out before digits are counted: `2026-11-24`,
 * `2026/11/24 10:30`, `24.11.2026`, `24. 11. 2026`, `10:30`. A day and month
 * count only beside a four-digit year, so `06.12.34.56.78` stays a phone number.
 */
const DATE_OR_TIME = /(?<!\p{Nd})(?:\p{Nd}{4}[-/.]\p{Nd}{1,2}[-/.]\p{Nd}{1,2}(?:[T ]\p{Nd}{2}:\p{Nd}{2}(?::\p{Nd}{2}(?:\.\p{Nd}+)?)?(?:Z|[+-]\p{Nd}{2}:?\p{Nd}{2})?)?|\p{Nd}{1,2}[./-] ?\p{Nd}{1,2}[./-] ?\p{Nd}{4}|\p{Nd}{1,2}:\p{Nd}{2}(?::\p{Nd}{2})?)(?!\p{Nd})/gu;
/** Seven digits or more, perhaps spaced or dashed as a phone number is written. */
const DIGIT_RUN = /\p{Nd}(?:[ ().-]{0,2}\p{Nd}){6,}/u;
/** Placeholders that print the business's own name. */
const BUSINESS_NAMES: ReadonlySet<string> = new Set(['business', 'businessName', 'business_name', 'appName', 'app_name']);
/** A placeholder named for a number: its last part, in snake or camel case. */
const NUMBER_NAME = /(?:^|[_-])(?:phone|mobile|tel|telephone|number|no|nr|num|id|ref|reference|amount|total|price|sum|balance|cost)$|[a-z0-9](?:Phone|Mobile|Tel|Telephone|Number|No|Nr|Num|Id|Ref|Reference|Amount|Total|Price|Sum|Balance|Cost)$/;
const BRACES = /\{\{|\}\}/;

/** Whether a filled value could be tapped as a link, an address or a number to call. */
export function valueReachesOut(name: string, value: string): boolean {
  if (LINK.test(value) || ADDRESS.test(value)) return true;
  if (!BUSINESS_NAMES.has(name) && DOMAIN.test(value)) return true;
  const last = name.slice(name.lastIndexOf('.') + 1);
  return !NUMBER_NAME.test(last) && DIGIT_RUN.test(value.replace(DATE_OR_TIME, ' '));
}

/** A value as it may appear: on one line, with nothing that reorders what the reader sees. */
function cleanValue(raw: string): string {
  return raw.replace(CONTROL, ' ').replace(/ {2,}/g, ' ').trim();
}

export type FillResult = { ok: true; body: string } | { ok: false; reason: TextComposeRefusal };

/** The template with every placeholder written out once, or why it cannot be. */
export function fillText(template: string, values: Readonly<Record<string, string>>): FillResult {
  let body = '';
  let cursor = 0;
  for (const placeholder of placeholdersIn(template)) {
    const held = Object.hasOwn(values, placeholder.name) ? values[placeholder.name] : undefined;
    const raw = typeof held === 'string' && held.trim() !== '' ? held : placeholder.backup;
    if (raw === undefined) return { ok: false, reason: 'unfilled-placeholder' };
    const value = cleanValue(raw);
    if (value === '') return { ok: false, reason: 'unfilled-placeholder' };
    if (value.length > TEXT_VALUE_MAX) return { ok: false, reason: 'value-too-long' };
    if (valueReachesOut(placeholder.name, value)) return { ok: false, reason: 'value-has-link' };
    body += template.slice(cursor, placeholder.at) + value;
    cursor = placeholder.at + placeholder.whole.length;
  }
  body += template.slice(cursor);
  // A broken placeholder in the words, or a value that spells one: never sent as it stands.
  if (BRACES.test(body)) return { ok: false, reason: 'unfilled-placeholder' };
  return { ok: true, body: body.trim() };
}
