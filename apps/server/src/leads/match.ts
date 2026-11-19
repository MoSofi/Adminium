// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "ALREADY HERE": WHETHER A FOUND COMPANY IS A ROW OF THE COMPANIES TABLE.
 *
 * Decided AS THE INSTALL, never as the person reading: a rep held to their
 * own companies does not see a colleague's, and a match made under their row
 * limits would say "new", so "Add" would make the company twice. What the
 * reader may open is asked after, by the caller, of each row this finds:
 * one they cannot open shows "Already here — kept by a colleague", with no
 * values and no link.
 *
 * In this order, the first that holds:
 *  1. the company number (case, spaces, dots and dashes aside);
 *  2. the website's domain (scheme, `www.`, port, path and case aside);
 *  3. the name and the town (case, accents, punctuation and a legal suffix
 *     such as Ltd, Limited, SARL or AS aside), or the name alone where the
 *     table keeps no town, or either side has none.
 *
 * Compared in JavaScript, never by the database's collation: Postgres and
 * SQLite compare text by case, MySQL's default does not, and none of them
 * strips "Limited". The database is asked only for candidates (a number or
 * a domain anywhere in the column, a town, or a word of the name), at most
 * {@link MATCH_CANDIDATES_MAX} of them.
 */
import { sql, type Expression, type Kysely, type SqlBool } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { rowKeyOf } from '../payments/payables.js';
import type { CompaniesTable } from './companies.js';

/** The most rows one match reads. */
export const MATCH_CANDIDATES_MAX = 100;

/** What a found company is matched by. */
export interface MatchWanted {
  name: string;
  number?: string | undefined;
  website?: string | undefined;
  town?: string | undefined;
}

/** A row a found company is: its key, and what it matched by. */
export interface Matched {
  key: string;
  by: 'number' | 'domain' | 'name';
}

/** Legal forms dropped from the end of a name before names are compared. */
const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'plc', 'llp', 'lp', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'cic',
  'sarl', 'sa', 'sas', 'sasu', 'eurl', 'sci', 'snc', 'scop',
  'as', 'asa', 'ans', 'da', 'enk', 'nuf',
  'gmbh', 'ag', 'kg', 'ug', 'ohg', 'ev',
  'aps', 'is',
  'sro', 'spol',
  'bv', 'nv', 'oy', 'ab',
]);

/** Text without accents, in lower case. */
const folded = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** A company number as compared: letters and digits only, in upper case. */
export function numberKey(value: string | null | undefined): string {
  return typeof value === 'string' ? folded(value).replace(/[^a-z0-9]/g, '').toUpperCase() : '';
}

/** A website's domain as compared: its host in lower case without `www.`; '' when it is no address. */
export function domainKey(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim() === '') return '';
  const text = value.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

/** A name as compared: the words of it without accents, case, punctuation or a legal form at its end. */
export function nameKey(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const words = folded(value)
    .replace(/&/g, ' and ')
    // `S.A.R.L.` and `s.r.o.` read as one word.
    .replace(/\b((?:[a-z]\.){2,})/g, (dotted) => dotted.replace(/\./g, ''))
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
  while (words.length > 1 && LEGAL_SUFFIXES.has(words.at(-1)!)) words.pop();
  return words.join(' ');
}

/** A town as compared. */
export function townKey(value: string | null | undefined): string {
  return typeof value === 'string' ? folded(value).replace(/[^a-z0-9]+/g, ' ').trim() : '';
}

/** `%`, `_` and the escape mark itself, made literal in a LIKE pattern (`!` escapes: a backslash means something else in MySQL's strings). */
const likeLiteral = (value: string): string => value.replace(/[!%_]/g, (mark) => `!${mark}`);

/** The longest word of a name, for asking the database for rows that may be it. */
function longestWord(name: string): string {
  return name.split(' ').reduce((best, word) => (word.length > best.length ? word : best), '');
}

