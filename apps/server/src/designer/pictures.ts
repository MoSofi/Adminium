// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Free pictures for an app's pages and sample rows.
 *
 * A page about food, rooms or people needs pictures of them, and a page may
 * show nothing from another site unless the person allowed that site. So the
 * Designer searches a source of free pictures, the person ticks the ones to
 * use on a card, and the server copies those into the app, each with its
 * credit kept beside it.
 *
 * The source is Openverse (no key; pictures free to use and to change, for
 * any purpose), or Pexels when the project's `.env` has `PEXELS_API_KEY`.
 * With `UNSPLASH_ACCESS_KEY`, pictures for a page come from Unsplash, whose
 * rules ask that a picture be shown from Unsplash's own address and never
 * copied: such a picture is given to the page as an address, its site is
 * allowed with the person's yes on the same card, and Unsplash is told it
 * was chosen.
 * Every address a source answers with is fetched through the fetch that
 * checks and pins the address it calls, with a size limit, and a file is
 * kept only when its first bytes say it is a picture.
 */
import { randomBytes } from 'node:crypto';

import { pictureTypeOf, safeFetch, type SafeFetchOptions } from '../net/safe-fetch.js';
import { plainLine } from '../project/apps/design-skills.js';

export const PICTURE_SHAPES = ['wide', 'tall', 'square'] as const;
export type PictureShape = (typeof PICTURE_SHAPES)[number];

/** The most of a picture kept in an app, and of a thumbnail shown on a card. */
export const PICTURE_MAX_BYTES = 700 * 1024;
export const THUMB_MAX_BYTES = 512 * 1024;
/** The most pictures one search gives, and one call copies. */
export const PICTURES_PER_NEED = 8;
export const PICTURES_PER_CALL = 24;

export interface FoundPicture {
  /** Ours, not the source's: what a card and an answer name it by. */
  id: string;
  /** A small copy, to show on the card. */
  thumb: string;
  /** The files to try for the app, the best first: a full one, then the small copy. */
  files: string[];
  title: string;
  creator: string;
  creatorUrl: string;
  /** "CC BY 2.0", "Pexels licence". */
  licence: string;
  licenceUrl: string;
  /** "Openverse", "Pexels". */
  source: string;
  /** The picture's own page. */
  page: string;
  /** For a picture that may not be copied: the address a page shows it from. `files` is then empty. */
  shown?: string;
  /** The source's address to call when the picture is chosen, where its rules ask for that. Never leaves the server. */
  chosenUrl?: string;
}

export interface PictureSource {
  name: string;
  search(words: string, opts: { count: number; shape?: PictureShape; signal?: AbortSignal }): Promise<FoundPicture[]>;
  /** The one site its pictures are shown from, for a source whose pictures are not copied. */
  showsFrom?: string;
  /** Tell the source a picture of its was chosen. Never throws: a picture is not lost for a count. */
  chosen?(picture: FoundPicture, signal?: AbortSignal): Promise<void>;
}

type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<{ body: Buffer; contentType: string }>;

