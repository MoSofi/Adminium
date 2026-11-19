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
 * strips "Limited". The database is asked only for candidates, in the same
 * order, each ask narrow enough that its cap never hides the answer: first
 * the numbers (the column with spaces, dots and dashes taken out, compared
 * whole), then each domain still unmatched (in the column anywhere), then
 * each name still unmatched (a word of it in the name column, AND the town
 * or no town). Each ask reads at most {@link MATCH_CANDIDATES_MAX} rows, so
 * a town of a thousand companies is never read whole, and the company that
 * is here by its number is found however many share its town.
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

/**
 * The word of a name to ask the database for rows that may be it: the longest
 * one written as it is folded (no accent, no capital the database could read
 * otherwise), else the longest.
 */
function askingWord(name: string, written: string): string {
  const plain = written.toLowerCase();
  const words = name.split(' ').filter((word) => word.length >= 3);
  const longest = (list: string[]) => list.reduce((best, word) => (word.length > best.length ? word : best), '');
  return longest(words.filter((word) => plain.includes(word))) || longest(words);
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

  const keys = wanted.map((one) => ({ number: numberKey(one.number), domain: domainKey(one.website), name: nameKey(one.name), town: townKey(one.town), townAsked: one.town?.trim().toLowerCase() ?? '' }));
  type Read = { key: string; number: string; domain: string; name: string; town: string };
  const readOf = (row: Row): Read => ({
    key: rowKeyOf(table, row),
    number: numberColumn === null ? '' : numberKey(textOf(row[numberColumn])),
    domain: websiteColumn === null ? '' : domainKey(textOf(row[websiteColumn])),
    name: nameKey(textOf(row[nameColumn])),
    town: townColumn === null ? '' : townKey(textOf(row[townColumn])),
  });
  const ask = async (where: Expression<SqlBool>): Promise<Read[]> =>
    ((await db.selectFrom(table.id as never).selectAll().where(() => where).orderBy(sql.ref(table.primaryKey[0]!) as never).limit(MATCH_CANDIDATES_MAX).execute()) as Row[]).map(readOf);
  const answers: (Matched | null)[] = keys.map(() => null);
  const open = () => keys.map((one, at) => ({ one, at })).filter(({ at }) => answers[at] === null);

  // 1. The numbers, compared whole: `upper`, `replace` mean the same on every engine.
  const numbers = [...new Set(keys.map((one) => one.number).filter((one) => one !== ''))];
  if (numberColumn !== null && numbers.length > 0) {
    const read = await ask(sql<SqlBool>`upper(replace(replace(replace(${sql.ref(numberColumn)}, ' ', ''), '-', ''), '.', '')) in (${sql.join(numbers)})`);
    for (const { one, at } of open()) {
      const hit = one.number === '' ? undefined : read.find((row) => row.number === one.number);
      if (hit !== undefined) answers[at] = { key: hit.key, by: 'number' };
    }
  }
  // 2. Each domain still unmatched, anywhere in the website column.
  if (websiteColumn !== null) {
    for (const domain of [...new Set(open().map(({ one }) => one.domain).filter((one) => one !== ''))]) {
      const read = await ask(sql<SqlBool>`lower(${sql.ref(websiteColumn)}) like ${`%${likeLiteral(domain)}%`} escape '!'`);
      for (const { one, at } of open()) {
        if (one.domain !== domain) continue;
        const hit = read.find((row) => row.domain === one.domain);
        if (hit !== undefined) answers[at] = { key: hit.key, by: 'domain' };
      }
    }
  }
  // 3. Each name still unmatched: a word of it, and its town or none (both towns known: they must agree).
  for (const { one, at } of open()) {
    if (one.name === '') continue;
    const word = askingWord(one.name, wanted[at]!.name);
    const same = (row: Read) => row.name === one.name && (one.town === '' || row.town === '' || row.town === one.town);
    let hit: Read | undefined;
    if (word !== '') {
      const named = sql<SqlBool>`lower(${sql.ref(nameColumn)}) like ${`%${likeLiteral(word)}%`} escape '!'`;
      const where =
        townColumn === null || one.townAsked === ''
          ? named
          : sql<SqlBool>`${named} and (lower(${sql.ref(townColumn)}) = ${one.townAsked} or ${sql.ref(townColumn)} is null or ${sql.ref(townColumn)} = '')`;
      hit = (await ask(where)).find(same);
    }
    // A name the database spells otherwise (an accent the word lacks), or with no word long enough: the town's rows, capped.
    if (hit === undefined && townColumn !== null && one.townAsked !== '') hit = (await ask(sql<SqlBool>`lower(${sql.ref(townColumn)}) = ${one.townAsked}`)).find(same);
    if (hit !== undefined) answers[at] = { key: hit.key, by: 'name' };
  }
  return answers;
}
