// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How a text template is filled. What it may say is the manifest package's
 * one check (`text-messages.ts`), which an install and a save ask too.
 *
 * Filling is stricter than an e-mail's. There is no escaping (a text is not
 * HTML), an empty value counts as unfilled, and a value cannot bring a link or
 * a line break into a message that carries the business's name: on a public
 * form, that value was typed by a stranger.
 */
import { asksForYes, checkTextTemplate, placeholdersIn, readsCredential, type TextTemplateVerdict } from '@adminium/manifest';

import type { TextComposeRefusal } from './types.js';

export { asksForYes, checkTextTemplate, readsCredential };
export type TemplateVerdict = TextTemplateVerdict;

/** The longest one filled value may be. A name or a time is far shorter. */
export const TEXT_VALUE_MAX = 160;

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
