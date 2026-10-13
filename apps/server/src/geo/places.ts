// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The place list: towns and cities by name, with no site asked.
 *
 * `assets/geo/places.tsv.gz` ships with the server (GeoNames' places of 1,000
 * people or more; `scripts/geo/build-places.mjs` describes the file). It is
 * read on the FIRST question and never at start: a server nobody asks a place
 * of never spends the memory.
 *
 * HOW IT IS HELD. About 170 thousand places with their names in eight
 * languages would be over a hundred megabytes as objects. So nothing here is
 * an object per place:
 *
 *  - the unpacked file stays as one buffer, and a place's line is read out of
 *    it only when that place is an answer;
 *  - what a search looks through is two long strings of names made alike
 *    ({@link placeKey}), each name between line breaks: one of names that fit
 *    in a byte a letter, one of the rest (Arabic, Chinese). A search is a walk
 *    of `indexOf` over one of them, which for a list this size is a few
 *    milliseconds and needs no index;
 *  - people, country and the offsets are number arrays.
 *
 * WHAT MATCHES. Case, accents and the ways a letter is typed do not matter:
 * `sao joao` finds São João, and an Arabic name is found with or without its
 * hamza, with ة or ه, with ى or ي, with or without marks and stretching. A
 * question matches from the start of any of a place's names, or of a word
 * inside one.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { AppError } from '../errors.js';

/** Where the list lives inside the package (`files` in package.json ships it). */
export const PLACES_FILE = 'assets/geo/places.tsv.gz';
export const PLACES_FORMAT = 1;
export const PLACE_SEARCH_MAX = 20;
/** How long a list that could not be read is left alone before it is tried again. */
export const PLACES_RETRY_MS = 60_000;

/** `dist/geo/places.js` and `src/geo/places.ts` are both two levels below the package root. */
function packageRoot(moduleUrl: string): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

export interface Place {
  /** The GeoNames id. */
  id: number;
  /** The name in the asker's language where one is known, else `plainName`. */
  name: string;
  /** The name as the list has it, usually the local one in Latin letters. */
  plainName: string;
  /** Two letters, upper case. */
  country: string;
  /** The country's name, in the asker's language where one is known. */
  countryName: string;
  /** The state, province or governorate; null where the list has none. */
  region: string | null;
  lat: number;
  lng: number;
  population: number;
}

export interface PlaceSearchOptions {
  /** Two letters, or a country's name in any shipped language. */
  country?: string | undefined;
  /** The asker's language, in either spelling (`ar_EG`, `ar-EG`). */
  language?: string | undefined;
  limit?: number | undefined;
}

export interface PlaceMatchInput {
  town: string;
  region?: string | null | undefined;
  country?: string | null | undefined;
}

export interface Places {
  /** Places whose name starts with `q`, or has a word that does: an exact name first, then the most people. */
  search(q: string, opts?: PlaceSearchOptions): Promise<Place[]>;
  byId(id: number, language?: string): Promise<Place | null>;
  /** The place an address's town is, or null: never a guess. */
  match(input: PlaceMatchInput, language?: string): Promise<Place | null>;
  /** How many places are held; reads the list. */
  count(): Promise<number>;
}

/** The list is not there or cannot be read: said plainly, as a 503. */
export class PlacesUnavailableError extends AppError {
  override readonly name = 'PlacesUnavailableError';

  constructor() {
    super(503, 'PLACES_UNAVAILABLE', 'The list of places is missing from this server, so a place cannot be looked up by name. A position can still be typed or pasted.');
  }
}

// Letters that do not come apart into a base letter and a mark.
const FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', þ: 'th', ħ: 'h', ŧ: 't', ə: 'e',
  // Arabic: one letter typed two ways. Alef with a hamza or a madda comes apart by itself (a mark).
  'ة': 'ه', 'ى': 'ي', 'ٱ': 'ا', 'ک': 'ك', 'ی': 'ي',
};
const FOLD_PATTERN = new RegExp(`[${Object.keys(FOLDS).join('')}]`, 'g');

