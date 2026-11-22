// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The connect page's own words (`xConnect`), added to the `/x/` page's
 * instance by the connect page's chunk itself: a form's page, whose first load
 * carries the `x` words, never carries these.
 *
 * English comes with the chunk (it is every language's fallback); the
 * person's language is fetched before the page is drawn, so nothing is drawn
 * in one language and redrawn in another.
 */
import type { I18nInstance } from '@adminium/i18n/page';
import english from '@adminium/i18n/resources/en-us/xConnect';

type Bundle = Record<string, unknown>;

const LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  'ar-EG': () => import('@adminium/i18n/resources/ar-eg/xConnect'),
  'cs-CZ': () => import('@adminium/i18n/resources/cs-cz/xConnect'),
  'da-DK': () => import('@adminium/i18n/resources/da-dk/xConnect'),
  'de-DE': () => import('@adminium/i18n/resources/de-de/xConnect'),
  'fr-FR': () => import('@adminium/i18n/resources/fr-fr/xConnect'),
  'zh-CN': () => import('@adminium/i18n/resources/zh-cn/xConnect'),
  'zh-TW': () => import('@adminium/i18n/resources/zh-tw/xConnect'),
};

const NAMESPACE = 'xConnect';

/** A module's words, copied: the instance may merge into what it holds, and a module's object is shared. */
function wordsOf(loaded: unknown): Bundle {
  const words = typeof loaded === 'object' && loaded !== null && 'default' in loaded ? (loaded as { default: unknown }).default : loaded;
  return structuredClone(words as Bundle);
}

/** Adds the page's English and the words of `tag` to the page's instance, once each; a language it cannot fetch stays English. */
export async function addConnectWords(i18n: I18nInstance, tag: string): Promise<void> {
  if (!i18n.hasResourceBundle('en-US', NAMESPACE)) i18n.addResourceBundle('en-US', NAMESPACE, wordsOf(english), true, true);
  const load = LOADERS[tag];
  if (load === undefined || i18n.hasResourceBundle(tag, NAMESPACE)) return;
  try {
    i18n.addResourceBundle(tag, NAMESPACE, wordsOf(await load()), true, true);
  } catch {
    // Not fetched: the English stands in, as for any missing word.
  }
}
