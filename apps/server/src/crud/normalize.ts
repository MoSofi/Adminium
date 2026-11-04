// SPDX-License-Identifier: AGPL-3.0-only
/**
 * NORMALIZE — how a `text` column with a `normalize` rule keeps its value:
 * `trim` without spaces at either end, `email` trimmed and in lower case,
 * `code` as a code is compared (upper case, spaces and dashes left out).
 *
 * One function for a value a writer sends (FILL) and a value a formula works
 * out (FORMULA), so a joined key is kept the way a typed one is and two rows
 * that differ only in case meet at the unique key.
 */
import { normaliseAddress } from '../public-api/claim-code.js';
import { canonicalCode } from './code-lookup.js';

export type NormalizeHow = 'trim' | 'email' | 'code';

/** `text` as a column with `normalize: how` keeps it. */
export function normalizedAs(how: NormalizeHow, text: string): string {
  return how === 'email' ? normaliseAddress(text) : how === 'code' ? canonicalCode(text) : text.trim();
}
