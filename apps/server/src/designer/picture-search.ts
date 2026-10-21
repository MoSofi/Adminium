// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Searching the free-picture sources from the picture dialog, within what
 * each source gives this server.
 *
 * A source's limit belongs to the server's key (or, with no key, to the
 * server's address), not to a session: two people paging at once spend one
 * allowance. So each source has one budget per server, a token bucket for
 * each window its documents state, and each session has its own small limit
 * on top. A source that answers 429, or whose budget is spent, is paused on
 * its own: the dialog says "{source} is busy. Try again in {minutes}
 * minutes." and the other sources keep working.
 *
 * The windows, as each source documents them (read 2026-10-19):
 *  - Openverse, no key: 20 searches a minute and 200 a day; its small copies
 *    are a bucket of their own, 1,000 a day;
 *  - Pexels: 200 an hour and 20,000 a month; its small copies are on a
 *    picture host it does not say it counts;
 *  - Unsplash: 50 an hour for a new key, 1,000 once Unsplash approves it.
 *    Its own headers say which, and the budget follows them. Its pictures'
 *    host is not counted; the "chosen" report is.
 * A source's own headers (`x-ratelimit-remaining`) narrow a budget further,
 * never widen what was spent.
 */
import { SafeFetchError } from '../net/safe-fetch.js';
import { PICTURES_PER_PAGE, type FoundPicture, type PictureShape, type PictureShelf, type PictureSource, type RateSeen, type SourceName } from './pictures.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface BudgetWindow {
  size: number;
  ms: number;
}

/** Each source's windows, from its own documents. */
export const SOURCE_WINDOWS: Readonly<Record<SourceName, { search: readonly BudgetWindow[]; thumbs: readonly BudgetWindow[] }>> = {
  Openverse: { search: [{ size: 20, ms: MINUTE }, { size: 200, ms: DAY }], thumbs: [{ size: 1000, ms: DAY }] },
  Pexels: { search: [{ size: 200, ms: HOUR }, { size: 20_000, ms: 30 * DAY }], thumbs: [] },
  Unsplash: { search: [{ size: 50, ms: HOUR }], thumbs: [] },
};

/** How long a source that said 429 with no time to wait is left alone. */
export const PAUSE_WITHOUT_WORD_MS = 15 * MINUTE;
/** A session's own searches a minute, across sources. */
export const SESSION_SEARCHES_PER_MINUTE = 30;
/** How many times a first page with nothing is asked again with one word fewer. */
export const FEWER_WORDS_TRIES = 2;

/** One source's budget on this server. */
export interface SourceBudget {
  /** Take one call of this kind; the moment the source may be called again when there is none to take. */
  take(kind: 'search' | 'thumb'): { ok: true } | { ok: false; until: number };
  /** What the source's own answer said of its calls left. */
  seen(rate: RateSeen | undefined): void;
  /** The source answered 429: left alone until then. */
  pause(until: number): void;
  /** When the source may be called again, while it is paused. */
  pausedUntil(): number | null;
}

interface Bucket {
  window: BudgetWindow;
  tokens: number;
  at: number;
}