/**
 * A name as it is compared: lower case, no accents or marks, no Arabic
 * stretching or lone hamza, punctuation as spaces, one space between words.
 */
export function placeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\p{M}ـء]/gu, '')
    .replace(FOLD_PATTERN, (letter) => FOLDS[letter] as string)
    .replace(/['’‘ʻʼ`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Whether every letter fits in a byte: which of the two strings a name is in. */
function narrow(key: string): boolean {
  for (let at = 0; at < key.length; at += 1) if (key.charCodeAt(at) > 0xff) return false;
  return true;
}

/** `ar_EG` → `ar`; Chinese keeps its script (`zh-CN`, `zh-TW`). */
function languageOf(locale: string | undefined): string {
  if (locale === undefined) return 'en';
  const tag = locale.replace(/_/g, '-');
  const [language = 'en', region = ''] = tag.split('-');
  if (language.toLowerCase() === 'zh') return /^(tw|hk|mo|hant)$/i.test(region) ? 'zh-TW' : 'zh-CN';
  return language.toLowerCase();
}

/** `lang=name|lang=name` → the name in `language`, or undefined. */
function nameIn(names: string | undefined, language: string): string | undefined {
  if (names === undefined || names === '') return undefined;
  for (const part of names.split('|')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at) === language) return part.slice(at + 1);
  }
  return undefined;
}

/** One of the two strings of names, with where each place's names begin in it. */
interface Haystack {
  text: string;
  /** Per place, in file order: the offset of its first name. A place with no name here has the next one's offset. */
  starts: Uint32Array;
}

interface Loaded {
  file: Buffer;
  /** Where each place's line begins in `file`; one more entry closes the last. */
  lines: Uint32Array;
  ids: Int32Array;
  people: Int32Array;
  /** Index into `countryCodes`. */
  countryOf: Uint16Array;
  countryCodes: string[];
  /** Per country code: its line's cells (`name`, `names`). */
  countries: Map<string, { name: string; names: string }>;
  /** A country's name as compared, in any shipped language → its code. */
  countryByName: Map<string, string>;
  narrow: Haystack;
  wide: Haystack;
}

