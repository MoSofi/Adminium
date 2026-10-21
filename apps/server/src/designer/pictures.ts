// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free pictures for an app's pages and sample rows.
 *
 * A page about food, rooms or people needs pictures of them, and a page may
 * show nothing from another site unless the person allowed that site. So the
 * person searches a source of free pictures in the picture dialog, one
 * source at a time, picks one for a spot, and the server copies it into the
 * app with its credit kept beside it.
 *
 * The sources: Openverse (no key; pictures free to use and to change, for
 * any purpose), Pexels when the project's `.env` has `PEXELS_API_KEY`, and
 * Unsplash with `UNSPLASH_ACCESS_KEY`, whose rules ask that a picture be
 * shown from Unsplash's own address and never copied: such a picture is
 * given to the page as an address, its site is allowed once the person
 * chose one, and Unsplash is told it was chosen. Pixabay with
 * `PIXABAY_API_KEY`, whose rules ask the opposite: its addresses only for
 * showing results for a while, a chosen picture copied, and a search's
 * answer kept for a day and given again rather than asked again.
 *
 * Every address a source answers with is fetched through the fetch that
 * checks and pins the address it calls, with a size limit, and a file is
 * kept only when its first bytes say it is a picture. A result's licence is
 * read from the source's own code (`licences.ts`): one it does not know is
 * dropped, never shown as a known one.
 *
 * A search's results are kept per session, in pages ("shelves"): a picture
 * is named to the page by an id of this server's, and its addresses never
 * leave the server. A page of results is kept for half an hour after it was
 * last used, a session keeps a dozen of them, and a picture the person put
 * in "what changes" is pinned: it outlives its page.
 */
import { randomBytes } from 'node:crypto';

import { safeFetch, type SafeFetchOptions } from '../net/safe-fetch.js';
import { plainLine } from '../project/apps/design-skills.js';
import { imageTypeOf } from './attachments.js';
import { searchLicence, type LicenceCode } from './licences.js';

export const PICTURE_SHAPES = ['wide', 'tall', 'square'] as const;
export type PictureShape = (typeof PICTURE_SHAPES)[number];

/** The most of a picture a spot takes: an attachment's own cap. A larger original falls back to a small copy, and the person is told. */
export const PICTURE_MAX_BYTES = 5 * 1024 * 1024;
export const THUMB_MAX_BYTES = 512 * 1024;
/** How many pictures one page of a search shows. */
export const PICTURES_PER_PAGE = 20;
/** The pages a search may go on to with "More". */
export const PICTURE_PAGES_MAX = 10;

export const SOURCE_NAMES = ['Openverse', 'Pexels', 'Unsplash', 'Pixabay'] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export interface FoundPicture {
  /** Ours, not the source's: what the page and an answer name it by. */
  id: string;
  /** A small copy, to show as a tile. */
  thumb: string;
  /** The files to try for the app, the best first: a full one, then the small copy. */
  files: string[];
  title: string;
  creator: string;
  creatorUrl: string;
  /** The licence's own name: "CC BY 2.0", "Pexels licence". */
  licence: string;
  /** The source's code for it, which decides its badge. */
  licenceCode: LicenceCode;
  licenceUrl: string;
  /** "Openverse", "Pexels", "Unsplash", "Pixabay". */
  source: string;
  /** The picture's own page. */
  page: string;
  /** For a picture that may not be copied: the address a page shows it from. `files` is then empty. */
  shown?: string;
  /** The source's address to call when the picture is chosen, where its rules ask for that. Never leaves the server. */
  chosenUrl?: string;
}

/** What a source's answer said of the calls left, read from its headers; null where it did not say. */
export interface RateSeen {
  remaining: number | null;
  /** When the count starts again, epoch ms. */
  resetAt: number | null;
  /** How many calls the source gives in its window. */
  limit: number | null;
}

/** One page of a search. */
export interface SearchPage {
  pictures: FoundPicture[];
  /** Whether the source has another page. */
  more: boolean;
  rate?: RateSeen;
}