export function createSourceBudget(windows: { search: readonly BudgetWindow[]; thumbs: readonly BudgetWindow[] }, now: () => number = () => Date.now()): SourceBudget {
  const start = now();
  const buckets = {
    search: windows.search.map((window): Bucket => ({ window: { ...window }, tokens: window.size, at: start })),
    thumb: windows.thumbs.map((window): Bucket => ({ window: { ...window }, tokens: window.size, at: start })),
  };
  let paused: number | null = null;
  const refill = (bucket: Bucket, at: number): void => {
    bucket.tokens = Math.min(bucket.window.size, bucket.tokens + ((at - bucket.at) * bucket.window.size) / bucket.window.ms);
    bucket.at = at;
  };
  return {
    take(kind) {
      const at = now();
      if (paused !== null && at < paused) return { ok: false, until: paused };
      paused = null;
      const list = buckets[kind];
      for (const bucket of list) refill(bucket, at);
      const short = list.filter((bucket) => bucket.tokens < 1);
      if (short.length > 0) {
        // The moment the slowest of them has one call again.
        const until = Math.max(...short.map((bucket) => at + Math.ceil(((1 - bucket.tokens) * bucket.window.ms) / bucket.window.size)));
        return { ok: false, until };
      }
      for (const bucket of list) bucket.tokens -= 1;
      return { ok: true };
    },
    seen(rate) {
      if (rate === undefined) return;
      const first = buckets.search[0];
      // A key Unsplash approved gives more an hour than a new one: its own word is taken, for the window it counts in.
      if (first !== undefined && rate.limit !== null && rate.limit > first.window.size && rate.limit <= first.window.size * 100) first.window.size = rate.limit;
      if (first !== undefined && rate.remaining !== null) first.tokens = Math.min(first.tokens, rate.remaining);
      if (rate.remaining === 0) paused = rate.resetAt ?? now() + PAUSE_WITHOUT_WORD_MS;
    },
    pause(until) {
      paused = Math.max(paused ?? 0, until);
    },
    pausedUntil() {
      return paused !== null && now() < paused ? paused : null;
    },
  };
}

/** When a 429 says to come back: its `retry-after` (seconds or a date), else a quarter of an hour. */
export function retryAt(headers: Readonly<Record<string, string>> | undefined, now: number): number {
  const said = headers?.['retry-after'];
  if (said !== undefined) {
    const seconds = Number(said);
    if (Number.isFinite(seconds) && seconds >= 0) return now + Math.min(seconds, 86_400) * 1000;
    const date = Date.parse(said);
    if (Number.isFinite(date) && date > now) return Math.min(date, now + DAY);
  }
  return now + PAUSE_WITHOUT_WORD_MS;
}

/** A picture as the page is given it: no address of the source's but its own page's, which the person may open. */
export interface PublicPicture {
  id: string;
  title: string;
  creator: string;
  source: string;
  licence: { code: FoundPicture['licenceCode']; name: string };
  /** The picture's own page, to check its licence there. */
  page: string;
  /** Shown from the source's own site, never copied (Unsplash). */
  shown?: true;
}

export const publicPicture = (picture: FoundPicture): PublicPicture => ({
  id: picture.id,
  title: picture.title,
  creator: picture.creator,
  source: picture.source,
  licence: { code: picture.licenceCode, name: picture.licence },
  page: picture.page,
  ...(picture.shown === undefined ? {} : { shown: true as const }),
});

export type SearchAnswer =
  /** `q`: the fewer words that found these, when the words asked for found none. */
  | { state: 'ok'; shelf: string; pictures: PublicPicture[]; more: boolean; page: number; q?: string }
  /** The source is paused: its own limit, or this server's share of it, is spent until then. */
  | { state: 'busy'; source: SourceName; minutes: number }
  /** The source turned down this server's key for it (a wrong key, or one taken back): the dialog asks for another. */
  | { state: 'refused'; source: SourceName }
  /** The source is not on this server (no key, or the server calls nothing outside). */
  | { state: 'off' }
  /** The source could not be asked, or its answer did not read. */
  | { state: 'failed' };

export interface PictureSearch {
  /** The sources this server can search now, in the dialog's order, each with the minutes it is paused for. */
  sources(): { name: SourceName; busy: number | null }[];
  search(sessionId: string, input: { q: string; source: string; shape?: PictureShape; page?: number; shelf?: string }, signal?: AbortSignal): Promise<SearchAnswer>;
  /** May the small copy of a source's picture be fetched now: its own bucket, for a source that counts them. */
  mayFetchThumb(picture: FoundPicture): boolean;
  /** The source of this name, for an Apply to tell it a picture was chosen. */
  source(name: string): PictureSource | null;
}

/**
 * A source saying no to the key itself: 401, or a 403 that is not its limit spent (Unsplash answers a spent hour with a
 * 403 and `x-ratelimit-remaining: 0`, which is a wait, not a wrong key). Openverse is asked with no key: its no is
 * a failure like any other.
 */
const refusedKey = (error: SafeFetchError): boolean => error.status === 401 || (error.status === 403 && error.headers?.['x-ratelimit-remaining'] !== '0');