function parse(packed: Buffer): Loaded {
  const file = gunzipSync(packed);
  const head = file.subarray(0, file.indexOf(0x0a)).toString('utf8').split(' ');
  if (head[0] !== '#adminium-places' || Number(head[1]) !== PLACES_FORMAT) throw new Error('not a place list this server reads');
  const count = Number(head[3]);
  if (!Number.isInteger(count) || count < 1) throw new Error('the place list says it is empty');

  const lines = new Uint32Array(count + 1);
  const ids = new Int32Array(count);
  const people = new Int32Array(count);
  const countryOf = new Uint16Array(count);
  const countryCodes: string[] = [];
  const countryIndex = new Map<string, number>();
  const countries = new Map<string, { name: string; names: string }>();
  const countryByName = new Map<string, string>();
  const narrowStarts = new Uint32Array(count + 1);
  const wideStarts = new Uint32Array(count + 1);
  // Each string starts with a line break, so every name has one on both sides. They are written
  // into two buffers and made strings once, at the end: half a million small strings kept until
  // then would be the largest thing this function ever held.
  let narrowBytes = Buffer.allocUnsafe(Math.ceil(file.length / 2));
  let wideBytes = Buffer.allocUnsafe(Math.ceil(file.length / 2));
  narrowBytes[0] = 0x0a;
  wideBytes.writeUInt16LE(0x0a, 0);
  let narrowAt = 1;
  let wideAt = 1;

  let at = file.indexOf(0x0a) + 1;
  let row = 0;
  while (at < file.length) {
    let end = file.indexOf(0x0a, at);
    if (end === -1) end = file.length;
    if (end > at) {
      const cells = file.toString('utf8', at, end).split('\t');
      if (file[at] === 0x3d /* = */) {
        const code = (cells[0] as string).slice(1);
        const name = cells[1] ?? code;
        const names = cells[2] ?? '';
        countries.set(code, { name, names });
        for (const spelled of [name, ...names.split('|').map((part) => part.slice(part.indexOf('=') + 1))]) {
          const key = placeKey(spelled);
          if (key !== '' && !countryByName.has(key)) countryByName.set(key, code);
        }
      } else {
        if (row >= count || cells.length < 9) throw new Error('the place list is not whole');
        lines[row] = at;
        ids[row] = Number(cells[0]);
        people[row] = Number(cells[8]);
        const code = cells[3] as string;
        let index = countryIndex.get(code);
        if (index === undefined) {
          index = countryCodes.push(code) - 1;
          countryIndex.set(code, index);
        }
        countryOf[row] = index;
        narrowStarts[row] = narrowAt;
        wideStarts[row] = wideAt;
        const seen = new Set<string>();
        const names = [cells[1] as string, cells[2] as string];
        if (cells[9] !== undefined && cells[9] !== '') for (const part of cells[9].split('|')) names.push(part.slice(part.indexOf('=') + 1));
        for (const name of names) {
          const key = placeKey(name);
          if (key === '' || seen.has(key)) continue;
          seen.add(key);
          if (narrow(key)) {
            if (narrowAt + key.length + 1 > narrowBytes.length) narrowBytes = Buffer.concat([narrowBytes, Buffer.allocUnsafe(narrowBytes.length)]);
            narrowBytes.write(`${key}\n`, narrowAt, 'latin1');
            narrowAt += key.length + 1;
          } else {
            if ((wideAt + key.length + 1) * 2 > wideBytes.length) wideBytes = Buffer.concat([wideBytes, Buffer.allocUnsafe(wideBytes.length)]);
            wideBytes.write(`${key}\n`, wideAt * 2, 'utf16le');
            wideAt += key.length + 1;
          }
        }
        row += 1;
      }
    }
    at = end + 1;
  }
  if (row !== count) throw new Error('the place list is not whole');
  lines[count] = file.length;
  narrowStarts[count] = narrowAt;
  wideStarts[count] = wideAt;
  return {
    file,
    lines,
    ids,
    people,
    countryOf,
    countryCodes,
    countries,
    countryByName,
    narrow: { text: narrowBytes.toString('latin1', 0, narrowAt), starts: narrowStarts },
    wide: { text: wideBytes.toString('utf16le', 0, wideAt * 2), starts: wideStarts },
  };
}

/** The place whose names hold offset `at`: the last one that starts at or before it. */
function rowAt(starts: Uint32Array, at: number): number {
  let low = 0;
  let high = starts.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if ((starts[mid] as number) <= at) low = mid;
    else high = mid - 1;
  }
  return low;
}

