// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area as a column keeps them, and what a write may give.
 *
 * A PLACE is `{ lat, lng, by }`. `by` says how the position is known, and it
 * is the honest part: `town` is the middle of a town from Adminium's own list
 * (`placeId`), so it means "somewhere in this town" and nothing finer;
 * `exact` is a point a person gave. A `town` position is always filled in by
 * the SERVER from the list, never taken from the writer: nobody can store a
 * made-up point and have it read as a town's.
 *
 * What a write may give for a place:
 *
 *  - that object;
 *  - `{ placeId }`: a town by its id in the list;
 *  - `{ lat, lng }`: an exact point;
 *  - text: `lat,lng` (in Latin, Arabic-Indic or Persian digits), a `geo:`
 *    address, or a pasted map link whose position is written in the link itself. THE LINK IS ONLY READ AS TEXT. Nothing
 *    here, or anywhere on the write path, asks another site what a link
 *    points at: a short link, which says nothing until it is followed, is
 *    refused with a reason of its own.
 *
 * An AREA is a GeoJSON `Polygon` or `MultiPolygon` (a `Feature` wrapping one
 * is taken, and stored as the bare shape).
 */
import type { Places } from './places.js';

export type PlaceBy = 'town' | 'exact';

export interface PlaceValue {
  lat: number;
  lng: number;
  by: PlaceBy;
  /** The town's id in the place list. Always there for `town`. */
  placeId?: number;
  /** The town's name as the list has it, or a label the writer gave an exact point. */
  name?: string;
  /** Two letters, upper case. */
  country?: string;
}

export type PlaceIssueCode = 'place-unreadable' | 'place-out-of-range' | 'place-unknown' | 'place-short-link';
export type AreaIssueCode = 'area-unreadable' | 'area-too-large';

export type Judged<T, Code extends string> = { ok: true; value: T | null } | { ok: false; code: Code };

export const AREA_MAX_POINTS = 2_000;
export const AREA_MAX_BYTES = 64 * 1024;
const PLACE_NAME_MAX = 200;
/** The longest text read as a place: a map link can be long, and no longer than this. */
const PLACE_TEXT_MAX = 4_096;

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
// A comma with any blanks around it, or blanks alone. Written as two ways that cannot both read the
// same blanks: `\s*[,\s]\s*` could, and a long run of blanks then took time by the square of its length.
const PAIR = new RegExp(String.raw`^(${NUMBER})(?:\s*,\s*|\s+)(${NUMBER})$`);
const PAIR_IN = new RegExp(String.raw`^(${NUMBER}),\s*(${NUMBER})(?:$|[,;&z])`);

/** Seven decimals is about a centimetre: finer than any point a person gives, and it keeps the stored text short. */
function tidy(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

function numberOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && /^\s*[-+]?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return null;
}

type Point = { lat: number; lng: number };

function pointOf(lat: unknown, lng: unknown): Point | 'unreadable' | 'out-of-range' {
  const a = numberOf(lat);
  const b = numberOf(lng);
  if (a === null || b === null) return 'unreadable';
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return 'out-of-range';
  return { lat: tidy(a), lng: tidy(b) };
}

function pairOf(text: string, pattern: RegExp = PAIR): [string, string] | null {
  const found = pattern.exec(text.trim());
  return found === null ? null : [found[1] as string, found[2] as string];
}

/** Hosts whose links say nothing until they are followed. */
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl', 'g.co', 'g.page', 'maps.apple', 'osm.org', 'bit.ly', 'tinyurl.com', 't.co', 'binged.it', 'her.is', 'w3w.co', 'waze.to']);

/**
 * The position written in a map link, read from its text alone.
 *
 * Where a link names both a marker and where the map is looking, the marker
 * wins: Google's `!3d…!4d…`, OpenStreetMap's `mlat`/`mlon`, a `q`, `query`,
 * `ll`, `center`, `coordinate` or `destination` of `lat,lng`; then the view
 * (`@lat,lng`, `#map=zoom/lat/lng`, `cp=lat~lng`).
 */
