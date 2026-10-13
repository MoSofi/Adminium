// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the map draws besides bubbles, as plain data and pure functions: pins
 * that share one position spread into a ring, the view that fits everything,
 * a route's legs in words, the link to a phone's own maps app, and the
 * geometry of an area while it is drawn and changed.
 *
 * PURE: no React, no DOM, and no map engine. The owner component and the
 * engine module both read this; so do the place and area fields.
 */

/** A position in GeoJSON order: `[lng, lat]`. */
export type Corner = [number, number];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: number[][][];
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: number[][][][];
}
export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface LineGeometry {
  type: 'LineString';
  coordinates: number[][];
}

export type AreaTone = 'neutral' | 'accent' | 'pos' | 'warn' | 'danger' | 'info';

/** An area drawn on the map as a filled outline. */
export interface MapArea {
  id: string;
  name?: string | undefined;
  geometry: AreaGeometry;
  tone?: AreaTone | undefined;
}

/** One leg of a route, as `POST /geo/route` answers it. */
export interface RouteLeg {
  distanceM: number | null;
  durationS: number | null;
  /** A straight line, not a road: said as "about". */
  estimate: boolean;
  /** Both ends are known only as the same town: no length can be given. */
  unknown?: true | undefined;
}

/** The way through the points, in their order. Without `line`, straight legs are drawn. */
export interface MapRoute {
  line?: LineGeometry | undefined;
  legs: readonly RouteLeg[];
}

export type DistanceUnits = 'km' | 'mi';

// ── pins that share a position ──────────────────────────────────────────────

export interface PinSpread {
  /** Screen pixels the pin is drawn away from its position. */
  dx: number;
  dy: number;
  /** How many pins stand on this position, this one included. */
  shared: number;
}

/** The least distance between two neighbours on the ring, in pixels. */
export const SPREAD_GAP = 26;
const SPREAD_MIN_RADIUS = 16;

/** Positions closer than about a metre are one position. */
function positionKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

/**
 * Where each pin is drawn when several stand on one position (every customer
 * known "by town" stands on the town's centre): around it, in a ring, so each
 * can be seen and picked. A pin alone is not moved. The same input always
 * gives the same ring: the first pin is at the top, the rest clockwise in
 * their given order.
 */
export function spreadPins(positions: readonly { lat: number; lng: number }[]): PinSpread[] {
  const groups = new Map<string, number[]>();
  positions.forEach((position, index) => {
    const key = positionKey(position.lat, position.lng);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [index]);
    else group.push(index);
  });
  const out: PinSpread[] = positions.map(() => ({ dx: 0, dy: 0, shared: 1 }));
  for (const group of groups.values()) {
    const n = group.length;
    if (n < 2) continue;
    // The radius at which neighbours on the ring are SPREAD_GAP apart.
    const radius = Math.max(SPREAD_MIN_RADIUS, SPREAD_GAP / (2 * Math.sin(Math.PI / n)));
    group.forEach((index, at) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * at) / n;
      out[index] = { dx: Math.round(radius * Math.cos(angle)), dy: Math.round(radius * Math.sin(angle)), shared: n };
    });
  }
  return out;
}

// ── the view that fits ──────────────────────────────────────────────────────

/** `[[west, south], [east, north]]`. */
export type Bounds = [[number, number], [number, number]];

function ringsOf(geometry: AreaGeometry): number[][][] {
  return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}

/**
 * The box around every point, area and line; null when there is nothing to fit.
 *
 * ACROSS THE DATE LINE. Longitudes are a ring, and the plain box from the
 * least to the greatest of them goes the long way round for places on both
 * sides of 180° (Fiji at 179 and -179 would be framed by the whole world).
 * When that plain box is wider than half the world, the widest stretch with
 * nothing in it is left out instead: the box then starts east of that stretch
 * and its east edge is past 180 (`[179, 181]`), which the map reads as the
 * short way across the line.
 */
