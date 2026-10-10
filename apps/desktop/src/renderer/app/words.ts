// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words of the app's own pages: the `desktop` namespace, and the kit's own
 * (`ui`, which the kit's parts read). Awaited before the first render, so no
 * screen is ever drawn in one language and then redrawn in another.
 *
 * THE LOADER IS THIS FILE'S OWN, and names two namespaces. The package's
 * general loader names every namespace of every language, and a bundler that
 * sees it ships all of them: the dashboard's whole vocabulary would ride in the
 * app beside a page that says fifty things.
 */
import { createI18n, localeFromTag, type BundleLoader, type I18nInstance, type LocaleId } from '@adminium/i18n';

type Words = NonNullable<Awaited<ReturnType<BundleLoader>>>;

const LOADERS: Readonly<Record<string, () => Promise<Words>>> = {
  'en-US/desktop': () => import('@adminium/i18n/resources/en-us/desktop'),
  'de-DE/desktop': () => import('@adminium/i18n/resources/de-de/desktop'),
  'de-DE/ui': () => import('@adminium/i18n/resources/de-de/ui'),
  'fr-FR/desktop': () => import('@adminium/i18n/resources/fr-fr/desktop'),
  'fr-FR/ui': () => import('@adminium/i18n/resources/fr-fr/ui'),
  'cs-CZ/desktop': () => import('@adminium/i18n/resources/cs-cz/desktop'),
  'cs-CZ/ui': () => import('@adminium/i18n/resources/cs-cz/ui'),
  'da-DK/desktop': () => import('@adminium/i18n/resources/da-dk/desktop'),
  'da-DK/ui': () => import('@adminium/i18n/resources/da-dk/ui'),
  'zh-CN/desktop': () => import('@adminium/i18n/resources/zh-cn/desktop'),
  'zh-CN/ui': () => import('@adminium/i18n/resources/zh-cn/ui'),
  'zh-TW/desktop': () => import('@adminium/i18n/resources/zh-tw/desktop'),
  'zh-TW/ui': () => import('@adminium/i18n/resources/zh-tw/ui'),
  'ar-EG/desktop': () => import('@adminium/i18n/resources/ar-eg/desktop'),
  'ar-EG/ui': () => import('@adminium/i18n/resources/ar-eg/ui'),
};

/** The languages these pages can be drawn in: the ones a loader above names. */
export const PAGE_LANGUAGES: readonly string[] = [...new Set(Object.keys(LOADERS).map((key) => key.split('/')[0] ?? ''))];

/** A namespace's words in a language, or `null`: English is then what is drawn. */
export async function loadWords(tag: string, namespace: string): Promise<Words | null> {
  const loader = LOADERS[`${tag}/${namespace}`];
  return loader === undefined ? null : loader();
}

/** The app's saved language, or the system's when none was saved. */
export function localeFor(saved: string | null, system: string): LocaleId {
  return localeFromTag(saved ?? system);
}

export async function initWords(locale: LocaleId): Promise<I18nInstance> {
  const i18n = await createI18n({ locale, loadBundle: loadWords });
  await i18n.loadNamespaces('desktop');
  return i18n;
}
