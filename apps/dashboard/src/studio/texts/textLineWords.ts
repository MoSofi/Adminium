// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The opt-out line a text ends with, in the text's own language: the
 * catalogue's `email:texts.optOut`, exactly as the server reads it.
 *
 * FROM THE SHIPPED CATALOGUE, NEVER THE TRANSLATIONS EDITOR. The server takes
 * these words from the compiled bundles alone (`apps/server/src/sms/words.ts`),
 * so a counter that read an override would count a line no text carries. Each
 * language's bundle is fetched when a preview first needs it, and kept.
 */
import { queryOptions } from '@tanstack/react-query';
import { loadLocaleBundle } from '@adminium/i18n';

import { ENGLISH_LINE_WORDS, type TextLineWords } from './textCounter.js';

/** The eight languages a text can be written in, as the catalogue spells them. */
export const TEXT_LINE_LANGUAGES = ['en-US', 'de-DE', 'fr-FR', 'da-DK', 'cs-CZ', 'ar-EG', 'zh-CN', 'zh-TW'] as const;

/** The server's `textLanguageOf`: `en_US`, `en-us` or `en` to one of the eight; US English for anything else. */
export function textLanguageOf(locale: string | null | undefined): string {
  const tag = (locale ?? '').replaceAll('_', '-').toLowerCase();
  const exact = TEXT_LINE_LANGUAGES.find((one) => one.toLowerCase() === tag);
  if (exact !== undefined) return exact;
  const base = tag.split('-')[0];
  if (base === 'zh') return tag.includes('tw') || tag.includes('hk') || tag.includes('hant') ? 'zh-TW' : 'zh-CN';
  return TEXT_LINE_LANGUAGES.find((one) => one.split('-')[0] === base) ?? 'en-US';
}

interface OptOutGroup {
  reply?: unknown;
  contact?: unknown;
}

/** The line words from one language's `email` bundle; US English for anything missing, as the server does. */
export function lineWordsFrom(bundle: unknown, language: string): TextLineWords {
  const group = ((bundle as { texts?: { optOut?: OptOutGroup } } | null)?.texts?.optOut ?? {}) as OptOutGroup;
  const contact = typeof group.contact === 'string' ? group.contact : null;
  return {
    replyStop: typeof group.reply === 'string' ? group.reply : ENGLISH_LINE_WORDS.replyStop,
    // A value is put in as it is: `$&` in a contact stays `$&`.
    contactLine: contact === null ? ENGLISH_LINE_WORDS.contactLine : (how) => contact.replace(/\{contact\}/gu, () => how),
    gap: language.startsWith('zh') ? '' : ' ',
  };
}

export const lineWordsQuery = (locale: string | null | undefined) => {
  const language = textLanguageOf(locale);
  return queryOptions({
    queryKey: ['studio-texts', 'line-words', language] as const,
    queryFn: async () => lineWordsFrom((await loadLocaleBundle(language, 'email'))?.default ?? null, language),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
};
