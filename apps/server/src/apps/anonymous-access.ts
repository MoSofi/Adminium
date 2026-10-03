// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What an app's public access may not hand to anyone at all, decided across
 * its entries. Kept apart from the install's planning so the folder check
 * (`adminium app check`, the Designer) reads the same rule without the
 * install's machinery.
 */
import type { Manifest } from '@adminium/manifest';

type PublicAccessEntry = NonNullable<Extract<Manifest, { kind: 'app' }>['publicAccess']>[number];

/** The key every entry uses unless it names another. */
const CUSTOMER_KEY_PURPOSE = 'customer';

/**
 * An entry anyone at all may use: no claim, no sign-in, no person found or
 * made by the write, and no row reached only through one the caller may
 * already see (`visibleWith`) or by a signed-in guest (`level`).
 */
export const openToAnyone = (entry: PublicAccessEntry): boolean =>
  entry.kind !== 'availability' && entry.claim === undefined && entry.claimedBy === undefined && entry.identity === undefined && entry.visibleWith === undefined && entry.level === undefined;

/**
 * The entries that let anyone READ a table anyone may also ADD to, on the
 * same key: the index of each such reading entry. One entry holding both is
 * refused where it is made; this is the same hole written as two entries
 * (`POST` in one, `GET` in the next), through which every row a stranger
 * added (an order, with its name and address) is read by anyone.
 */
export function anonymousAddAndRead(entries: readonly PublicAccessEntry[]): number[] {
  const keyOf = (entry: PublicAccessEntry): string => `${entry.key ?? CUSTOMER_KEY_PURPOSE}\n${entry.table}`;
  const added = new Set(entries.filter((entry) => openToAnyone(entry) && entry.methods.includes('POST')).map(keyOf));
  return entries.flatMap((entry, index) => (openToAnyone(entry) && entry.methods.includes('GET') && !entry.methods.includes('POST') && added.has(keyOf(entry)) ? [index] : []));
}

/** What is said of such an entry, in the check and at the install. */
export const addAndReadRefusal = (table: string): string =>
  `"${table}" lets anyone add a row (another entry grants POST), so it may not also let anyone read its rows: everyone could read every row, with whatever people typed into it. ` +
  'To let a person see only their own row, give this entry a claim instead, e.g. "claim": { "match": ["number", "email"] } (the columns they prove they know), and have the page call client.claim({ number, email }) before it reads.';
