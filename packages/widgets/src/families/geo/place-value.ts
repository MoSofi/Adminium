// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A place and an area as a column keeps them, read for the screen: the form's
 * field, a list's cell, a record's page. PURE: no React, no map engine.
 *
 * The server owns the rules (`apps/server/src/geo/values.ts`): what a write
 * may give, and that a town's position is its own list's and nobody's guess.
 * This side only reads what is stored and decides what text is worth sending.
 */
import { isAreaGeometry, type AreaGeometry } from './map-shapes.js';

/** A stored place: a position, and how it is known. */
export interface PlaceValue {
  lat: number;
  lng: number;
  /** `town`: the middle of a town, so "somewhere in it". `exact`: a spot a person gave. */
  by: 'town' | 'exact';
  placeId?: number | undefined;
  name?: string | undefined;
  country?: string | undefined;
}

/** A town of the server's place list (`GET /api/v1/geo/places`). */
export interface PlaceSuggestion {
  id: number;
  /** In the asker's language where the list has it. */
  name: string;
  region?: string | null | undefined;
  countryName?: string | undefined;
  country?: string | undefined;
  lat: number;
  lng: number;
}

/** A JSON column's value as an object, whichever of the two an engine hands back. */
function objectOf(value: unknown): Record<string, unknown> | null {
  let read = value;
  if (typeof read === 'string') {
    const text = read.trim();
    if (!text.startsWith('{')) return null;
    try {
      read = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  return typeof read === 'object' && read !== null && !Array.isArray(read) ? (read as Record<string, unknown>) : null;
}

/** The stored place, or null for anything else (nothing, or text on its way to the server). */
export function placeValueOf(value: unknown): PlaceValue | null {
  const read = objectOf(value);
  if (read === null) return null;
  const { lat, lng, by, placeId, name, country } = read;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat,
    lng,
    // A bare pair is a spot somebody gave.
    by: by === 'town' ? 'town' : 'exact',
    ...(typeof placeId === 'number' ? { placeId } : {}),
    ...(typeof name === 'string' && name.trim() !== '' ? { name } : {}),
    ...(typeof country === 'string' && country !== '' ? { country } : {}),
  };
}

/** The stored area, or null. */
export function areaValueOf(value: unknown): AreaGeometry | null {
  const read = objectOf(value);
  return isAreaGeometry(read) ? read : null;
}

/** A position for reading: five decimals is about a metre. */
export function coordinateText(place: { lat: number; lng: number }): string {
  return `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
}

/**
 * Text with its Arabic-Indic (٠–٩) and Persian or Urdu (۰–۹) digits written
 * as 0–9, the Arabic decimal mark (٫) as a point and the Arabic comma (،) as
 * a comma: `٣٠٫٠٤٤٤، ٣١٫٢٣٥٧` is `30.0444, 31.2357`. A person types
 * coordinates on the keyboard they have; a position is stored in one notation.
 */
export function latinDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\u066B/g, '.')
    .replace(/\u060C/g, ',');
}

const NUMBER = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;
const PAIR = new RegExp(String.raw`^${NUMBER}\s*[,\s]\s*${NUMBER}$`);

/**
 * Whether typed text is a position rather than a town's name: a pair of
 * numbers (in Latin, Arabic-Indic or Persian digits), a `geo:` address, or a
 * link. Such text is sent with its digits made Latin ({@link latinDigits});
 * the server reads it. Anything else is looked up in the place list.
 */
export function looksLikePosition(text: string): boolean {
  const trimmed = latinDigits(text).trim();
  if (trimmed === '') return false;
  return PAIR.test(trimmed) || /^geo:/i.test(trimmed) || /^https?:\/\//i.test(trimmed) || /^[\w.-]+\.[a-z]{2,}\/\S+/i.test(trimmed);
}