export function createPictureSearch(deps: {
  /** The sources this server has now: none where it calls nothing outside. */
  sources: () => PictureSource[];
  shelf: PictureShelf;
  now?: () => number;
}): PictureSearch {
  const now = deps.now ?? (() => Date.now());
  const budgets = new Map<string, SourceBudget>();
  const budget = (name: SourceName): SourceBudget => {
    let found = budgets.get(name);
    if (found === undefined) {
      found = createSourceBudget(SOURCE_WINDOWS[name], now);
      budgets.set(name, found);
    }
    return found;
  };
  const asked = new Map<string, number[]>();
  const minutes = (until: number): number => Math.max(1, Math.ceil((until - now()) / MINUTE));
  return {
    sources: () => deps.sources().map((source) => ({ name: source.name, busy: ((until) => (until === null ? null : minutes(until)))(budget(source.name).pausedUntil()) })),
    source: (name) => deps.sources().find((source) => source.name === name) ?? null,
    mayFetchThumb: (picture) => {
      const name = (SOURCE_WINDOWS as Record<string, unknown>)[picture.source] === undefined ? null : (picture.source as SourceName);
      return name === null || SOURCE_WINDOWS[name].thumbs.length === 0 || budget(name).take('thumb').ok;
    },
    async search(sessionId, input, signal) {
      const source = deps.sources().find((candidate) => candidate.name === input.source);
      if (source === undefined) return { state: 'off' };
      const words = input.q.replace(/\s+/g, ' ').trim().slice(0, 100);
      if (words === '') return { state: 'ok', shelf: '', pictures: [], more: false, page: 1 };
      // The session's own share first: a person paging fast does not spend everyone's allowance.
      const at = now();
      const recent = (asked.get(sessionId) ?? []).filter((when) => at - when < MINUTE);
      if (recent.length >= SESSION_SEARCHES_PER_MINUTE) return { state: 'busy', source: source.name, minutes: minutes((recent[0] as number) + MINUTE) };
      const took = budget(source.name).take('search');
      if (!took.ok) return { state: 'busy', source: source.name, minutes: minutes(took.until) };
      asked.set(sessionId, [...recent, at]);
      const page = input.page ?? 1;
      const ask = async (q: string): Promise<Awaited<ReturnType<PictureSource['search']>> | SearchAnswer> => {
        try {
          const answer = await source.search(q, { count: PICTURES_PER_PAGE, ...(input.shape === undefined ? {} : { shape: input.shape }), page, ...(signal === undefined ? {} : { signal }) });
          budget(source.name).seen(answer.rate);
          return answer;
        } catch (error) {
          if (error instanceof SafeFetchError && error.status === 429) {
            const until = retryAt(error.headers, now());
            budget(source.name).pause(until);
            return { state: 'busy', source: source.name, minutes: minutes(until) };
          }
          if (error instanceof SafeFetchError && source.name !== 'Openverse' && refusedKey(error)) return { state: 'refused', source: source.name };
          return { state: 'failed' };
        }
      };
      let used = words;
      let found = await ask(used);
      if ('state' in found) return found;
      /*
       * A source matches every word, so a spot's long description ("homemade cake bakery counter") can find
       * nothing where its first words find plenty. A first page with none is asked again without its last word,
       * down to two words and at most twice, each a search of the allowance like any other.
       */
      for (let tries = 0; found.pictures.length === 0 && page === 1 && tries < FEWER_WORDS_TRIES; tries += 1) {
        const fewer = used.split(' ').slice(0, -1);
        if (fewer.length < 2 || !budget(source.name).take('search').ok) break;
        const again = await ask(fewer.join(' '));
        if ('state' in again) break;
        used = fewer.join(' ');
        found = again;
      }
      // "More" adds to the page of results it came from; a page that is gone starts a new one.
      const shelf = input.shelf !== undefined && deps.shelf.add(sessionId, input.shelf, found.pictures) ? input.shelf : deps.shelf.put(sessionId, found.pictures);
      return { state: 'ok', shelf, pictures: found.pictures.map(publicPicture), more: found.more, page, ...(used === words || found.pictures.length === 0 ? {} : { q: used }) };
    },
  };
}