export function boundsOf(
  points: readonly { lat: number; lng: number }[],
  areas: readonly { geometry: AreaGeometry }[] = [],
  line?: LineGeometry | undefined,
): Bounds | null {
  let south = Infinity;
  let north = -Infinity;
  const lngs: number[] = [];
  const take = (lng: unknown, lat: unknown): void => {
    if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return;
    lngs.push(lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  };
  for (const point of points) take(point.lng, point.lat);
  for (const area of areas) for (const ring of ringsOf(area.geometry)) for (const corner of ring) take(corner[0], corner[1]);
  for (const corner of line?.coordinates ?? []) take(corner[0], corner[1]);
  if (lngs.length === 0) return null;
  lngs.sort((a, b) => a - b);
  let west = lngs[0] as number;
  let east = lngs[lngs.length - 1] as number;
  if (east - west > 180) {
    // The widest empty stretch between two neighbours, the one over the date line included.
    let gap = west + 360 - east;
    let after = 0;
    for (let index = 1; index < lngs.length; index += 1) {
      const between = (lngs[index] as number) - (lngs[index - 1] as number);
      if (between > gap) {
        gap = between;
        after = index;
      }
    }
    if (after > 0) {
      west = lngs[after] as number;
      east = (lngs[after - 1] as number) + 360;
    }
  }
  return [[west, south], [east, north]];
}

// ── a route's legs in words ─────────────────────────────────────────────────

export type LegDistance =
  /** No length can be given. Never shown as 0. */
  | { kind: 'unknown' }
  | { kind: 'about' | 'exact'; value: number; unit: 'meter' | 'kilometer' | 'foot' | 'mile' };

const METRES_PER_MILE = 1609.344;
const METRES_PER_FOOT = 0.3048;

/**
 * A leg's length as it is said: unknown, "about" a figure (a straight line),
 * or the figure (a road). Short legs are in metres or feet, so a walk across
 * a square does not read as "0 km".
 */
export function legDistance(leg: RouteLeg | undefined, units: DistanceUnits = 'km'): LegDistance {
  if (leg === undefined || leg.unknown === true || leg.distanceM === null || !Number.isFinite(leg.distanceM)) return { kind: 'unknown' };
  const kind = leg.estimate ? 'about' : 'exact';
  const metres = Math.max(0, leg.distanceM);
  if (units === 'mi') {
    const miles = metres / METRES_PER_MILE;
    if (miles < 0.1) return { kind, value: Math.round(metres / METRES_PER_FOOT / 10) * 10, unit: 'foot' };
    return { kind, value: miles < 100 ? Math.round(miles * 10) / 10 : Math.round(miles), unit: 'mile' };
  }
  if (metres < 1000) return { kind, value: Math.round(metres / 10) * 10, unit: 'meter' };
  const km = metres / 1000;
  return { kind, value: km < 100 ? Math.round(km * 10) / 10 : Math.round(km), unit: 'kilometer' };
}

/** The figure with its unit, in the reader's language ("12.4 km", "١٢٫٤ كم"). */
export function formatDistance(distance: Exclude<LegDistance, { kind: 'unknown' }>, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit: distance.unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(distance.value);
  } catch {
    return `${distance.value} ${{ meter: 'm', kilometer: 'km', foot: 'ft', mile: 'mi' }[distance.unit]}`;
  }
}

/** Straight lines through the points in order: what is drawn when a route has no line of its own. */
export function straightLine(points: readonly { lat: number; lng: number }[]): LineGeometry {
  return { type: 'LineString', coordinates: points.map((point) => [point.lng, point.lat]) };
}

// ── the phone's own maps app ────────────────────────────────────────────────

/** An iPhone, an iPad (which says "Macintosh" and has a touch screen), or an iPod. */
export function isAppleDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * A link that opens a position in the device's own maps app. A link the
 * person taps, never a request this app makes: `geo:` wherever the device
 * understands it, Apple's maps address on Apple devices (which do not).
 */
export function mapsAppHref(point: { lat: number; lng: number; name?: string | undefined }, apple: boolean): string {
  const at = `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
  const name = (point.name ?? '').trim();
  if (apple) return `https://maps.apple.com/?ll=${at}${name === '' ? '' : `&q=${encodeURIComponent(name)}`}`;
  return `geo:${at}?q=${at}${name === '' ? '' : encodeURIComponent(`(${name})`)}`;
}

// ── an area while it is drawn and changed ───────────────────────────────────

/** The fewest corners a shape can have. */
export const MIN_CORNERS = 3;

function sameCorner(a: readonly number[] | undefined, b: readonly number[] | undefined): boolean {
  return a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1];
}

/**
 * The corners a person can drag: the outer ring of the (first) polygon,
 * without the closing corner GeoJSON repeats. Holes and further polygons of a
 * multi-polygon are drawn and kept, and are not editable here.
 */