function rowOfId(ids: Int32Array, id: number): number {
  let low = 0;
  let high = ids.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const found = ids[mid] as number;
    if (found === id) return mid;
    if (found < id) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

let shared: Places | null = null;

/** The list this server ships, read once however many ask. */
export function defaultPlaces(): Places {
  shared ??= createPlaces();
  return shared;
}

export interface PlacesOptions {
  /** The list's file; defaults to the one this package ships. */
  file?: string | undefined;
  now?: (() => number) | undefined;
}

export function createPlaces(opts: PlacesOptions = {}): Places {
  const path = opts.file ?? join(packageRoot(import.meta.url), PLACES_FILE);
  const now = opts.now ?? Date.now;
  let loading: Promise<Loaded> | null = null;
  /** When the list last could not be read. */
  let failedAt: number | null = null;

  /*
   * The file is unpacked and read through in one go, on the thread that
   * answers requests: about a third of a second, once, on the first question.
   *
   * A list that is missing or broken is tried again, so a file put back is
   * found without a restart; but no sooner than {@link PLACES_RETRY_MS} after
   * it failed. A broken file costs that third of a second each time it is
   * unpacked, and every question would otherwise pay it.
   */
  function loaded(): Promise<Loaded> {
    if (failedAt !== null) {
      if (now() - failedAt < PLACES_RETRY_MS) return Promise.reject(new PlacesUnavailableError());
      failedAt = null;
    }
    loading ??= readFile(path).then(parse);
    return loading.catch(() => {
      if (loading !== null) failedAt = now();
      loading = null;
      throw new PlacesUnavailableError();
    });
  }

  function countryCode(data: Loaded, country: string | null | undefined): string | null | undefined {
    if (country === undefined || country === null || country.trim() === '') return undefined;
    const code = country.trim().toUpperCase();
    if (data.countries.has(code)) return code;
    // Named, and not a country the list knows: nothing is in it.
    return data.countryByName.get(placeKey(country)) ?? null;
  }

  function cellsOf(data: Loaded, row: number): string[] {
    return data.file.toString('utf8', data.lines[row] as number, (data.lines[row + 1] as number) - 1).split('\t');
  }

  function placeOf(data: Loaded, row: number, language: string): Place {
    const cells = cellsOf(data, row);
    const plainName = cells[1] as string;
    const code = cells[3] as string;
    const country = data.countries.get(code);
    return {
      id: Number(cells[0]),
      name: nameIn(cells[9], language) ?? plainName,
      plainName,
      country: code,
      countryName: nameIn(country?.names, language) ?? country?.name ?? code,
      region: cells[5] === undefined || cells[5] === '' ? null : cells[5],
      lat: Number(cells[6]),
      lng: Number(cells[7]),
      population: Number(cells[8]),
    };
  }

  /** Every place with a name `needle` is found in: `lead` + key, where the lead says what must come before. */
  function collect(data: Loaded, key: string, exactOnly: boolean, country: number | undefined, into: Map<number, boolean>): void {
    const hay = narrow(key) ? data.narrow : data.wide;
    const walk = (needle: string, exact: boolean): void => {
      let at = hay.text.indexOf(needle);
      while (at !== -1) {
        const row = rowAt(hay.starts, at + 1);
        if (country === undefined || data.countryOf[row] === country) {
          if (exact) into.set(row, true);
          else if (!into.has(row)) into.set(row, false);
        }
        at = hay.text.indexOf(needle, at + 1);
      }
    };
    walk(`\n${key}\n`, true);
    if (exactOnly) return;
    walk(`\n${key}`, false);
    walk(` ${key}`, false);
  }

  return {
    async search(q, options = {}) {
      const data = await loaded();
      const key = placeKey(q);
      if (key === '') return [];
      const code = countryCode(data, options.country);
      if (code === null) return [];
      const found = new Map<number, boolean>();
      collect(data, key, false, code === undefined ? undefined : data.countryCodes.indexOf(code), found);
      const limit = Math.min(Math.max(1, Math.trunc(options.limit ?? 10)), PLACE_SEARCH_MAX);
      const rows = [...found.keys()].sort((a, b) => Number(found.get(b)) - Number(found.get(a)) || (data.people[b] as number) - (data.people[a] as number) || a - b);
      const language = languageOf(options.language);
      return rows.slice(0, limit).map((row) => placeOf(data, row, language));
    },

    async byId(id, language) {
      const data = await loaded();
      if (!Number.isInteger(id)) return null;
      const row = rowOfId(data.ids, id);
      return row === -1 ? null : placeOf(data, row, languageOf(language));
    },

    async match(input, language) {
      const data = await loaded();
      const key = placeKey(input.town);
      if (key === '') return null;
      const code = countryCode(data, input.country);
      if (code === null) return null;
      const found = new Map<number, boolean>();
      collect(data, key, true, code === undefined ? undefined : data.countryCodes.indexOf(code), found);
      if (found.size === 0) return null;
      let rows = [...found.keys()];
      const region = input.region === undefined || input.region === null ? '' : placeKey(input.region);
      if (region !== '' && rows.length > 1) {
        // The region by its name or by its code (`IL`); when none of them is in it, the region decides nothing.
        const inRegion = rows.filter((row) => {
          const cells = cellsOf(data, row);
          return placeKey(cells[5] ?? '') === region || (cells[4] ?? '').toLowerCase() === region;
        });
        if (inRegion.length > 0) rows = inRegion;
      }
      rows.sort((a, b) => (data.people[b] as number) - (data.people[a] as number) || a - b);
      return placeOf(data, rows[0] as number, languageOf(language));
    },

    async count() {
      return (await loaded()).ids.length;
    },
  };
}
