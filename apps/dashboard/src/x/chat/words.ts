// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The chat window's own words (`xChat`), added to the `/x/` page's
 * instance by the chat's chunk itself: a form's page, whose first load
 * carries the `x` words, never carries these.
 *
 * English comes with the chunk (it is every language's fallback); the
 * visitor's language is fetched when the window starts and whenever they
 * pick another, before the page switches to it, so nothing is drawn in one
 * language and redrawn in another.
 */
import type { I18nInstance } from '@adminium/i18n/page';
import english from '@adminium/i18n/resources/en-us/xChat';

type Bundle = Record<string, unknown>;

const LOADERS: Readonly<Record<string, () => Promise<unknown>>> = {
  'ar-EG': () => import('@adminium/i18n/resources/ar-eg/xChat'),
  'cs-CZ': () => import('@adminium/i18n/resources/cs-cz/xChat'),
  'da-DK': () => import('@adminium/i18n/resources/da-dk/xChat'),
  'de-DE': () => import('@adminium/i18n/resources/de-de/xChat'),
  'fr-FR': () => import('@adminium/i18n/resources/fr-fr/xChat'),
  'zh-CN': () => import('@adminium/i18n/resources/zh-cn/xChat'),
  'zh-TW': () => import('@adminium/i18n/resources/zh-tw/xChat'),
};

const NAMESPACE = 'xChat';

/** A module's words, copied: the instance may merge into what it holds, and a module's object is shared. */
function wordsOf(loaded: unknown): Bundle {
  const words = typeof loaded === 'object' && loaded !== null && 'default' in loaded ? (loaded as { default: unknown }).default : loaded;
  return structuredClone(words as Bundle);
}

/** Adds the chat's English and the words of `tag` to the page's instance, once each; a language it cannot fetch stays English. */
export async function addChatWords(i18n: I18nInstance, tag: string): Promise<void> {
  if (!i18n.hasResourceBundle('en-US', NAMESPACE)) i18n.addResourceBundle('en-US', NAMESPACE, wordsOf(english), true, true);
  const load = LOADERS[tag];
  if (load === undefined || i18n.hasResourceBundle(tag, NAMESPACE)) return;
  try {
    i18n.addResourceBundle(tag, NAMESPACE, wordsOf(await load()), true, true);
  } catch {
    // Not fetched: the English stands in, as for any missing word.
  }
}
