// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A page's words in the reader's language: a string and its translations,
 * keyed by language tag (`de-DE`), picked by the page's locale — the exact
 * tag, then the same language in another region, then the string itself.
 * An app ships its card titles this way, in every language it speaks.
 */

/** Translations by language tag, as a config carries them. */
export type Localized = Readonly<Record<string, string>>;

export function pickLocalized(fallback: string, translations: Localized | undefined, locale: string | undefined): string;
export function pickLocalized(fallback: string | undefined, translations: Localized | undefined, locale: string | undefined): string | undefined;
export function pickLocalized(fallback: string | undefined, translations: Localized | undefined, locale: string | undefined): string | undefined {
  if (translations === undefined || locale === undefined) return fallback;
  // Adminium spells a locale `de_DE`; a manifest writes the tag `de-DE`.
  const tag = locale.replace(/_/g, '-').toLowerCase();
  const entries = Object.entries(translations).filter(([, text]) => typeof text === 'string' && text !== '');
  const exact = entries.find(([key]) => key.toLowerCase() === tag);
  if (exact !== undefined) return exact[1];
  const language = tag.split('-')[0];
  return entries.find(([key]) => key.toLowerCase().split('-')[0] === language)?.[1] ?? fallback;
}
