// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The words a picture is made from, filled in for the person.
 *
 * Plain code, no model: filling the box costs nothing. What the picture is
 * of (the spot's own words, or the row's name and its table), where it is
 * used (the app's name), and how the app looks (the person's own words about
 * its look), with a short tail by shape. English, which image models follow
 * best; the person changes them in any language.
 *
 * A table that holds people never has a row's name put in: a made
 * picture of "Anna Weber" is a picture of no one, sent to a second company
 * under a real name. Its lines start from the table's name alone.
 */
import { plainWords } from './untrusted.js';

/** The longest words filled in. */
export const PICTURE_WORDS_MAX = 300;

export interface PictureWordsInput {
  /** The spot's own words (what to search for), or a sample row's name. */
  subject: string;
  /** For a sample row: its table's name ("Cakes"). */
  table?: string | undefined;
  /** The app's name. */
  appName?: string | undefined;
  /** What the person said about the app's look (`look.json` `words`). */
  look?: string | undefined;
  shape: 'wide' | 'tall' | 'square';
  /** The table holds people: no row's name is used. */
  people?: boolean | undefined;
}

const TAIL: Readonly<Record<PictureWordsInput['shape'], string>> = {
  wide: 'wide photo, natural light, no text',
  tall: 'tall photo, natural light, no text',
  square: 'photo, natural light, no text',
};

export function pictureWords(input: PictureWordsInput): string {
  const table = plainWords(input.table ?? '', 60);
  const subject = input.people === true ? '' : plainWords(input.subject, 120);
  const what =
    input.people === true
      ? `A portrait photo for ${table === '' ? 'a person' : `"${table}"`}, neutral background`
      : subject === ''
        ? table === ''
          ? 'A picture'
          : `A picture of ${table.toLowerCase()}`
        : table !== '' && !subject.toLowerCase().includes(table.toLowerCase().replace(/s$/, ''))
          ? `${subject} (${table.toLowerCase().replace(/s$/, '')})`
          : subject;
  const app = plainWords(input.appName ?? '', 60);
  const look = plainWords(input.look ?? '', 100);
  const parts = [what, app === '' ? null : `for ${app}`, look === '' ? null : `look: ${look}`, TAIL[input.shape]].filter((part): part is string => part !== null);
  return plainWords(parts.join(', '), PICTURE_WORDS_MAX);
}

/** Whether a table holds people, by its columns: an email, a phone, or a person's name. */
export function holdsPeople(columns: readonly { name: string; semantic?: string | undefined }[]): boolean {
  return columns.some((column) => {
    const semantic = (column.semantic ?? '').toLowerCase();
    if (semantic === 'email' || semantic === 'phone' || semantic === 'person' || semantic === 'name' || semantic === 'avatar') return true;
    return /(^|_)(e_?mail|phone|first_?name|last_?name|surname|full_?name|birth|dob)($|_)/i.test(column.name);
  });
}
