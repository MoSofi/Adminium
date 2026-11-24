// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Keys the Translations editor never offers, and no override may change.
 *
 * `email:texts.*` are the words the server puts in a text itself: the opt-out
 * line, the one confirmation of a STOP, the "this number is not read" answer
 * and the test text. They carry rules, not style (a STOP confirmation asks no
 * question and sells nothing; the reply line must say STOP), so the server
 * reads them from the compiled catalogue alone and an override would change
 * nothing. Offering them for editing would promise what cannot happen.
 */
const FIXED_GROUPS: Readonly<Record<string, readonly string[]>> = { email: ['texts'] };

/** Whether `namespace:key` is fixed: not listed by the editor, and refused as an override. */
export function isFixedKey(namespace: string, key: string): boolean {
  return (FIXED_GROUPS[namespace] ?? []).some((group) => key === group || key.startsWith(`${group}.`));
}
