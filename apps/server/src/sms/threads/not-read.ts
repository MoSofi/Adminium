// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ONE FIXED ANSWER when an app's replies are off: "this number is not
 * read", with a way to reach the business. It goes in the business's own
 * language, the send path adds the opt-out line as it does to every text, and
 * nothing a customer wrote is ever in it.
 *
 * The words are the catalogue's (`email:texts.notRead`, read by `../words.ts`),
 * in all eight languages. A country that allows no contact details in a text
 * gets the first sentence alone.
 */
import { parsePhone } from '../../phone/index.js';
import type { BusinessContact } from '../send/opt-out.js';
import { TEXT_LANGUAGES, textWordsFor } from '../words.js';

/** The eight languages the answer is written in. */
export const NOT_READ_LANGUAGES: readonly string[] = TEXT_LANGUAGES;

/** Where a text may carry no phone number or address (the UAE), as the opt-out line knows too. */
const NO_CONTACT_IN_BODY: ReadonlySet<string> = new Set(['AE']);

/** One line, so nothing a setting holds can break the sentence it sits in. */
const oneLine = (value: string | null | undefined): string => (value ?? '').replaceAll(/\s+/g, ' ').trim();

/** The answer's words for this number, before the send path adds its opt-out line. */
export function notReadText(input: { locale: string | null; business: BusinessContact; to: string }): string {
  const phone = parsePhone(input.to, null);
  const contact = oneLine(input.business.phone) || oneLine(input.business.email);
  const withContact = contact !== '' && !(phone.ok && NO_CONTACT_IN_BODY.has(phone.country));
  return textWordsFor(input.locale).notRead(oneLine(input.business.name), withContact ? contact : null);
}