export interface PictureSource {
  name: SourceName;
  search(words: string, opts: { count: number; shape?: PictureShape; page?: number; signal?: AbortSignal }): Promise<SearchPage>;
  /** The one site its pictures are shown from, for a source whose pictures are not copied. */
  showsFrom?: string;
  /**
   * How long a search's answer is kept and given again instead of asking
   * the source again, for a source whose rules ask for that (Pixabay: a day).
   */
  keepsFor?: number;
  /** Tell the source a picture of its was chosen. Never throws: a picture is not lost for a count. */
  chosen?(picture: FoundPicture, signal?: AbortSignal): Promise<void>;
}

type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<{ body: Buffer; contentType: string; headers?: Readonly<Record<string, string>> }>;

/** A new id of ours for a picture: an answer given again gets new ones, so no two pages share one. */
export const newPictureId = (): string => `pic_${randomBytes(6).toString('hex')}`;
const id = newPictureId;
const text = (value: unknown, max: number): string => (typeof value === 'string' ? plainLine(value, max) : '');
const https = (value: unknown): string => (typeof value === 'string' && /^https:\/\/[^\s"'<>]{1,1000}$/.test(value) ? value : '');
const pageOf = (page: number | undefined): number => (page !== undefined && Number.isInteger(page) && page >= 1 && page <= PICTURE_PAGES_MAX ? page : 1);

/**
 * What a source's headers say of its calls left. Each source names them its
 * own way (`x-ratelimit-remaining`, Openverse's `x-ratelimit-remaining-anon_burst`);
 * the smallest count left is the one that binds.
 */
export function rateOf(headers: Readonly<Record<string, string>> | undefined, now: number = Date.now()): RateSeen {
  const numbers = (prefix: string): number[] =>
    Object.entries(headers ?? {})
      .filter(([name]) => name.startsWith(prefix))
      .map(([, value]) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0);
  const remaining = numbers('x-ratelimit-remaining');
  const limit = numbers('x-ratelimit-limit');
  const reset = numbers('x-ratelimit-reset')[0];
  return {
    remaining: remaining.length === 0 ? null : Math.min(...remaining),
    limit: limit.length === 0 ? null : Math.min(...limit),
    // A reset is a moment (Pexels: seconds since 1970) or a wait in seconds.
    resetAt: reset === undefined ? null : reset > 1e9 ? reset * 1000 : now + reset * 1000,
  };
}

/** Openverse: pictures under licences that allow use and change for any purpose. No key. */
export function openverse(fetcher: Fetcher = safeFetch): PictureSource {
  return {
    name: 'Openverse',
    async search(words, opts) {
      const page = pageOf(opts.page);
      const query = new URLSearchParams({ q: words, license_type: 'commercial,modification', mature: 'false', page_size: String(Math.min(PICTURES_PER_PAGE, opts.count)), page: String(page) });
      if (opts.shape !== undefined) query.set('aspect_ratio', opts.shape);
      const reply = await fetcher(`https://api.openverse.org/v1/images/?${query.toString()}`, { maxBytes: 512 * 1024, timeoutMs: 12_000, headers: { accept: 'application/json' }, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      const answer = JSON.parse(reply.body.toString('utf8')) as { results?: unknown; page_count?: unknown };
      const results = answer.results;
      if (!Array.isArray(results)) return { pictures: [], more: false, rate: rateOf(reply.headers) };
      const pictures = results.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const thumb = https(row['thumbnail']);
        const file = https(row['url']);
        // Only the small copy Openverse itself serves is shown as a tile: its address is on one known host.
        if (thumb === '' || !thumb.startsWith('https://api.openverse.org/')) return [];
        // By the source's own code: a licence this server does not know is never shown as one it does.
        const licence = searchLicence('Openverse', row['license'], row['license_version']);
        if (licence === null) return [];
        return [
          {
            id: id(),
            thumb,
            files: [...(file === '' ? [] : [file]), thumb],
            title: text(row['title'], 120) || 'Untitled',
            creator: text(row['creator'], 80) || 'Unknown',
            creatorUrl: https(row['creator_url']),
            licence: licence.name,
            licenceCode: licence.code,
            licenceUrl: https(row['license_url']),
            source: 'Openverse',
            page: https(row['foreign_landing_url']),
          },
        ];
      });
      const pages = typeof answer.page_count === 'number' ? answer.page_count : 0;
      return { pictures, more: page < Math.min(pages, PICTURE_PAGES_MAX), rate: rateOf(reply.headers) };
    },
  };
}

/** Pexels, with the project's own key. */
export function pexels(key: string, fetcher: Fetcher = safeFetch): PictureSource {
  return {
    name: 'Pexels',
    async search(words, opts) {
      const page = pageOf(opts.page);
      const query = new URLSearchParams({ query: words, per_page: String(Math.min(PICTURES_PER_PAGE, opts.count)), page: String(page) });
      if (opts.shape !== undefined) query.set('orientation', opts.shape === 'wide' ? 'landscape' : opts.shape === 'tall' ? 'portrait' : 'square');
      const reply = await fetcher(`https://api.pexels.com/v1/search?${query.toString()}`, {
        maxBytes: 512 * 1024,
        timeoutMs: 12_000,
        headers: { accept: 'application/json', authorization: key },
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      const answer = JSON.parse(reply.body.toString('utf8')) as { photos?: unknown; next_page?: unknown };
      const photos = answer.photos;
      if (!Array.isArray(photos)) return { pictures: [], more: false, rate: rateOf(reply.headers) };
      const pictures = photos.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const src = (row['src'] ?? {}) as Record<string, unknown>;
        const thumb = https(src['medium']);
        if (thumb === '' || !thumb.startsWith('https://images.pexels.com/')) return [];
        return [
          {
            id: id(),
            thumb,
            files: [https(src['large2x']) || https(src['large']), thumb].filter((url) => url !== ''),
            title: text(row['alt'], 120) || 'Untitled',
            creator: text(row['photographer'], 80) || 'Unknown',
            creatorUrl: https(row['photographer_url']),
            licence: 'Pexels licence',
            licenceCode: 'pexels',
            licenceUrl: 'https://www.pexels.com/license/',
            source: 'Pexels',
            page: https(row['url']),
          },
        ];
      });
      return { pictures, more: typeof answer.next_page === 'string' && page < PICTURE_PAGES_MAX, rate: rateOf(reply.headers) };
    },
  };
}

/** The one host Unsplash's pictures are shown from. */
export const UNSPLASH_HOST = 'images.unsplash.com';

/**
 * Unsplash, with the project's own key. Its pictures are shown from
 * Unsplash's address, as its rules ask, and never copied into the app.
 */
export function unsplash(key: string, fetcher: Fetcher = safeFetch): PictureSource {
  const headers = { accept: 'application/json', authorization: `Client-ID ${key}`, 'accept-version': 'v1' };
  const own = (value: unknown): string => {
    const url = https(value);
    return url.startsWith(`https://${UNSPLASH_HOST}/`) ? url : '';
  };
  return {
    name: 'Unsplash',
    showsFrom: UNSPLASH_HOST,
    async search(words, opts) {
      const page = pageOf(opts.page);
      const query = new URLSearchParams({ query: words, per_page: String(Math.min(PICTURES_PER_PAGE, opts.count)), page: String(page), content_filter: 'high' });
      if (opts.shape !== undefined) query.set('orientation', opts.shape === 'wide' ? 'landscape' : opts.shape === 'tall' ? 'portrait' : 'squarish');
      const reply = await fetcher(`https://api.unsplash.com/search/photos?${query.toString()}`, { maxBytes: 768 * 1024, timeoutMs: 12_000, headers, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      const answer = JSON.parse(reply.body.toString('utf8')) as { results?: unknown; total_pages?: unknown };
      const results = answer.results;
      if (!Array.isArray(results)) return { pictures: [], more: false, rate: rateOf(reply.headers) };
      const pictures = results.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const urls = (row['urls'] ?? {}) as Record<string, unknown>;
        const links = (row['links'] ?? {}) as Record<string, unknown>;
        const user = (row['user'] ?? {}) as Record<string, unknown>;
        const thumb = own(urls['small']);
        const shown = own(urls['regular']);
        // Only a picture on Unsplash's own picture host: that is the one site the page is let load pictures from for it.
        if (thumb === '' || shown === '') return [];
        const chosenUrl = https(links['download_location']);
        return [
          {
            id: id(),
            thumb,
            files: [],
            shown,
            ...(chosenUrl.startsWith('https://api.unsplash.com/') ? { chosenUrl } : {}),
            title: text(row['alt_description'], 120) || text(row['description'], 120) || 'Untitled',
            creator: text(user['name'], 80) || 'Unknown',
            creatorUrl: https(((user['links'] ?? {}) as Record<string, unknown>)['html']),
            licence: 'Unsplash licence',
            licenceCode: 'unsplash',
            licenceUrl: 'https://unsplash.com/license',
            source: 'Unsplash',
            page: https(links['html']),
          },
        ];
      });
      const pages = typeof answer.total_pages === 'number' ? answer.total_pages : 0;
      return { pictures, more: page < Math.min(pages, PICTURE_PAGES_MAX), rate: rateOf(reply.headers) };
    },
    async chosen(picture, signal) {
      if (picture.chosenUrl === undefined) return;
      try {
        await fetcher(picture.chosenUrl, { maxBytes: 64 * 1024, timeoutMs: 8000, headers, ...(signal === undefined ? {} : { signal }) });
      } catch {
        // Unsplash's count of uses, not the picture: the page shows it either way.
      }
    },
  };
}

/** Pixabay's own pages and the hosts its pictures are on. */
const PIXABAY_HOSTS = ['https://pixabay.com/', 'https://cdn.pixabay.com/'] as const;
/** How long Pixabay's rules ask that a search's answer be kept: a day. */
export const PIXABAY_KEEPS_FOR_MS = 24 * 60 * 60_000;
/** The most results Pixabay gives for one search. */
const PIXABAY_HITS_MAX = 500;

/**
 * Pixabay, with the project's own key. Its rules: an address it answers with
 * is for showing a search's results for a while, never to show a picture
 * from for good, so a chosen picture is copied into the app (its full
 * address lasts a day); a search's answer is kept for a day (`keepsFor`);
 * and the dialog says where its results come from. Its key goes in the
 * address, as its API asks: the address is never logged or shown.
 */
export function pixabay(key: string, fetcher: Fetcher = safeFetch): PictureSource {
  return {
    name: 'Pixabay',
    keepsFor: PIXABAY_KEEPS_FOR_MS,
    async search(words, opts) {
      const page = pageOf(opts.page);
      // Pixabay gives no fewer than 3 a page.
      const perPage = Math.max(3, Math.min(PICTURES_PER_PAGE, opts.count));
      const query = new URLSearchParams({ key, q: words.slice(0, 100), image_type: 'photo', safesearch: 'true', per_page: String(perPage), page: String(page) });
      // It knows no square: a square spot is shown any shape, cut to fit.
      if (opts.shape === 'wide' || opts.shape === 'tall') query.set('orientation', opts.shape === 'wide' ? 'horizontal' : 'vertical');
      const reply = await fetcher(`https://pixabay.com/api/?${query.toString()}`, { maxBytes: 512 * 1024, timeoutMs: 12_000, headers: { accept: 'application/json' }, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      const answer = JSON.parse(reply.body.toString('utf8')) as { hits?: unknown; totalHits?: unknown };
      const hits = answer.hits;
      if (!Array.isArray(hits)) return { pictures: [], more: false, rate: rateOf(reply.headers) };
      const pictures = hits.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const own = (value: unknown): string => {
          const url = https(value);
          return PIXABAY_HOSTS.some((host) => url.startsWith(host)) ? url : '';
        };
        const thumb = own(row['webformatURL']);
        if (thumb === '') return [];
        const user = text(row['user'], 80);
        const userId = row['user_id'];
        return [
          {
            id: id(),
            thumb,
            files: [own(row['largeImageURL']), thumb].filter((url) => url !== ''),
            // It has no title: its tags say what is in it.
            title: text(row['tags'], 120) || 'Untitled',
            creator: user || 'Unknown',
            creatorUrl: user !== '' && /^[\w.-]{1,80}$/.test(user) && Number.isSafeInteger(userId) ? `https://pixabay.com/users/${user}-${String(userId)}/` : '',
            licence: 'Pixabay Content License',
            licenceCode: 'pixabay',
            licenceUrl: 'https://pixabay.com/service/license-summary/',
            source: 'Pixabay',
            page: own(row['pageURL']),
          },
        ];
      });
      const total = typeof answer.totalHits === 'number' ? Math.min(answer.totalHits, PIXABAY_HITS_MAX) : 0;
      return { pictures, more: page * perPage < total && page < PICTURE_PAGES_MAX, rate: rateOf(reply.headers) };
    },
  };
}

const EXT: Readonly<Record<string, 'jpg' | 'png' | 'webp' | 'gif'>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * A picture's bytes for the app: the first of its files that is a picture
 * and fits. `small` says it is the small copy, because the original was too
 * large or gone: the person is told. Null when none is.
 */
export async function downloadPicture(
  picture: FoundPicture,
  opts: { fetcher?: Fetcher; signal?: AbortSignal; maxBytes?: number } = {},
): Promise<{ bytes: Buffer; ext: 'jpg' | 'png' | 'webp' | 'gif'; small: boolean } | null> {
  const fetcher = opts.fetcher ?? safeFetch;
  for (const [index, url] of picture.files.entries()) {
    try {
      const reply = await fetcher(url, { maxBytes: opts.maxBytes ?? PICTURE_MAX_BYTES, timeoutMs: 20_000, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      // By what the bytes are, whatever the address or the answer called them.
      const type = imageTypeOf(reply.body);
      if (type !== null) return { bytes: reply.body, ext: EXT[type] ?? 'jpg', small: picture.files.length > 1 && index === picture.files.length - 1 && url === picture.thumb };
    } catch {
      // Too large, gone, or not to be called: the next file of this picture, if it has one.
    }
  }
  return null;
}

/** One line of an app's `assets/pictures/CREDITS.json`: a picture's file (as screens and `spots.json` name it) and who made it. */
export interface PictureCredit {
  /** Relative to the app (`assets/pictures/hero-1.jpg`), or the address a picture is shown from. */
  file: string;
  title: string;
  creator: string;
  creatorUrl: string;
  licence: string;
  licenceUrl: string;
  source: string;
  page: string;
  /** The licence's code, for its badge; absent on a line written before badges. */
  licenceCode?: LicenceCode;
}

export const creditOf = (picture: FoundPicture, file: string): PictureCredit => ({
  file,
  title: picture.title,
  creator: picture.creator,
  creatorUrl: picture.creatorUrl,
  licence: picture.licence,
  licenceUrl: picture.licenceUrl,
  source: picture.source,
  page: picture.page,
  licenceCode: picture.licenceCode,
});

/**
 * The pictures a session's searches found, kept while the server runs: the
 * page names a picture by an id of ours, and its address never leaves the
 * server. Each session keeps its own pages of results ("shelves"): a page is
 * dropped half an hour after it was last used, or when the session has more
 * than it keeps; a picture the person pinned outlives its page.
 */
export interface PictureShelf {
  /** A new page of results, for one session. */
  put(sessionId: string, pictures: readonly FoundPicture[]): string;
  /** More results on a page that is there; false when it is gone. */
  add(sessionId: string, shelf: string, pictures: readonly FoundPicture[]): boolean;
  /** A picture on a page of the session's, or pinned by it. */
  find(sessionId: string, shelf: string, picture: string): FoundPicture | null;
  /** Keep a picture the person chose for as long as the session is used, whatever becomes of its page. Null when it is gone. */
  pin(sessionId: string, shelf: string, picture: string): FoundPicture | null;
  /** A picture's small copy, fetched once and kept with it. */
  thumb(sessionId: string, shelf: string, picture: string): Promise<{ bytes: Buffer; mime: string } | null>;
  drop(shelf: string): void;
}

interface Kept {
  picture: FoundPicture;
  thumb?: Promise<{ bytes: Buffer; mime: string } | null>;
}

interface SessionShelves {
  shelves: Map<string, { pictures: Map<string, Kept>; used: number }>;
  pins: Map<string, Kept>;
  used: number;
}

export function createPictureShelf(
  opts: {
    fetcher?: Fetcher;
    /** The pages a session keeps. */
    max?: number;
    /** How long a page is kept after its last use. */
    idleMs?: number;
    /** The sessions kept at once: the one used least lately goes first. */
    sessions?: number;
    now?: () => number;
    /** Whether a small copy may be fetched now (a source counts them): false serves none. */
    mayFetch?: (picture: FoundPicture) => boolean;
  } = {},
): PictureShelf {
  const fetcher = opts.fetcher ?? safeFetch;
  const now = opts.now ?? (() => Date.now());
  const idle = opts.idleMs ?? 30 * 60_000;
  const max = opts.max ?? 12;
  const sessions = new Map<string, SessionShelves>();
  const owner = new Map<string, string>();

  /** The session's shelves, with what was not used for too long let go. */
  const held = (sessionId: string, make: boolean): SessionShelves | null => {
    const at = now();
    for (const [key, entry] of sessions) {
      if (at - entry.used <= idle) continue;
      for (const shelf of entry.shelves.keys()) owner.delete(shelf);
      sessions.delete(key);
    }
    let entry = sessions.get(sessionId) ?? null;
    if (entry === null && make) {
      entry = { shelves: new Map(), pins: new Map(), used: at };
      sessions.set(sessionId, entry);
      while (sessions.size > (opts.sessions ?? 200)) {
        const [oldest, gone] = [...sessions.entries()].sort((a, b) => a[1].used - b[1].used)[0] as [string, SessionShelves];
        for (const shelf of gone.shelves.keys()) owner.delete(shelf);
        sessions.delete(oldest);
      }
    }
    if (entry === null) return null;
    entry.used = at;
    for (const [key, shelf] of entry.shelves) {
      if (at - shelf.used > idle) {
        entry.shelves.delete(key);
        owner.delete(key);
      }
    }
    return entry;
  };
  const kept = (sessionId: string, shelf: string, picture: string): Kept | null => {
    const entry = held(sessionId, false);
    if (entry === null) return null;
    const page = entry.shelves.get(shelf);
    if (page !== undefined) {
      page.used = now();
      const found = page.pictures.get(picture);
      if (found !== undefined) return found;
    }
    return entry.pins.get(`${shelf}:${picture}`) ?? null;
  };
  return {
    put(sessionId, pictures) {
      const entry = held(sessionId, true) as SessionShelves;
      const key = `shelf_${randomBytes(8).toString('hex')}`;
      entry.shelves.set(key, { pictures: new Map(pictures.map((picture) => [picture.id, { picture }])), used: now() });
      owner.set(key, sessionId);
      // The oldest go first: a page nobody went back to does not keep its pictures for ever. A pin stays.
      while (entry.shelves.size > max) {
        const oldest = entry.shelves.keys().next().value as string;
        entry.shelves.delete(oldest);
        owner.delete(oldest);
      }
      return key;
    },
    add(sessionId, shelf, pictures) {
      const page = held(sessionId, false)?.shelves.get(shelf);
      if (page === undefined) return false;
      for (const picture of pictures) page.pictures.set(picture.id, { picture });
      page.used = now();
      return true;
    },
    find: (sessionId, shelf, picture) => kept(sessionId, shelf, picture)?.picture ?? null,
    pin(sessionId, shelf, picture) {
      const found = kept(sessionId, shelf, picture);
      const entry = held(sessionId, false);
      if (found === null || entry === null) return null;
      entry.pins.set(`${shelf}:${picture}`, found);
      return found.picture;
    },
    thumb(sessionId, shelf, picture) {
      const found = kept(sessionId, shelf, picture);
      if (found === null) return Promise.resolve(null);
      if (found.thumb === undefined) {
        if (opts.mayFetch !== undefined && !opts.mayFetch(found.picture)) return Promise.resolve(null);
        found.thumb = fetcher(found.picture.thumb, { maxBytes: THUMB_MAX_BYTES, timeoutMs: 12_000 })
          .then((reply) => {
            const type = imageTypeOf(reply.body);
            return type === null ? null : { bytes: reply.body, mime: type };
          })
          .catch(() => null);
      }
      return found.thumb;
    },
    drop(shelf) {
      const sessionId = owner.get(shelf);
      if (sessionId === undefined) return;
      sessions.get(sessionId)?.shelves.delete(shelf);
      owner.delete(shelf);
    },
  };
}
