// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The engine's words on a stranger's page: the `x` namespace, and nothing
 * else (the owner's words, a form's title and questions, come from the API
 * in the page's language).
 *
 * THE LOADER IS THIS FILE'S OWN and names one namespace in eight languages,
 * and the instance comes from the package's small `page` entry, started with
 * the English of this one namespace: the general loader and the dashboard's
 * eager English would ship the dashboard's whole vocabulary to a page that
 * says a few dozen things.
 */
import { createPageI18n, localeFromTag, type BundleLoader, type I18nInstance, type LocaleId } from '@adminium/i18n/page';
import english from '@adminium/i18n/resources/en-us/x';

type Words = NonNullable<Awaited<ReturnType<BundleLoader>>>;

const LOADERS: Readonly<Record<string, () => Promise<Words>>> = {
  'en-US/x': async () => english,
  'ar-EG/x': () => import('@adminium/i18n/resources/ar-eg/x'),
  'cs-CZ/x': () => import('@adminium/i18n/resources/cs-cz/x'),
  'da-DK/x': () => import('@adminium/i18n/resources/da-dk/x'),
  'de-DE/x': () => import('@adminium/i18n/resources/de-de/x'),
  'fr-FR/x': () => import('@adminium/i18n/resources/fr-fr/x'),
  'zh-CN/x': () => import('@adminium/i18n/resources/zh-cn/x'),
  'zh-TW/x': () => import('@adminium/i18n/resources/zh-tw/x'),
};

/** The eight languages, each named in itself, in the order a form's languages are listed. */
export const X_LANGUAGES: readonly { id: LocaleId; tag: string; name: string; dir: 'ltr' | 'rtl' }[] = [
  { id: 'en_US', tag: 'en-US', name: 'English', dir: 'ltr' },
  { id: 'de_DE', tag: 'de-DE', name: 'Deutsch', dir: 'ltr' },
  { id: 'fr_FR', tag: 'fr-FR', name: 'Français', dir: 'ltr' },
  { id: 'cs_CZ', tag: 'cs-CZ', name: 'Čeština', dir: 'ltr' },
  { id: 'da_DK', tag: 'da-DK', name: 'Dansk', dir: 'ltr' },
  { id: 'ar_EG', tag: 'ar-EG', name: 'العربية', dir: 'rtl' },
  { id: 'zh_CN', tag: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { id: 'zh_TW', tag: 'zh-TW', name: '繁體中文', dir: 'ltr' },
] as const;

export type XLanguage = (typeof X_LANGUAGES)[number];

export function languageOfTag(tag: string): XLanguage {
  return X_LANGUAGES.find((one) => one.tag === tag) ?? X_LANGUAGES[0]!;
}

export async function loadXWords(tag: string, namespace: string): Promise<Words | null> {
  const loader = LOADERS[`${tag}/${namespace}`];
  return loader === undefined ? null : loader();
}

/** The language asked in the address (`?lang=`), else the browser's first the page has, else English. */
export function xLocaleFor(asked: string | null, preferred: readonly string[]): LocaleId {
  for (const tag of [...(asked === null ? [] : [asked]), ...preferred]) {
    const found = localeFromTag(tag);
    // `localeFromTag` falls back to English for anything it does not know; take English only when it was asked for.
    if (found !== 'en_US' || tag.toLowerCase().startsWith('en')) return found;
  }
  return 'en_US';
}

export async function initXWords(locale: LocaleId): Promise<I18nInstance> {
  return createPageI18n({ locale, namespace: 'x', english, loadBundle: loadXWords });
}
