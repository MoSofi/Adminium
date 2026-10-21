// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pay page's words: the `pay` namespace, and nothing else.
 *
 * THE LOADER IS THIS FILE'S OWN and names one namespace in eight languages,
 * and the instance comes from the package's small `page` entry, started with
 * the English of this one namespace: the general loader and the dashboard's
 * eager English would ship the dashboard's whole vocabulary to a page that
 * says fifty things.
 */
import { createPageI18n, localeFromTag, type BundleLoader, type I18nInstance, type LocaleId } from '@adminium/i18n/page';
import english from '@adminium/i18n/resources/en-us/pay';

type Words = NonNullable<Awaited<ReturnType<BundleLoader>>>;

const LOADERS: Readonly<Record<string, () => Promise<Words>>> = {
  'en-US/pay': async () => english,
  'ar-EG/pay': () => import('@adminium/i18n/resources/ar-eg/pay'),
  'cs-CZ/pay': () => import('@adminium/i18n/resources/cs-cz/pay'),
  'da-DK/pay': () => import('@adminium/i18n/resources/da-dk/pay'),
  'de-DE/pay': () => import('@adminium/i18n/resources/de-de/pay'),
  'fr-FR/pay': () => import('@adminium/i18n/resources/fr-fr/pay'),
  'zh-CN/pay': () => import('@adminium/i18n/resources/zh-cn/pay'),
  'zh-TW/pay': () => import('@adminium/i18n/resources/zh-tw/pay'),
};

/** The languages the page can be read in, each named in itself, in the menu's order. */
export const PAY_LANGUAGES: readonly { id: LocaleId; tag: string; name: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en_US', tag: 'en-US', name: 'English', dir: 'ltr' },
  { id: 'ar_EG', tag: 'ar-EG', name: 'العربية', dir: 'rtl' },
  { id: 'cs_CZ', tag: 'cs-CZ', name: 'Čeština', dir: 'ltr' },
  { id: 'da_DK', tag: 'da-DK', name: 'Dansk', dir: 'ltr' },
  { id: 'de_DE', tag: 'de-DE', name: 'Deutsch', dir: 'ltr' },
  { id: 'fr_FR', tag: 'fr-FR', name: 'Français', dir: 'ltr' },
  { id: 'zh_CN', tag: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { id: 'zh_TW', tag: 'zh-TW', name: '繁體中文', dir: 'ltr' },
] as const;

/** The shop's own rewording of the page's words (Studio → Translations), dotted keys; none when it cannot be read. */
async function reworded(tag: string): Promise<Record<string, string>> {
  try {
    const answer = await fetch(`/pay/api/words/${encodeURIComponent(tag)}`, { credentials: 'omit', headers: { accept: 'application/json' } });
    if (!answer.ok) return {};
    const body = (await answer.json()) as { words?: unknown };
    return typeof body.words === 'object' && body.words !== null ? (body.words as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** A copy of the built words with the shop's rewording laid over them, key by dotted key. */
export function withRewording(words: Words, rewording: Record<string, string>): Words {
  // A loaded module carries its words as its default export.
  const plain = typeof words === 'object' && words !== null && 'default' in words ? (words as { default: unknown }).default : words;
  const out = structuredClone(plain) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rewording)) {
    if (typeof value !== 'string') continue;
    const parts = key.split('.');
    let node: Record<string, unknown> = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (typeof next !== 'object' || next === null) break;
      node = next as Record<string, unknown>;
    }
    const last = parts.at(-1)!;
    // Only a word the page has: a rewording never adds keys.
    if (typeof node[last] === 'string') node[last] = value;
  }
  return out as Words;
}

export async function loadPayWords(tag: string, namespace: string): Promise<Words | null> {
  const loader = LOADERS[`${tag}/${namespace}`];
  if (loader === undefined) return null;
  const [words, rewording] = await Promise.all([loader(), namespace === 'pay' ? reworded(tag) : Promise.resolve({})]);
  return Object.keys(rewording).length === 0 ? words : withRewording(words, rewording);
}

/** The browser's first language the page has, else English. */
export function payLocaleFor(preferred: readonly string[]): LocaleId {
  for (const tag of preferred) {
    const found = localeFromTag(tag);
    // `localeFromTag` falls back to English for anything it does not know; take English only when it was asked for.
    if (found !== 'en_US' || tag.toLowerCase().startsWith('en')) return found;
  }
  return 'en_US';
}

export async function initPayWords(locale: LocaleId): Promise<I18nInstance> {
  // The English the page starts with carries the shop's English rewording too (it is every language's fallback).
  const englishRewording = await reworded('en-US');
  return createPageI18n({ locale, namespace: 'pay', english: Object.keys(englishRewording).length === 0 ? english : withRewording(english, englishRewording), loadBundle: loadPayWords });
}