const id = (): string => `pic_${randomBytes(6).toString('hex')}`;
const text = (value: unknown, max: number): string => (typeof value === 'string' ? plainLine(value, max) : '');
const https = (value: unknown): string => (typeof value === 'string' && /^https:\/\/[^\s"'<>]{1,1000}$/.test(value) ? value : '');

/** Openverse: pictures under licences that allow use and change for any purpose. No key. */
export function openverse(fetcher: Fetcher = safeFetch): PictureSource {
  return {
    name: 'Openverse',
    async search(words, opts) {
      const query = new URLSearchParams({ q: words, license_type: 'commercial,modification', mature: 'false', page_size: String(Math.min(20, opts.count)) });
      if (opts.shape !== undefined) query.set('aspect_ratio', opts.shape);
      const reply = await fetcher(`https://api.openverse.org/v1/images/?${query.toString()}`, { maxBytes: 512 * 1024, timeoutMs: 12_000, headers: { accept: 'application/json' }, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      const results = (JSON.parse(reply.body.toString('utf8')) as { results?: unknown }).results;
      if (!Array.isArray(results)) return [];
      return results.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const thumb = https(row['thumbnail']);
        const file = https(row['url']);
        // Only the small copy Openverse itself serves is shown on a card: its address is on one known host.
        if (thumb === '' || !thumb.startsWith('https://api.openverse.org/')) return [];
        const licence = `CC ${text(row['license'], 20).toUpperCase()}${text(row['license_version'], 8) === '' ? '' : ` ${text(row['license_version'], 8)}`}`.trim();
        return [
          {
            id: id(),
            thumb,
            files: [...(file === '' ? [] : [file]), thumb],
            title: text(row['title'], 120) || 'Untitled',
            creator: text(row['creator'], 80) || 'Unknown',
            creatorUrl: https(row['creator_url']),
            licence,
            licenceUrl: https(row['license_url']),
            source: 'Openverse',
            page: https(row['foreign_landing_url']),
          },
        ];
      });
    },
  };
}

/** Pexels, with the project's own key. */
export function pexels(key: string, fetcher: Fetcher = safeFetch): PictureSource {
  return {
    name: 'Pexels',
    async search(words, opts) {
      const query = new URLSearchParams({ query: words, per_page: String(Math.min(20, opts.count)) });
      if (opts.shape !== undefined) query.set('orientation', opts.shape === 'wide' ? 'landscape' : opts.shape === 'tall' ? 'portrait' : 'square');
      const reply = await fetcher(`https://api.pexels.com/v1/search?${query.toString()}`, {
        maxBytes: 512 * 1024,
        timeoutMs: 12_000,
        headers: { accept: 'application/json', authorization: key },
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      const photos = (JSON.parse(reply.body.toString('utf8')) as { photos?: unknown }).photos;
      if (!Array.isArray(photos)) return [];
      return photos.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const src = (row['src'] ?? {}) as Record<string, unknown>;
        const thumb = https(src['medium']);
        if (thumb === '' || !thumb.startsWith('https://images.pexels.com/')) return [];
        return [
          {
            id: id(),
            thumb,
            files: [https(src['large']), thumb].filter((url) => url !== ''),
            title: text(row['alt'], 120) || 'Untitled',
            creator: text(row['photographer'], 80) || 'Unknown',
            creatorUrl: https(row['photographer_url']),
            licence: 'Pexels licence',
            licenceUrl: 'https://www.pexels.com/license/',
            source: 'Pexels',
            page: https(row['url']),
          },
        ];
      });
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
      const query = new URLSearchParams({ query: words, per_page: String(Math.min(20, opts.count)), content_filter: 'high' });
      if (opts.shape !== undefined) query.set('orientation', opts.shape === 'wide' ? 'landscape' : opts.shape === 'tall' ? 'portrait' : 'squarish');
      const reply = await fetcher(`https://api.unsplash.com/search/photos?${query.toString()}`, { maxBytes: 768 * 1024, timeoutMs: 12_000, headers, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      const results = (JSON.parse(reply.body.toString('utf8')) as { results?: unknown }).results;
      if (!Array.isArray(results)) return [];
      return results.flatMap((entry: unknown): FoundPicture[] => {
        const row = (entry ?? {}) as Record<string, unknown>;
        const urls = (row['urls'] ?? {}) as Record<string, unknown>;
        const links = (row['links'] ?? {}) as Record<string, unknown>;
        const user = (row['user'] ?? {}) as Record<string, unknown>;
        const thumb = own(urls['small']);
        const shown = own(urls['regular']);
        // Only a picture on Unsplash's own picture host: that is the one site the person is asked to allow.
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
            licenceUrl: 'https://unsplash.com/license',
            source: 'Unsplash',
            page: https(links['html']),
          },
        ];
      });
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

/** A picture's bytes for the app: the first of its files that is a picture and fits. Null when none is. */
export async function downloadPicture(picture: FoundPicture, opts: { fetcher?: Fetcher; signal?: AbortSignal; maxBytes?: number } = {}): Promise<{ bytes: Buffer; ext: 'jpg' | 'png' | 'webp' } | null> {
  const fetcher = opts.fetcher ?? safeFetch;
  for (const url of picture.files) {
    try {
      const reply = await fetcher(url, { maxBytes: opts.maxBytes ?? PICTURE_MAX_BYTES, timeoutMs: 20_000, ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
      // By what the bytes are, whatever the address or the answer called them.
      const type = pictureTypeOf(reply.body);
      if (type !== null) return { bytes: reply.body, ext: type.ext };
    } catch {
      // Too large, gone, or not to be called: the next file of this picture, if it has one.
    }
  }
  return null;
}

export interface PictureCredit {
  file: string;
  title: string;
  creator: string;
  creatorUrl: string;
  licence: string;
  licenceUrl: string;
  source: string;
  page: string;
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
});

/**
 * The pictures a card is showing, kept while the server runs: a card names a
 * picture by an id of ours, and its address never leaves the server. Old
 * shelves are dropped as new ones come.
 */
export interface PictureShelf {
  put(sessionId: string, pictures: readonly FoundPicture[]): string;
  find(sessionId: string, shelf: string, picture: string): FoundPicture | null;
  /** A picture's small copy, fetched once and kept with the shelf. */
  thumb(sessionId: string, shelf: string, picture: string): Promise<{ bytes: Buffer; mime: string } | null>;
  drop(shelf: string): void;
}

export function createPictureShelf(opts: { fetcher?: Fetcher; max?: number } = {}): PictureShelf {
  const fetcher = opts.fetcher ?? safeFetch;
  const shelves = new Map<string, { sessionId: string; pictures: Map<string, FoundPicture>; thumbs: Map<string, Promise<{ bytes: Buffer; mime: string } | null>> }>();
  const find = (sessionId: string, shelf: string, picture: string): FoundPicture | null => {
    const held = shelves.get(shelf);
    return held === undefined || held.sessionId !== sessionId ? null : (held.pictures.get(picture) ?? null);
  };
  return {
    put(sessionId, pictures) {
      const key = `shelf_${randomBytes(8).toString('hex')}`;
      shelves.set(key, { sessionId, pictures: new Map(pictures.map((picture) => [picture.id, picture])), thumbs: new Map() });
      // The oldest go first: a card nobody answered does not keep its pictures for ever.
      while (shelves.size > (opts.max ?? 12)) shelves.delete(shelves.keys().next().value as string);
      return key;
    },
    find,
    thumb(sessionId, shelf, picture) {
      const found = find(sessionId, shelf, picture);
      const held = shelves.get(shelf);
      if (found === null || held === undefined) return Promise.resolve(null);
      let waiting = held.thumbs.get(picture);
      if (waiting === undefined) {
        waiting = fetcher(found.thumb, { maxBytes: THUMB_MAX_BYTES, timeoutMs: 12_000 })
          .then((reply) => {
            const type = pictureTypeOf(reply.body);
            return type === null ? null : { bytes: reply.body, mime: type.mime };
          })
          .catch(() => null);
        held.thumbs.set(picture, waiting);
      }
      return waiting;
    },
    drop: (shelf) => void shelves.delete(shelf),
  };
}