export function cornersOf(geometry: AreaGeometry | null | undefined): Corner[] {
  if (geometry === null || geometry === undefined) return [];
  const ring = (geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0]) ?? [];
  const open = ring.length > 1 && sameCorner(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring;
  return open.flatMap((corner): Corner[] =>
    typeof corner[0] === 'number' && typeof corner[1] === 'number' && Number.isFinite(corner[0]) && Number.isFinite(corner[1]) ? [[corner[0], corner[1]]] : [],
  );
}

/**
 * The shape after its one editable ring was changed: the corners put back as
 * the outer ring of the (first) polygon, every hole and every further polygon
 * kept as it was. With no shape to keep (a new drawing, or one started again)
 * it is one new polygon. Null while there are too few corners to close.
 */
export function withOuterRing(source: AreaGeometry | null | undefined, corners: readonly Corner[]): AreaGeometry | null {
  const drawn = polygonOf(corners);
  if (drawn === null) return null;
  const ring = drawn.coordinates[0] as number[][];
  if (source === null || source === undefined) return drawn;
  if (source.type === 'Polygon') return { type: 'Polygon', coordinates: [ring, ...source.coordinates.slice(1)] };
  const [first, ...others] = source.coordinates;
  return { type: 'MultiPolygon', coordinates: [[ring, ...(first ?? []).slice(1)], ...others] };
}

/** Whether a shape has a hole or a further polygon: something besides the one ring a person changes. */
export function hasOtherPieces(geometry: AreaGeometry | null | undefined): boolean {
  if (geometry === null || geometry === undefined) return false;
  if (geometry.type === 'Polygon') return geometry.coordinates.length > 1;
  return geometry.coordinates.length > 1 || (geometry.coordinates[0]?.length ?? 0) > 1;
}

/**
 * How long after a save settles the map waits before it looks at what the
 * caller did with it (a pin that was not kept goes back; the view may be
 * fitted again). Long enough for the page to draw what the save changed.
 */
export const SETTLE_MS = 150;

/** The corners as a closed GeoJSON polygon; null while there are too few to close. */
export function polygonOf(corners: readonly Corner[]): PolygonGeometry | null {
  if (corners.length < MIN_CORNERS) return null;
  const ring = corners.map((corner) => [corner[0], corner[1]]);
  ring.push([corners[0]![0], corners[0]![1]]);
  return { type: 'Polygon', coordinates: [ring] };
}

export function canClose(corners: readonly Corner[]): boolean {
  return corners.length >= MIN_CORNERS;
}

/** A corner added at the end. The same spot twice in a row (a double click) counts once. */
export function addCorner(corners: readonly Corner[], corner: Corner): Corner[] {
  if (sameCorner(corners[corners.length - 1], corner)) return [...corners];
  return [...corners, [corner[0], corner[1]]];
}

export function moveCorner(corners: readonly Corner[], index: number, corner: Corner): Corner[] {
  if (index < 0 || index >= corners.length) return [...corners];
  return corners.map((existing, at) => (at === index ? [corner[0], corner[1]] : existing));
}

/** A new corner halfway between this one and the next (the first, after the last). */
export function insertCorner(corners: readonly Corner[], index: number): Corner[] {
  const from = corners[index];
  const to = corners[(index + 1) % corners.length];
  if (from === undefined || to === undefined || corners.length < 2) return [...corners];
  const middle: Corner = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return [...corners.slice(0, index + 1), middle, ...corners.slice(index + 1)];
}

/**
 * A corner taken out. A closed shape keeps at least {@link MIN_CORNERS}: the
 * corner stays, and the caller says why.
 */
export function removeCorner(corners: readonly Corner[], index: number, closed: boolean): Corner[] {
  if (index < 0 || index >= corners.length) return [...corners];
  if (closed && corners.length <= MIN_CORNERS) return [...corners];
  return corners.filter((_, at) => at !== index);
}

/** How many corners a stored shape has, over every ring: what a list says of an area. */
export function pointCount(geometry: unknown): number {
  if (typeof geometry !== 'object' || geometry === null) return 0;
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return 0;
  const rings: unknown[] = type === 'Polygon' ? coordinates : type === 'MultiPolygon' ? coordinates.flat() : [];
  let count = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    const closed = ring.length > 1 && sameCorner(ring[0] as number[], ring[ring.length - 1] as number[]);
    count += closed ? ring.length - 1 : ring.length;
  }
  return count;
}

/** A value that can be drawn as an area. */
export function isAreaGeometry(value: unknown): value is AreaGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };
  return (type === 'Polygon' || type === 'MultiPolygon') && Array.isArray(coordinates) && pointCount(value) >= MIN_CORNERS;
}
