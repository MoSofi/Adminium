// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a text template may say, and how it is filled.
 *
 * A text is not private and a phone number gets reassigned, so nothing that
 * opens a door travels by SMS: no sign-in link, no minted link, no code, no QR
 * value. No template asks for a "YES" either, because a provider reads that
 * reply as an opt-in.
 *
 * Filling is stricter than an e-mail's. There is no escaping (a text is not
 * HTML), an empty value counts as unfilled, and a value cannot bring a link or
 * a line break into a message that carries the business's name: on a public
 * form, that value was typed by a stranger.
 */
import { GROUPED_FORM, placeholdersIn, REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, SURVEY_LINK_VARIABLE } from '@adminium/manifest';

import { OBJECT_LINK_VARIABLE } from '../../leads/object-token.js';
import { CALENDAR_GOOGLE_VARIABLE, CALENDAR_OUTLOOK_VARIABLE } from '../../outbox/calendar-part.js';
import type { TextComposeRefusal } from './types.js';

/** The longest one filled value may be. A name or a time is far shorter. */
export const TEXT_VALUE_MAX = 160;

/** Links the engine mints for one person. */
const MINTED_LINKS: ReadonlySet<string> = new Set(['signInLink', SURVEY_LINK_VARIABLE, REVIEW_LINK_VARIABLE, STOP_LINK_VARIABLE, OBJECT_LINK_VARIABLE, CALENDAR_GOOGLE_VARIABLE, CALENDAR_OUTLOOK_VARIABLE]);

const CREDENTIAL_NAME = /(?:^|[_-])(?:code|otp|pin|passcode|password|passwd|token|secret)$|[a-z0-9](?:Code|Otp|Pin|Passcode|Password|Passwd|Token|Secret)$/;
/** Codes that open nothing. */
const HARMLESS_CODE = /(?:^|[_-])(?:postal|post|zip|country|currency|area|calling|dial|language|locale|tax|product|sku|item|colou?r)[_-]?code$/i;

/** Whether a placeholder reads something that must not leave by text. `codeNames` are the columns the app declares as codes. */
export function readsCredential(name: string, codeNames: readonly string[] = []): boolean {
  if (MINTED_LINKS.has(name)) return true;
  if (codeNames.some((code) => name === code || name.startsWith(`${code}.`))) return true;
  const last = name.slice(name.lastIndexOf('.') + 1);
  if (last === 'qr' || last === GROUPED_FORM) return true;
  return CREDENTIAL_NAME.test(last) && !HARMLESS_CODE.test(last);
}

/** "Reply YES", in the eight languages a template can be written in. */
const ASKS_FOR_YES: readonly RegExp[] = [
  /\b(?:reply|respond|answer|text|send)\b[^.!?\n]{0,24}\byes\b/iu,
  /\b(?:antworte|antworten)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:svar|send)\b[^.!?\n]{0,24}\bja\b/iu,
  /\b(?:r[ée]ponds|r[ée]pondez|envoyez)\b[^.!?\n]{0,24}\boui\b/iu,
  /\bodpov[eě]z(?:te)?\b[^.!?\n]{0,24}\bano\b/iu,
  /(?:رد|ردّ|أرسل|ارسل)[^.!?؟\n]{0,24}نعم/u,
  /(?:回复|回覆)[^。！？\n]{0,12}(?:是|好)/u,
];

export function asksForYes(text: string): boolean {
  return ASKS_FOR_YES.some((pattern) => pattern.test(text));
}

export type TemplateVerdict = { ok: true } | { ok: false; reason: TextComposeRefusal; names?: string[] };

export function checkTextTemplate(template: string, codeNames: readonly string[] = []): TemplateVerdict {
  if (typeof template !== 'string' || template.trim() === '') return { ok: false, reason: 'template-empty' };
  const names = placeholdersIn(template).filter((one) => readsCredential(one.name, codeNames)).map((one) => one.name);
  if (names.length > 0) return { ok: false, reason: 'credential-in-template', names: [...new Set(names)] };
  if (asksForYes(template)) return { ok: false, reason: 'asks-for-yes' };
  return { ok: true };
}

const CONTROL = /[\p{Cc}‪-‮⁦-⁩]+/gu;
const LINK = /https?:\/\/|\bwww\.|[\p{L}\p{N}-]+\.\p{L}{2,}\//iu;
const BRACES = /\{\{|\}\}/;

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
    if (LINK.test(value)) return { ok: false, reason: 'value-has-link' };
    body += template.slice(cursor, placeholder.at) + value;
    cursor = placeholder.at + placeholder.whole.length;
  }
  body += template.slice(cursor);
  // A broken placeholder in the words, or a value that spells one: never sent as it stands.
  if (BRACES.test(body)) return { ok: false, reason: 'unfilled-placeholder' };
  return { ok: true, body: body.trim() };
}
