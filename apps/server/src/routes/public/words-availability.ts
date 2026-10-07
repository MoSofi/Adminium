// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /public/availability/:ref` FOR AN ENTRY AN ADD-ON ANSWERS — in, low
 * or out for each row a page asks about, in the add-on's own stock words.
 *
 *  - `under` lists row ids of the entry's own table (never a table), at
 *    most sixty; `date` is the day asked about. Nothing else is taken.
 *  - A row no plain public read of the key shows is left out, never
 *    answered: whether it is in stock would say that it exists.
 *  - The add-on is asked ONCE for all the rows not answered in the last
 *    five seconds. Nothing is written, nothing is locked.
 *  - How many are left is said only under the owner's own setting, and only
 *    for today.
 *  - An add-on that cannot answer (off, switched off for the key's app, not
 *    loaded, its code failing) says nothing: every row then reads as in. A
 *    page must not show "sold out" because an add-on is off; the save still
 *    refuses what is not there. One that failed is left alone for five
 *    seconds — a flag, never an answer: an anonymous page cannot make a
 *    broken add-on run on every request.
 *
 * What staff see beside the state — the exact figure, the batch, the item
 * that runs out first — never leaves through here.
 */
import type { FastifyBaseLogger } from 'fastify';

import type { RollupInto } from '../../crud/column-rules.js';
import type { RecordFilter } from '../../crud/filters.js';
import type { ResolvedTable } from '../../crud/identifiers.js';
import { ledgersOf, type LedgerAction } from '@adminium/manifest';

import { ledgerSettings } from '../../crud/ledger-reads.js';
import { planWords, publicLeft, WORDS_IDS_MAX, WordsUnavailable, type WordsLine } from '../../crud/ledger-write.js';
import { venueClock } from '../../crud/venue-time.js';
import type { LedgerRuntime, ResolvedLedger } from '../../ledgers/registry.js';
import { readableKeys, type ReadableQuestion } from './capacity-availability.js';
import type { PublicAvailabilityQuery } from './schema.js';

/** How long a row's public answer is trusted. */
export const WORDS_CACHE_MS = 5_000;
/** The most answers kept at once. */
export const WORDS_CACHE_MAX = 5_000;

/** One row's answer as a customer may hear it today: the state, and how many are left where the owner shows it. */
interface PublicWord {
  state: 'in' | 'low' | 'out';
  left?: number;
}

/** How long an add-on that failed is left alone. */
export const WORDS_REST_MS = 5_000;

/** The public answers of the last five seconds, by connection, words, table and row. Staff answers are never kept here. */
export interface WordsCache {
  get(key: string, now: number): PublicWord | undefined;
  set(key: string, value: PublicWord, now: number): void;
  readonly size: number;
  /** Whether these words failed a moment ago and are being left alone. */
  resting(words: string, now: number): boolean;
  rest(words: string, now: number): void;
  /** One question at a time: a second ask for the same rows while the first is out waits for its answer. */
  once<T>(question: string, run: () => Promise<T>): Promise<T>;
}

export function createWordsCache(max = WORDS_CACHE_MAX, ttl = WORDS_CACHE_MS, restFor = WORDS_REST_MS): WordsCache {
  const kept = new Map<string, { value: PublicWord; until: number }>();
  const resting = new Map<string, number>();
  const asking = new Map<string, Promise<unknown>>();
  return {
    resting(words, now) {
      const until = resting.get(words);
      if (until === undefined) return false;
      if (until > now) return true;
      resting.delete(words);
      return false;
    },
    rest(words, now) {
      // As many words as there are add-ons with words: a handful. Kept small all the same.
      if (resting.size >= 500) resting.clear();
      resting.set(words, now + restFor);
    },
    once<T>(question: string, run: () => Promise<T>): Promise<T> {
      const out = asking.get(question) as Promise<T> | undefined;
      if (out !== undefined) return out;
      const mine = run().finally(() => asking.delete(question));
      asking.set(question, mine);
      return mine;
    },
    get(key, now) {
      const hit = kept.get(key);
      if (hit === undefined) return undefined;
      if (hit.until > now) return hit.value;
      kept.delete(key);
      return undefined;
    },
    set(key, value, now) {
      kept.delete(key);
      if (kept.size >= max) {
        for (const [old, entry] of kept) if (entry.until <= now) kept.delete(old);
        // Still full of live answers: the oldest go first (a Map keeps the order they were put in).
        for (const old of kept.keys()) {
          if (kept.size < max) break;
          kept.delete(old);
        }
      }
      kept.set(key, { value, until: now + ttl });
    },
    get size() {
      return kept.size;
    },
  };
}

