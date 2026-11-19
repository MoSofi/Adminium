// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE TELL MAIL'S OWN WORDS: the sentences the engine adds after the
 * add-on's text, in the language the person is told in, and which languages
 * those are.
 *
 * ─── Which language ────────────────────────────────────────────────────────
 * The language of the company's country, when it is one of the eight and
 * the purpose is written in it (a French company's people are told in
 * French). Otherwise the install's language and English, one after the
 * other (English once, when the install's is English): a person must be
 * told in a language they can read, and nothing tells which one a stranger
 * reads but where they work.
 *
 * ─── What the engine adds (Art. 14) ────────────────────────────────────────
 * Whatever the add-on's text says, these follow it, fixed:
 *  - where their details came from, by the source's name, and when;
 *  - why they are kept (the purpose, one plain sentence) and on what basis:
 *    "our legitimate interest in this (GDPR Article 6(1)(f))";
 *  - how long, counted from the day they were found (never "from today":
 *    a mail sent again later would be wrong);
 *  - their rights (to see, correct or delete their details, to limit what
 *    is done with them, to object, to a copy) and to complain to the
 *    authority for data privacy where they live;
 *  - the privacy notice, when it is set;
 *  - set apart from the rest, the Object block: a heading and one button
 *    to the Object page (Art. 21(4));
 *  - who keeps the details and whom to write to.
 * Every sentence travels as a value of its own (`{{tell_…}}`), so nothing a
 * stranger's name or the owner's purpose holds is read as a placeholder.
 */
import type { FormLanguage, Words } from '@adminium/add-on-contracts/forms';

/** A language a found person may be told in (`fr-FR`). */
export type TellLanguage = FormLanguage;

/** The language each country writes in, where it is one of the eight (ISO 3166-1 alpha-2). */
export const COUNTRY_LANGUAGE: Readonly<Record<string, TellLanguage>> = {
  GB: 'en-US',
  IE: 'en-US',
  US: 'en-US',
  AU: 'en-US',
  NZ: 'en-US',
  FR: 'fr-FR',
  MC: 'fr-FR',
  DE: 'de-DE',
  AT: 'de-DE',
  LI: 'de-DE',
  CZ: 'cs-CZ',
  DK: 'da-DK',
  EG: 'ar-EG',
  CN: 'zh-CN',
  TW: 'zh-TW',
};

/** The language a mail's tag stands for, among the eight; null for another. */
export function tellLanguageOf(tag: string | null | undefined): TellLanguage | null {
  if (typeof tag !== 'string') return null;
  const wanted = tag.replace('_', '-');
  const known = Object.values(COUNTRY_LANGUAGE).find((one) => one === wanted);
  return known ?? (wanted === 'en-US' ? 'en-US' : null);
}

/** The languages a found person is told in (see the header): those the purpose is written in. Empty: they cannot be told. */
export function tellLanguages(country: string | null, installLanguage: string, purpose: Words): TellLanguage[] {
  const written = (language: TellLanguage) => typeof purpose[language] === 'string' && purpose[language]!.trim() !== '';
  const own = country === null ? undefined : COUNTRY_LANGUAGE[country.trim().toUpperCase()];
  if (own !== undefined && written(own)) return [own];
  const install = tellLanguageOf(installLanguage) ?? 'en-US';
  return [...new Set<TellLanguage>([install, 'en-US'])].filter(written);
}

/** What the engine's sentences say, for one person. */
export interface TellFacts {
  /** Who keeps the details, and where. */
  business: string;
  postal: string | null;
  /** Whom to write to (the DPO contact, else the business's contact address). */
  contact: string | null;
  /** The source, by name ("Hunter (hunter.io)"). */
  source: string;
  /** When they were found. */
  foundAt: number;
  /** A sole trader: the source gave their business's details, and a member of staff typed their address. */
  addressByStaff?: boolean | undefined;
  /** The install's clock. */
  zone: string;
  purpose: string;
  keepYears: number;
  noticeUrl: string | null;
  /** The person's first name, when they have one. */
  firstName: string | null;
}

/** A translator for one language (`email:` keys, each with its English words as the default). */
export type TellTranslate = (key: string, options: { defaultValue: string } & Record<string, unknown>) => string;

/** A day as a reader of `language` writes it: "28 Jul 2026". */
export function tellDate(at: number, language: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/** The engine's blocks for one language, with the values they print (named `tell_<n>_<what>`), and the Object block apart at the end. */
export function tellBlocks(t: TellTranslate, language: string, n: number, facts: TellFacts): { blocks: Record<string, unknown>[]; vars: Record<string, string> } {
  const vars: Record<string, string> = {};
  const name = (what: string) => `tell_${String(n)}_${what}`;
  const put = (what: string, value: string): string => {
    vars[name(what)] = value;
    return `{{${name(what)}}}`;
  };
  const date = tellDate(facts.foundAt, language, facts.zone);
  const paras = [
    put(
      'source',
      facts.addressByStaff === true
        ? t('email:leadsTell.sourceStaff', { defaultValue: '{source} gave your business’s registered details on {date}. A member of our staff added your e-mail address.', source: facts.source, date })
        : t('email:leadsTell.source', { defaultValue: '{source} found your work address on {date}.', source: facts.source, date }),
    ),
    put('why', t('email:leadsTell.why', { defaultValue: 'Why we keep them: {purpose}', purpose: facts.purpose })),
    put('basis', t('email:leadsTell.basis', { defaultValue: 'We rely on our legitimate interest in this (GDPR Article 6(1)(f)).' })),
    put('keep', t('email:leadsTell.keep', { defaultValue: '{years, plural, one {We keep your details for # year from {date}, or from the last time you write to us.} other {We keep your details for # years from {date}, or from the last time you write to us.}}', years: facts.keepYears, date })),
    put(
      'rights',
      t('email:leadsTell.rights', { defaultValue: 'You can ask to see, correct or delete your details, to limit what we do with them, to object to our keeping them, or to get a copy of them. You can also complain to the authority for data privacy where you live.' }),
    ),
  ];
  if (facts.noticeUrl !== null) paras.push(put('notice', t('email:leadsTell.notice', { defaultValue: 'Our privacy notice: {url}', url: facts.noticeUrl })));
  const who = facts.postal === null ? facts.business : `${facts.business}, ${facts.postal}`;
  const footer =
    facts.contact === null ? t('email:leadsTell.keptBy', { defaultValue: 'Kept by {who}.', who }) : t('email:leadsTell.questions', { defaultValue: 'Questions? Write to {contact}. {who}.', contact: facts.contact, who });
  const blocks: Record<string, unknown>[] = [
    { block: 'email.text', id: name('words'), data: { paras } },
    // The Object block, set apart from everything above it: a rule, its question, one button.
    { block: 'email.divider', id: name('apart'), data: { height: 8 } },
    { block: 'email.heading', id: name('object-ask'), data: { level: 2, text: put('ask', t('email:leadsTell.objectAsk', { defaultValue: 'Don’t want us to keep your details?' })) } },
    { block: 'email.button', id: name('object'), data: { label: put('object', t('email:leadsTell.object', { defaultValue: 'Object' })), url: '{{object_link}}' } },
    { block: 'email.text', id: name('footer'), data: { paras: [put('footer', footer)] } },
  ];
  return { blocks, vars };
}

/** The engine's opening for a language the add-on wrote no text in: a heading and a greeting. */
export function tellOpening(t: TellTranslate, n: number, firstName: string | null): { blocks: Record<string, unknown>[]; vars: Record<string, string> } {
  const heading = `tell_${String(n)}_heading`;
  const hello = `tell_${String(n)}_hello`;
  return {
    blocks: [
      { block: 'email.heading', id: heading, data: { level: 1, text: `{{${heading}}}` } },
      { block: 'email.text', id: hello, data: { paras: [`{{${hello}}}`] } },
    ],
    vars: {
      [heading]: t('email:leadsTell.subject', { defaultValue: 'Why we have your details' }),
      [hello]: firstName === null ? t('email:leadsTell.helloNoName', { defaultValue: 'Hello,' }) : t('email:leadsTell.hello', { defaultValue: 'Hello {name},', name: firstName }),
    },
  };
}

/** A source by name, for a person to read: its id in words and the host it was asked at ("Hunter (hunter.io)"). */
export function sourceName(id: string, hosts: readonly string[]): string {
  const words = id.replaceAll('-', ' ');
  const named = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  const host = hosts[0]?.replace(/^(?:api|www|data)\./, '');
  return host === undefined ? named : `${named} (${host})`;
}
