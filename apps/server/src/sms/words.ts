// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WORDS THE SERVER ITSELF PUTS IN A TEXT, in the eight languages: the
 * opt-out line, the one confirmation of a STOP, the "this number is not read"
 * answer and the test text. They live in the catalogue, at `email:texts`.
 *
 * READ FROM THE COMPILED CATALOGUE, NEVER FROM THE TRANSLATIONS EDITOR'S
 * OVERRIDES. These sentences carry rules, not style: a STOP confirmation asks
 * no question and sells nothing (the US rule from 2026-11-25), and the reply
 * line must say STOP. A reworded copy could break either, so every server says
 * what ships. A business's own words go in its text templates.
 *
 * The eight bundles are imported here, so every function stays synchronous
 * and pure. The stop and start words themselves are matching rules, not
 * messages, and stay in `inbound/control-words.ts`.
 */
import arEG from '@adminium/i18n/resources/ar-eg/email';
import csCZ from '@adminium/i18n/resources/cs-cz/email';
import daDK from '@adminium/i18n/resources/da-dk/email';
import deDE from '@adminium/i18n/resources/de-de/email';
import enUS from '@adminium/i18n/resources/en-us/email';
import frFR from '@adminium/i18n/resources/fr-fr/email';
import zhCN from '@adminium/i18n/resources/zh-cn/email';
import zhTW from '@adminium/i18n/resources/zh-tw/email';

/** The catalogue's `email:texts` group, as each bundle holds it. */
interface TextWordsGroup {
  optOut: { reply: string; contact: string };
  stopConfirmed: string;
  notRead: { withContact: string; alone: string };
  test: string;
}

const GROUPS: Readonly<Record<string, TextWordsGroup>> = {
  'en-US': enUS.texts,
  'de-DE': deDE.texts,
  'fr-FR': frFR.texts,
  'da-DK': daDK.texts,
  'cs-CZ': csCZ.texts,
  'ar-EG': arEG.texts,
  'zh-CN': zhCN.texts,
  'zh-TW': zhTW.texts,
};

/** The eight languages a text from the server can be written in. */
export const TEXT_LANGUAGES: readonly string[] = Object.keys(GROUPS);

/** `en_US`, `en-us` or `en` to one of the eight; US English for anything else, and for nothing. */
export function textLanguageOf(locale: string | null | undefined): string {
  const tag = (locale ?? '').replaceAll('_', '-').toLowerCase();
  const exact = TEXT_LANGUAGES.find((one) => one.toLowerCase() === tag);
  if (exact !== undefined) return exact;
  const base = tag.split('-')[0];
  if (base === 'zh') return tag.includes('tw') || tag.includes('hk') || tag.includes('hant') ? 'zh-TW' : 'zh-CN';
  return TEXT_LANGUAGES.find((one) => one.split('-')[0] === base) ?? 'en-US';
}

/** A catalogue sentence with its `{name}` arguments filled. A value is put in as it is: `$&` in a name stays `$&`. */
function filled(message: string, values: Readonly<Record<string, string>>): string {
  return message.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole);
}

export interface TextWords {
  /** The language these words are in, one of {@link TEXT_LANGUAGES}. */
  language: string;
  /** "Reply STOP to opt out." */
  replyStop: string;
  /** "To stop these texts, contact {contact}." */
  contactLine(contact: string): string;
  /** The one plain confirmation of a STOP: no question, no offer, no link. */
  stopConfirmed: string;
  /** "{business}: This number is not read. Contact us: {contact}". With no contact, the first sentence alone. */
  notRead(business: string, contact: string | null): string;
  /** The fixed body of the test text. */
  test: string;
  /** What goes between a text and its opt-out line. Chinese runs on, with no space. */
  gap: string;
}

function wordsOf(language: string): TextWords {
  const group = GROUPS[language] ?? GROUPS['en-US']!;
  return {
    language,
    replyStop: group.optOut.reply,
    contactLine: (contact) => filled(group.optOut.contact, { contact }),
    stopConfirmed: group.stopConfirmed,
    notRead(business, contact) {
      const words = contact === null ? group.notRead.alone : group.notRead.withContact;
      // A business with no name: the sentence starts where its name would end.
      const opened = business === '' ? words.replace(/^\{business\}\s?[:：]\s?/u, '') : words;
      return filled(opened, { business, ...(contact === null ? {} : { contact }) });
    },
    test: group.test,
    gap: language.startsWith('zh') ? '' : ' ',
  };
}

const ALL: ReadonlyMap<string, TextWords> = new Map(TEXT_LANGUAGES.map((language) => [language, wordsOf(language)]));

/** The words for a locale in any of its spellings; US English for an unknown one. */
export function textWordsFor(locale: string | null | undefined): TextWords {
  return ALL.get(textLanguageOf(locale)) ?? ALL.get('en-US')!;
}

/** Every STOP confirmation the server may send, one per language: the only bodies the confirmation's own door lets through. */
export const STOP_CONFIRMATIONS: ReadonlySet<string> = new Set([...ALL.values()].map((words) => words.stopConfirmed));