const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'bigint' ? String(value) : null);

/**
 * Which row of the companies table each found company already is, as the
 * install reads the table (see the header); null where none is.
 */
export async function alreadyHere(db: Kysely<SourceDatabase>, companies: CompaniesTable, wanted: readonly MatchWanted[]): Promise<(Matched | null)[]> {
  const { declared, table } = companies;
  const has = (column: string | undefined | null): column is string => column !== undefined && column !== null && table.columns.has(column);
  const numberColumn = has(declared.lead?.number) ? declared.lead!.number! : null;
  const websiteColumn = has(declared.lead?.website) ? declared.lead!.website! : null;
  const townColumn = has(declared.lead?.address?.town) ? declared.lead!.address!.town! : null;
  const nameColumn = has(declared.name) ? declared.name : null;
  if (wanted.length === 0 || nameColumn === null || table.primaryKey.length === 0) return wanted.map(() => null);

  const keys = wanted.map((one) => ({ number: numberKey(one.number), domain: domainKey(one.website), name: nameKey(one.name), town: townKey(one.town) }));
  const numbers = [...new Set(keys.map((one) => one.number).filter((one) => one !== ''))];
  const domains = [...new Set(keys.map((one) => one.domain).filter((one) => one !== ''))];
  const towns = [...new Set(wanted.map((one) => one.town?.trim().toLowerCase() ?? '').filter((one) => one !== ''))];
  const words = [...new Set(keys.filter((one) => townColumn === null || one.town === '').map((one) => longestWord(one.name)).filter((one) => one.length >= 3))];

  const rows = (await db
    .selectFrom(table.id as never)
    .selectAll()
    .where((eb) => {
      const any: Expression<SqlBool>[] = [];
      // The database narrows; JavaScript decides. `upper`, `lower` and `replace` mean the same on every engine.
      if (numberColumn !== null && numbers.length > 0) any.push(sql<SqlBool>`upper(replace(replace(replace(${sql.ref(numberColumn)}, ' ', ''), '-', ''), '.', '')) in (${sql.join(numbers)})`);
      if (websiteColumn !== null) for (const domain of domains) any.push(sql<SqlBool>`lower(${sql.ref(websiteColumn)}) like ${`%${likeLiteral(domain)}%`} escape '!'`);
      if (townColumn !== null && towns.length > 0) any.push(sql<SqlBool>`lower(${sql.ref(townColumn)}) in (${sql.join(towns)})`);
      for (const word of words) any.push(sql<SqlBool>`lower(${sql.ref(nameColumn)}) like ${`%${likeLiteral(word)}%`} escape '!'`);
      return any.length === 0 ? sql<SqlBool>`1 = 0` : eb.or(any);
    })
    .orderBy(sql.ref(table.primaryKey[0]!) as never)
    .limit(MATCH_CANDIDATES_MAX)
    .execute()) as Row[];

  const read = rows.map((row) => ({
    key: rowKeyOf(table, row),
    number: numberColumn === null ? '' : numberKey(textOf(row[numberColumn])),
    domain: websiteColumn === null ? '' : domainKey(textOf(row[websiteColumn])),
    name: nameKey(textOf(row[nameColumn])),
    town: townColumn === null ? '' : townKey(textOf(row[townColumn])),
  }));

  return keys.map((one) => {
    if (one.number !== '') {
      const hit = read.find((row) => row.number === one.number);
      if (hit !== undefined) return { key: hit.key, by: 'number' };
    }
    if (one.domain !== '') {
      const hit = read.find((row) => row.domain === one.domain);
      if (hit !== undefined) return { key: hit.key, by: 'domain' };
    }
    if (one.name !== '') {
      // Both towns known: they must agree. Otherwise the name decides.
      const hit = read.find((row) => row.name === one.name && (one.town === '' || row.town === '' || row.town === one.town));
      if (hit !== undefined) return { key: hit.key, by: 'name' };
    }
    return null;
  });
}
