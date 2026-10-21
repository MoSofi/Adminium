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

export async function loadPayWords(tag: string, namespace: string): Promise<Words | null> {
  const loader = LOADERS[`${tag}/${namespace}`];
  return loader === undefined ? null : loader();
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
  return createPageI18n({ locale, namespace: 'pay', english, loadBundle: loadPayWords });
}