function linkPoint(text: string): [string, string] | 'short' | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  let whole = `${url.pathname}${url.search}${url.hash}`;
  try {
    whole = decodeURIComponent(whole);
  } catch {
    // An escape that is not text: read the link as it was written.
  }

  const pinned = /!3d([-+]?\d{1,3}(?:\.\d+)?)!4d([-+]?\d{1,3}(?:\.\d+)?)/.exec(whole);
  if (pinned !== null) return [pinned[1] as string, pinned[2] as string];
  const mlat = url.searchParams.get('mlat');
  const mlon = url.searchParams.get('mlon') ?? url.searchParams.get('mlng');
  if (mlat !== null && mlon !== null) return [mlat, mlon];
  for (const key of ['q', 'query', 'll', 'sll', 'center', 'coordinate', 'destination', 'daddr', 'loc']) {
    const value = url.searchParams.get(key);
    const pair = value === null ? null : pairOf(value.replace(/^loc:/, ''), PAIR_IN);
    if (pair !== null) return pair;
  }
  const at = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})(?:,|$|/)`).exec(whole);
  if (at !== null) return [at[1] as string, at[2] as string];
  const osm = new RegExp(String.raw`#map=\d+(?:\.\d+)?/(${NUMBER})/(${NUMBER})`).exec(whole);
  if (osm !== null) return [osm[1] as string, osm[2] as string];
  const bing = new RegExp(String.raw`[?&]cp=(${NUMBER})~(${NUMBER})`).exec(whole);
  if (bing !== null) return [bing[1] as string, bing[2] as string];

  // Nothing in the text. Said apart when it is the kind of link that would have to be followed.
  if (SHORT_LINK_HOSTS.has(host) || (host === 'maps.apple.com' && url.pathname.startsWith('/p/')) || (host === 'openstreetmap.org' && url.pathname.startsWith('/go/'))) return 'short';
  return null;
}

/**
 * Text with its Arabic-Indic (٠–٩) and Persian or Urdu (۰–۹) digits written
 * as 0–9, the Arabic decimal mark (٫) as a point and the Arabic comma (،) as
 * a comma: `٣٠٫٠٤٤٤، ٣١٫٢٣٥٧` is `30.0444, 31.2357`. The form does this before
 * it sends; a file's cell and a write from anywhere else come here as typed.
 */
function latinDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/\u060C/g, ',');
}

