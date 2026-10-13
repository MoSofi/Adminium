// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit's own words on an app's screen.
 *
 * The parts read their words as every widget does, through
 * `@adminium/i18n/react`. In the dashboard that reads the catalogues the
 * bootstrap chose; here there is no dashboard, so a mount is given a small
 * stand-in holding only its part's words in the person's language
 * (`./words/<tag>.ts`, written by `scripts/gen-kit-words.mjs`, one chunk per
 * language). A language the kit does not have reads as en-US.
 *
 * A key a part asks for that is not in its set is answered with the English
 * written beside it in the code and remembered in {@link outsideWords}: the
 * tests fail on one, so a part cannot quietly speak English to everybody.
 */
import type { I18nInstance } from '@adminium/i18n';

import type { KitPartName, KitWords } from './contract.js';

const LOADERS: Record<string, () => Promise<{ default: KitWords }>> = {
  'en-US': () => import('./words/en-US.js'),
  'ar-EG': () => import('./words/ar-EG.js'),
  'cs-CZ': () => import('./words/cs-CZ.js'),
  'da-DK': () => import('./words/da-DK.js'),
  'de-DE': () => import('./words/de-DE.js'),
  'fr-FR': () => import('./words/fr-FR.js'),
  'zh-CN': () => import('./words/zh-CN.js'),
  'zh-TW': () => import('./words/zh-TW.js'),
};

export const KIT_LOCALES: readonly string[] = Object.keys(LOADERS);

/** The kit's language for what a config or a browser says: `ar-EG`, `ar_EG` and `ar` are all ar-EG; anything unknown is en-US. */
export function kitLocaleOf(locale: string): string {
  const asked = locale.replace('_', '-').toLowerCase();
  const exact = KIT_LOCALES.find((tag) => tag.toLowerCase() === asked);
  if (exact !== undefined) return exact;
  const language = asked.split('-')[0];
  return KIT_LOCALES.find((tag) => tag.toLowerCase().split('-')[0] === language) ?? 'en-US';
}

/** The words of a language. A file that will not load leaves the parts on the English in their code. */
export async function loadKitWords(locale: string): Promise<{ tag: string; words: KitWords | null }> {
  const tag = kitLocaleOf(locale);
  try {
    return { tag, words: (await LOADERS[tag]!()).default };
  } catch {
    return { tag, words: null };
  }
}

const outside = new Set<string>();

/** The keys a mounted part asked for that its set does not hold, as `part ns:key`. */
export function outsideWords(): readonly string[] {
  return [...outside];
}

/** Forgets them (a test's). */
export function clearOutsideWords(): void {
  outside.clear();
}

/** `{name}` put in. No part's words hold a plural yet; one that does reads as written until this learns ICU. */
function filled(text: string, args: Record<string, unknown>): string {
  return text.includes('{') ? text.replace(/\{(\w+)\}/g, (whole: string, name: string) => (name in args ? String(args[name]) : whole)) : text;
}

/**
 * What `I18nProvider` and `useMaybeT` need of an i18next instance, over one
 * part's words: the language, a `t`, and a listener list nobody calls (a
 * mount's language changes by a new stand-in, not by an event).
 */
export function kitI18n(part: KitPartName, tag: string, words: KitWords | null): I18nInstance {
  const mine = words?.[part] ?? {};
  const standIn = {
    language: tag,
    on: (): void => undefined,
    off: (): void => undefined,
    t: (key: string, options?: Record<string, unknown>): string => {
      const { defaultValue, ...args } = options ?? {};
      const text = mine[key];
      if (text === undefined) {
        // With no words at all the file did not load: that is the network's doing, not a key outside the set.
        if (words !== null) outside.add(`${part} ${key}`);
        return filled(typeof defaultValue === 'string' ? defaultValue : key, args);
      }
      return filled(text, args);
    },
  };
  return standIn as unknown as I18nInstance;
}
