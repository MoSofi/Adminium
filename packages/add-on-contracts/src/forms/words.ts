// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The languages a form is written in, and a text in them.
 *
 * A form is one form with a version per language (the owner writes each).
 * Every text a visitor reads is a `Words`: a record of language to string.
 * A form lists the languages it speaks, and each of its texts carries exactly
 * those: one missing would show a blank to a visitor in that language, and one
 * not listed is a translation nobody can reach. The definition's own check
 * (`formDefinitionSchema`) holds that, with the form's list at hand.
 */
import { z } from 'zod';

/** The eight languages of the product, in the order a form's language menu lists them. */
export const FORM_LANGUAGES = ['en-US', 'de-DE', 'fr-FR', 'cs-CZ', 'da-DK', 'ar-EG', 'zh-CN', 'zh-TW'] as const;
export type FormLanguage = (typeof FORM_LANGUAGES)[number];
export const formLanguageSchema = z.enum(FORM_LANGUAGES);

/** A text in some of the form's languages: each version at least one visible character, at most `max`. */
export type Words = Partial<Record<FormLanguage, string>>;

export function wordsSchema(max: number) {
  return z.partialRecord(formLanguageSchema, z.string().min(1).max(max).regex(/\S/, 'a text holds a visible character'));
}

/** The longest each kind of text may be, in characters. */
export const FORM_WORDS_MAX = {
  title: 200,
  intro: 2000,
  section: 200,
  label: 500,
  /** A tick's label is the agreement's whole wording. */
  wording: 2000,
  help: 1000,
  choice: 200,
  ending: 2000,
} as const;