/** The position a text says: `lat,lng`, a `geo:` address, or a map link read as text. */
export function pointFromText(text: string): Point | PlaceIssueCode {
  // The length limit first, on the text as it came: nothing longer is read at all.
  if (text.trim().length > PLACE_TEXT_MAX) return 'place-unreadable';
  const trimmed = latinDigits(text).trim();
  let pair: [string, string] | 'short' | null = pairOf(trimmed);
  if (pair === null && /^geo:/i.test(trimmed)) pair = pairOf(trimmed.slice(4).split(/[;?]/)[0] as string, PAIR_IN);
  else if (pair === null && /^https?:\/\//i.test(trimmed)) pair = linkPoint(trimmed);
  if (pair === 'short') return 'place-short-link';
  if (pair === null) return 'place-unreadable';
  const point = pointOf(pair[0], pair[1]);
  return typeof point === 'string' ? (point === 'unreadable' ? 'place-unreadable' : 'place-out-of-range') : point;
}

function isDoc(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * What a write gave for a place, as the column keeps it. `places` is asked
 * only for a town (`placeId`); an exact point needs no list.
 */
export async function placeValueOf(input: unknown, places: Places): Promise<Judged<PlaceValue, PlaceIssueCode>> {
  if (input === null || input === undefined) return { ok: true, value: null };
  let given: unknown = input;
  if (typeof given === 'string') {
    const text = given.trim();
    if (text === '' || text === 'null') return { ok: true, value: null };
    // The length limit comes first: nothing longer is parsed, as JSON or as a position.
    if (text.length > PLACE_TEXT_MAX) return { ok: false, code: 'place-unreadable' };
    if (text.startsWith('{')) {
      try {
        given = JSON.parse(text);
      } catch {
        return { ok: false, code: 'place-unreadable' };
      }
    } else {
      const point = pointFromText(text);
      return typeof point === 'string' ? { ok: false, code: point } : { ok: true, value: { ...point, by: 'exact' } };
    }
  }
  if (!isDoc(given)) return { ok: false, code: 'place-unreadable' };

  const by = given['by'];
  if (by !== undefined && by !== 'town' && by !== 'exact') return { ok: false, code: 'place-unreadable' };
  const hasPoint = given['lat'] !== undefined || given['lng'] !== undefined;
  const id = given['placeId'] === undefined || given['placeId'] === null ? null : numberOf(given['placeId']);
  if (given['placeId'] !== undefined && given['placeId'] !== null && (id === null || !Number.isInteger(id) || id < 1)) return { ok: false, code: 'place-unreadable' };

  // A town: by its id, and the position is the list's, whatever the writer sent beside it.
  if (by === 'town' || (by === undefined && !hasPoint)) {
    if (id === null) return { ok: false, code: 'place-unreadable' };
    const town = await places.byId(id);
    if (town === null) return { ok: false, code: 'place-unknown' };
    return { ok: true, value: { lat: town.lat, lng: town.lng, by: 'town', placeId: town.id, name: town.plainName, country: town.country } };
  }

  // An exact point. A town named beside it is the list's town (its name and country are not the writer's to say).
  const point = pointOf(given['lat'], given['lng']);
  if (typeof point === 'string') return { ok: false, code: point === 'unreadable' ? 'place-unreadable' : 'place-out-of-range' };
  const value: PlaceValue = { ...point, by: 'exact' };
  if (id !== null) {
    const town = await places.byId(id);
    if (town === null) return { ok: false, code: 'place-unknown' };
    value.placeId = town.id;
    value.name = town.plainName;
    value.country = town.country;
    return { ok: true, value };
  }
  const name = given['name'];
  if (name !== undefined && name !== null) {
    if (typeof name !== 'string' || name.length > PLACE_NAME_MAX) return { ok: false, code: 'place-unreadable' };
    if (name.trim() !== '') value.name = name.trim();
  }
  const country = given['country'];
  if (country !== undefined && country !== null && country !== '') {
    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) return { ok: false, code: 'place-unreadable' };
    value.country = country.toUpperCase();
  }
  return { ok: true, value };
}

export interface AreaValue {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

/** One polygon's rings as kept, or why not; `count` is added to as points are read. */
function ringsOf(raw: unknown, count: { points: number }): number[][][] | AreaIssueCode {
  if (!Array.isArray(raw) || raw.length === 0) return 'area-unreadable';
  const rings: number[][][] = [];
  for (const ring of raw) {
    if (!Array.isArray(ring) || ring.length < 4) return 'area-unreadable';
    count.points += ring.length;
    if (count.points > AREA_MAX_POINTS) return 'area-too-large';
    const out: number[][] = [];
    for (const position of ring) {
      // GeoJSON writes a position east first: [lng, lat]. A height after them is dropped.
      if (!Array.isArray(position) || position.length < 2 || position.length > 3) return 'area-unreadable';
      const [lng, lat] = position as unknown[];
      if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return 'area-unreadable';
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return 'area-unreadable';
      out.push([tidy(lng), tidy(lat)]);
    }
    const first = out[0] as number[];
    const last = out[out.length - 1] as number[];
    if (first[0] !== last[0] || first[1] !== last[1]) return 'area-unreadable';
    rings.push(out);
  }
  return rings;
}

/** What a write gave for an area, as the column keeps it: the bare shape. */
export function areaValueOf(input: unknown): Judged<AreaValue, AreaIssueCode> {
  if (input === null || input === undefined) return { ok: true, value: null };
  let given: unknown = input;
  if (typeof given === 'string') {
    const text = given.trim();
    if (text === '' || text === 'null') return { ok: true, value: null };
    if (Buffer.byteLength(text, 'utf8') > AREA_MAX_BYTES * 4) return { ok: false, code: 'area-too-large' };
    try {
      given = JSON.parse(text);
    } catch {
      return { ok: false, code: 'area-unreadable' };
    }
  }
  if (isDoc(given) && given['type'] === 'Feature') given = given['geometry'];
  if (!isDoc(given)) return { ok: false, code: 'area-unreadable' };
  const count = { points: 0 };
  let value: AreaValue;
  if (given['type'] === 'Polygon') {
    const rings = ringsOf(given['coordinates'], count);
    if (typeof rings === 'string') return { ok: false, code: rings };
    value = { type: 'Polygon', coordinates: rings };
  } else if (given['type'] === 'MultiPolygon') {
    const raw = given['coordinates'];
    if (!Array.isArray(raw) || raw.length === 0) return { ok: false, code: 'area-unreadable' };
    const polygons: number[][][][] = [];
    for (const polygon of raw) {
      const rings = ringsOf(polygon, count);
      if (typeof rings === 'string') return { ok: false, code: rings };
      polygons.push(rings);
    }
    value = { type: 'MultiPolygon', coordinates: polygons };
  } else {
    return { ok: false, code: 'area-unreadable' };
  }
  // Judged as it is kept: a shape under the point limit can still be over the size one.
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > AREA_MAX_BYTES) return { ok: false, code: 'area-too-large' };
  return { ok: true, value };
}

/**
 * A stored place or area as an object: SQLite hands a JSON column back as
 * text. Text that is no object (`123`, `true`, `[1]`, anything that is not
 * JSON) was written before the rule, or by another program: it is shown as it
 * is stored, never as the number or the list it happens to spell.
 */
export function readGeoValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const read = JSON.parse(value) as unknown;
    return isDoc(read) ? read : value;
  } catch {
    return value;
  }
}

/** A stored place as a file's cell writes it: `lat,lng`, which an import reads back. */
export function placeCellText(value: unknown): string | null {
  const read = readGeoValue(value);
  if (!isDoc(read) || typeof read['lat'] !== 'number' || typeof read['lng'] !== 'number') return null;
  return `${String(read['lat'])},${String(read['lng'])}`;
}
