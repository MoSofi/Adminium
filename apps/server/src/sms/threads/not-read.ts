// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE FIXED ANSWER when an app's replies are off: "this number is not
 * read", with a way to reach the business. It goes in the business's own
 * language, the send path adds the opt-out line as it does to every text, and
 * nothing a customer wrote is ever in it.
 *
 * The words are the design run's (`80-design-prompts.md`, NOT_READ), in all
 * eight languages. A country that allows no contact details in a text gets the
 * first sentence alone.
 */
import { parsePhone } from '../../phone/index.js';
import type { BusinessContact } from '../send/opt-out.js';

const WITH_CONTACT: Readonly<Record<string, string>> = {
  'en-US': '{business}: This number is not read. Contact us: {contact}',
  'de-DE': '{business}: Diese Nummer wird nicht gelesen. Kontakt: {contact}',
  'fr-FR': "{business} : ce numéro n'est pas consulté. Contact : {contact}",
  'da-DK': '{business}: Dette nummer læses ikke. Kontakt: {contact}',
  'cs-CZ': '{business}: Toto číslo nikdo nečte. Kontakt: {contact}',
  'ar-EG': '{business}: هذا الرقم غير مُتابَع. للتواصل: {contact}',
  'zh-CN': '{business}：此号码无人查看。请联系：{contact}',
  'zh-TW': '{business}：此號碼無人查看。請聯絡：{contact}',
};

const ALONE: Readonly<Record<string, string>> = {
  'en-US': '{business}: This number is not read.',
  'de-DE': '{business}: Diese Nummer wird nicht gelesen.',
  'fr-FR': "{business} : ce numéro n'est pas consulté.",
  'da-DK': '{business}: Dette nummer læses ikke.',
  'cs-CZ': '{business}: Toto číslo nikdo nečte.',
  'ar-EG': '{business}: هذا الرقم غير مُتابَع.',
  'zh-CN': '{business}：此号码无人查看。',
  'zh-TW': '{business}：此號碼無人查看。',
};

/** The eight languages the answer is written in. */
export const NOT_READ_LANGUAGES: readonly string[] = Object.keys(WITH_CONTACT);

/** Where a text may carry no phone number or address (the UAE), as the opt-out line knows too. */
const NO_CONTACT_IN_BODY: ReadonlySet<string> = new Set(['AE']);

/** `en_US`, `en-us` or `en` to one of the eight; English for any other. */
function languageOf(locale: string | null): string {
  const tag = (locale ?? '').replaceAll('_', '-').toLowerCase();
  const exact = NOT_READ_LANGUAGES.find((one) => one.toLowerCase() === tag);
  if (exact !== undefined) return exact;
  const base = tag.split('-')[0];
  if (base === 'zh') return tag.includes('tw') || tag.includes('hk') || tag.includes('hant') ? 'zh-TW' : 'zh-CN';
  return NOT_READ_LANGUAGES.find((one) => one.split('-')[0] === base) ?? 'en-US';
}

/** One line, so nothing a setting holds can break the sentence it sits in. */
const oneLine = (value: string | null | undefined): string => (value ?? '').replaceAll(/\s+/g, ' ').trim();

/** The answer's words for this number, before the send path adds its opt-out line. */
export function notReadText(input: { locale: string | null; business: BusinessContact; to: string }): string {
  const language = languageOf(input.locale);
  const phone = parsePhone(input.to, null);
  const contact = oneLine(input.business.phone) || oneLine(input.business.email);
  const withContact = contact !== '' && !(phone.ok && NO_CONTACT_IN_BODY.has(phone.country));
  const words = (withContact ? WITH_CONTACT : ALONE)[language] ?? ALONE['en-US']!;
  const name = oneLine(input.business.name);
  // A business with no name: the sentence starts where its name would end.
  const opened = name === '' ? words.replace(/^\{business\}\s?[:：]\s?/u, '') : words.replace('{business}', name);
  return opened.replace('{contact}', contact);
}