export interface WordsQuestion extends ReadableQuestion {
  query: PublicAvailabilityQuery;
  connectionId: string;
  /** The add-on and the words of its the entry is answered by. */
  words: { addOn: string; id: string };
  /** The app whose key this is, or null for a key the owner made: an add-on switched off for that app answers nothing through it. */
  app: string | null;
  /** The entry's own table. */
  table: ResolvedTable;
  /** Absent on a server with no add-on runtime: nothing can answer, and every row reads as in. */
  ledgers: LedgerRuntime | undefined;
  cache: WordsCache;
  rollupsOf: (table: ResolvedTable) => readonly RollupInto[];
  log: Pick<FastifyBaseLogger, 'warn'>;
}

/** Each row asked about that a guest may see, in the order asked — or why the question was not one this entry takes. */
export type WordsAnswer = { ok: true; data: { id: string; state: 'in' | 'low' | 'out'; left?: number }[] } | { ok: false; message: string };

const refused = (message: string): WordsAnswer => ({ ok: false, message });

/** The ids a page asked about: trimmed, each once, in the order asked. */
export function askedIds(under: string | undefined): string[] {
  return under === undefined ? [] : [...new Set(under.split(',').map((value) => value.trim()).filter((value) => value !== ''))];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The longest id asked about: an add-on names a line by it, and a line's name is this long at most. */
const ID_MAX = 64;

/**
 * Whether a typed id could be a value of a key of this type, written the way
 * the database writes it back. A key of any other type (a date, a decimal)
 * is asked about through no id at all: nothing typed is handed to the
 * database to be read as one.
 */
export function couldBeKey(id: string, logicalType: string): boolean {
  if (logicalType === 'integer' || logicalType === 'bigint') {
    if (!/^(0|-?[1-9]\d{0,17})$/.test(id)) return false;
    return logicalType === 'bigint' || Math.abs(Number(id)) <= 2_147_483_647;
  }
  if (logicalType === 'uuid') return UUID.test(id);
  // eslint-disable-next-line no-control-regex -- a control character is in no key
  if (logicalType === 'text' || logicalType === 'varchar') return id.length <= ID_MAX && !/[\u0000-\u001f\u007f]/.test(id);
  return false;
}

/**
 * Whether these words can be asked about rows of this table. Words whose
 * input is a link (an item) are asked of the table that link reads, and of
 * no other: a row of another table with the same id is not that item.
 */
export function wordsFitTable(ledger: ResolvedLedger, action: LedgerAction, input: string, tableId: string): boolean {
  if (action.inputs[input] !== 'link') return true;
  const linked = action.reads.find((read) => read.by.some((by) => by.from === `input.${input}`))?.table;
  return linked !== undefined && ledger.table(linked)?.id === tableId;
}

export async function answerWords(q: WordsQuestion): Promise<WordsAnswer> {
  const named = (Object.keys(q.query) as (keyof PublicAvailabilityQuery)[]).filter((name) => q.query[name] !== undefined);
  if (named.some((name) => name !== 'under' && name !== 'date')) return refused('Ask stock words only for under and date.');
  const asked = askedIds(q.query.under);
  if (asked.length === 0) return refused('Name the rows asked about in under.');
  if (asked.length > WORDS_IDS_MAX) return refused(`At most ${String(WORDS_IDS_MAX)} rows are asked about at once.`);

  // Which of them a guest may see at all: the others are not answered.
  const [key, ...more] = q.table.primaryKey;
  if (key === undefined || more.length > 0) return { ok: true, data: [] };
  // An id that could not be a value of the key is no row: it is never handed to the database.
  const type = q.table.columns.get(key)?.logicalType ?? 'text';
  const possible = asked.filter((id) => couldBeKey(id, type));
  if (possible.length === 0) return { ok: true, data: [] };
  const only: RecordFilter = possible.length === 1 ? { column: key, op: 'eq', value: possible[0]! } : { column: key, op: 'in', value: possible };
  const readable = new Set(await readableKeys(q, q.table, key, only));
  const ids = possible.filter((id) => readable.has(id));
  if (ids.length === 0) return { ok: true, data: [] };

  const at = q.now.getTime();
  // What is installed, as it stands now: an add-on switched off a moment ago answers nothing from here on.
  await q.ledgers?.refresh?.();
  const scope = [q.connectionId, q.words.addOn, q.words.id].join('|');
  const on = q.ledgers !== undefined && (q.app === null || q.app === q.words.addOn || q.ledgers.onFor?.(q.connectionId, q.words.addOn, q.app) === true);
  // Off for this key's app, or failed a moment ago: in for every row, with nobody asked and nothing read from what another key was told.
  if (!on || q.cache.resting(scope, at)) return { ok: true, data: ids.map((id) => ({ id, state: 'in' as const })) };
  const tableRef = q.ledgers?.refOf(q.connectionId, q.table.id) ?? q.table.id;
  const cacheKey = (id: string): string => [q.connectionId, q.words.addOn, q.words.id, tableRef, id].join('|');
  const told = new Map<string, PublicWord>();
  const misses: string[] = [];
  for (const id of ids) {
    const hit = q.cache.get(cacheKey(id), at);
    if (hit === undefined) misses.push(id);
    else told.set(id, hit);
  }

  if (misses.length > 0) {
    const lines = await q.cache.once(`${scope}|${tableRef}|${misses.join(',')}`, () => planned(q, tableRef, misses));
    if (lines === null) {
      // Nothing could answer: in, and not remembered. The add-on is left alone a moment, then asked again.
      for (const id of misses) told.set(id, { state: 'in' });
      q.cache.rest(scope, at);
    } else {
      for (const line of lines) {
        const word: PublicWord = { state: line.state, ...(line.shown === undefined ? {} : { left: line.shown }) };
        told.set(line.id, word);
        q.cache.set(cacheKey(line.id), word, at);
      }
    }
  }

  // A figure is today's: asked about another day, the state alone.
  const today = q.query.date === undefined || q.query.date === venueClock(q.now, q.timezone).day;
  return {
    ok: true,
    data: ids.map((id) => {
      const word: PublicWord = told.get(id) ?? { state: 'in' };
      return { id, state: word.state, ...(today && word.left !== undefined ? { left: word.left } : {}) };
    }),
  };
}

/** The add-on's answer for these rows with what a customer may be shown of each, or null when it cannot answer. */
async function planned(q: WordsQuestion, tableRef: string, keys: readonly string[]): Promise<(WordsLine & { shown?: number })[] | null> {
  const ledgers = q.ledgers;
  if (ledgers === undefined) return null;
  try {
    const manifest = ledgers.manifestOf(q.connectionId, q.words.addOn);
    const declared = (((manifest?.addOn as { words?: unknown } | undefined)?.words ?? []) as { id: string; ledger: string; action: string; input: string; showLeftBelow?: { setting: string } }[]).find((one) => one.id === q.words.id);
    const ledger = declared === undefined ? null : (ledgers.ledgerOf?.(q.view, q.words.addOn, declared.ledger) ?? null);
    const action = declared === undefined || manifest === null ? undefined : ledgersOf(manifest).find((one) => one.id === declared.ledger)?.actions[declared.action];
    if (declared === undefined || ledger === null || action === undefined) throw new WordsUnavailable(`"${q.words.addOn}" has no such words here`);
    if (!wordsFitTable(ledger, action, declared.input, q.table.id)) throw new WordsUnavailable(`the words "${q.words.id}" are not over this entry's table`);
    const lines = await planWords(ledgers, { view: q.view, db: q.db, timezone: q.timezone, addOn: q.words.addOn, words: q.words.id, tableRef, keys, origin: 'public', now: q.now, rollupsOf: q.rollupsOf });
    // The owner's "show how many are left below".
    const settings = declared.showLeftBelow === undefined ? {} : await ledgerSettings(ledger, q.db);
    return lines.map((line) => {
      const shown = publicLeft(settings, declared, line.left, line.state);
      return shown === undefined ? line : { ...line, shown: Number(shown) };
    });
  } catch (error) {
    // Whatever stopped it — the add-on off, its code failing, one of its tables gone — the rows are a guest's to see and are told as in.
    q.log.warn({ addOn: q.words.addOn, words: q.words.id, reason: error instanceof Error ? error.message : String(error) }, 'stock words could not be answered: every row asked about reads as in');
    return null;
  }
}
