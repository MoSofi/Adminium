// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map's pure half: pins that share a position, the view that fits, a
 * route's legs in words, the link to a phone's maps app, and an area's
 * geometry while it is drawn and changed.
 */
import { describe, expect, it } from 'vitest';

import {
  PALETTE_DARK_INK,
  PALETTE_SHAPES,
  PALETTE_SIZE,
  areaLabelSpot,
  formatDuration,
  legDuration,
  mapsSiteHref,
  paletteIndex,
  routeTotal,
  MIN_CORNERS,
  SPREAD_GAP,
  addCorner,
  boundsOf,
  canClose,
  cornersOf,
  formatDistance,
  insertCorner,
  isAppleDevice,
  isAreaGeometry,
  legDistance,
  mapsAppHref,
  moveCorner,
  pointCount,
  polygonOf,
  removeCorner,
  spreadPins,
  straightLine,
  type Corner,
} from './map-shapes.js';

const TOWN = { lat: -22.9, lng: -47.06 };

describe('spreadPins', () => {
  it('leaves a pin that stands alone where it is', () => {
    expect(spreadPins([TOWN, { lat: 30, lng: 31 }])).toEqual([
      { dx: 0, dy: 0, shared: 1 },
      { dx: 0, dy: 0, shared: 1 },
    ]);
  });

  it('puts two that share a position on opposite sides of it', () => {
    expect(spreadPins([TOWN, { ...TOWN }])).toEqual([
      { dx: 0, dy: -16, shared: 2 },
      { dx: 0, dy: 16, shared: 2 },
    ]);
  });

  it('keeps every neighbour on the ring at least the gap apart, however many share it', () => {
    for (const n of [3, 5, 8, 20]) {
      const spread = spreadPins(Array.from({ length: n }, () => ({ ...TOWN })));
      expect(spread.every((pin) => pin.shared === n)).toBe(true);
      for (let i = 0; i < n; i += 1) {
        const a = spread[i]!;
        const b = spread[(i + 1) % n]!;
        // Rounded to whole pixels, so a pixel of slack.
        expect(Math.hypot(a.dx - b.dx, a.dy - b.dy)).toBeGreaterThanOrEqual(SPREAD_GAP - 1.5);
      }
      // No two pins on one spot.
      expect(new Set(spread.map((pin) => `${pin.dx},${pin.dy}`)).size).toBe(n);
    }
  });

  it('is the same ring for the same input, and groups only what truly shares a position', () => {
    const input = [TOWN, { lat: 30, lng: 31 }, { ...TOWN }, { lat: -22.9, lng: -47.0601 }];
    expect(spreadPins(input)).toEqual(spreadPins(input));
    expect(spreadPins(input).map((pin) => pin.shared)).toEqual([2, 1, 2, 1]);
  });
});

describe('boundsOf', () => {
  it('is the box around every point, area and line', () => {
    const area = { geometry: { type: 'Polygon' as const, coordinates: [[[10, 10], [12, 10], [12, 13], [10, 10]]] } };
    expect(boundsOf([{ lat: 1, lng: 2 }, { lat: -3, lng: 4 }], [area], { type: 'LineString', coordinates: [[-5, 0]] })).toEqual([[-5, -3], [12, 13]]);
  });

  it('is null when there is nothing to fit', () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([{ lat: Number.NaN, lng: 1 }])).toBeNull();
  });
});

describe('legDistance', () => {
  it('is unknown — never 0 — when a leg has no length', () => {
    expect(legDistance({ distanceM: null, durationS: null, estimate: true, unknown: true })).toEqual({ kind: 'unknown' });
    expect(legDistance({ distanceM: null, durationS: null, estimate: false })).toEqual({ kind: 'unknown' });
    // Marked unknown even with a figure beside it.
    expect(legDistance({ distanceM: 0, durationS: null, estimate: true, unknown: true })).toEqual({ kind: 'unknown' });
    expect(legDistance(undefined)).toEqual({ kind: 'unknown' });
  });

  it('says "about" for a straight line and the figure for a road', () => {
    expect(legDistance({ distanceM: 81_240, durationS: null, estimate: true })).toEqual({ kind: 'about', value: 81.2, unit: 'kilometer' });
    expect(legDistance({ distanceM: 61_900, durationS: 3_100, estimate: false })).toEqual({ kind: 'exact', value: 61.9, unit: 'kilometer' });
  });

  it('keeps short legs in metres or feet, long ones whole', () => {
    expect(legDistance({ distanceM: 847, durationS: null, estimate: false })).toEqual({ kind: 'exact', value: 850, unit: 'meter' });
    expect(legDistance({ distanceM: 234_567, durationS: null, estimate: false })).toEqual({ kind: 'exact', value: 235, unit: 'kilometer' });
    expect(legDistance({ distanceM: 100, durationS: null, estimate: false }, 'mi')).toEqual({ kind: 'exact', value: 330, unit: 'foot' });
    expect(legDistance({ distanceM: 16_093.44, durationS: null, estimate: true }, 'mi')).toEqual({ kind: 'about', value: 10, unit: 'mile' });
  });

  it('formats in the reader\'s language', () => {
    expect(formatDistance({ kind: 'exact', value: 81.2, unit: 'kilometer' }, 'en-US')).toBe('81.2 km');
    expect(formatDistance({ kind: 'exact', value: 81.2, unit: 'kilometer' }, 'de-DE')).toBe('81,2 km');
  });
});

describe('straightLine', () => {
  it('joins the points in order, as lng/lat', () => {
    expect(straightLine([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }])).toEqual({ type: 'LineString', coordinates: [[2, 1], [4, 3]] });
  });
});

describe('mapsAppHref', () => {
  it('is a geo: link wherever the device understands one', () => {
    expect(mapsAppHref({ lat: 30.123456789, lng: 31.5, name: 'Bilbeis' }, false)).toBe('geo:30.123457,31.500000?q=30.123457,31.500000(Bilbeis)');
    expect(mapsAppHref({ lat: 1, lng: 2 }, false)).toBe('geo:1.000000,2.000000?q=1.000000,2.000000');
  });

  it('is Apple\'s maps address on Apple devices, with the name escaped', () => {
    expect(mapsAppHref({ lat: -22.9, lng: -47.06, name: 'São José & Co' }, true)).toBe('https://maps.apple.com/?ll=-22.900000,-47.060000&q=S%C3%A3o%20Jos%C3%A9%20%26%20Co');
  });

  it('knows an iPhone, and an iPad that says it is a Mac', () => {
    expect(isAppleDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(true);
    expect(isAppleDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true);
    expect(isAppleDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false);
    expect(isAppleDevice('Mozilla/5.0 (Linux; Android 14)', 5)).toBe(false);
  });
});

describe('an area\'s geometry', () => {
  const corners: Corner[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const square = { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

  it('reads the corners of a polygon without the closing one, and of a multi-polygon\'s first', () => {
    expect(cornersOf(square)).toEqual(corners);
    expect(cornersOf({ type: 'MultiPolygon', coordinates: [square.coordinates, [[[5, 5], [6, 5], [6, 6], [5, 5]]]] })).toEqual(corners);
    expect(cornersOf(null)).toEqual([]);
  });

  it('closes the corners into a polygon once there are three', () => {
    expect(polygonOf(corners)).toEqual(square);
    expect(polygonOf(corners.slice(0, 2))).toBeNull();
    expect(canClose(corners.slice(0, MIN_CORNERS))).toBe(true);
    expect(canClose(corners.slice(0, MIN_CORNERS - 1))).toBe(false);
  });

  it('round-trips: the corners of the polygon of some corners are those corners', () => {
    expect(cornersOf(polygonOf(corners))).toEqual(corners);
  });

  it('adds a corner at the end, and a double click once', () => {
    expect(addCorner(corners, [2, 2])).toEqual([...corners, [2, 2]]);
    expect(addCorner(corners, [0, 1])).toEqual(corners);
  });

  it('moves one corner and leaves the rest', () => {
    expect(moveCorner(corners, 1, [5, 5])).toEqual([[0, 0], [5, 5], [1, 1], [0, 1]]);
    expect(moveCorner(corners, 9, [5, 5])).toEqual(corners);
  });

  it('adds a corner halfway to the next, and after the last halfway to the first', () => {
    expect(insertCorner(corners, 0)).toEqual([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]]);
    expect(insertCorner(corners, 3)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.5]]);
  });

  it('removes a corner, and keeps three in a closed shape', () => {
    expect(removeCorner(corners, 3, true)).toEqual([[0, 0], [1, 0], [1, 1]]);
    const three = corners.slice(0, 3);
    expect(removeCorner(three, 0, true)).toEqual(three);
    // While still drawing, any corner can go.
    expect(removeCorner(three, 0, false)).toEqual([[1, 0], [1, 1]]);
  });

  it('never changes the corners it was given', () => {
    const before = JSON.stringify(corners);
    addCorner(corners, [9, 9]);
    moveCorner(corners, 0, [9, 9]);
    insertCorner(corners, 0);
    removeCorner(corners, 0, true);
    expect(JSON.stringify(corners)).toBe(before);
  });

  it('counts the points of a stored shape over every ring', () => {
    expect(pointCount(square)).toBe(4);
    expect(pointCount({ type: 'MultiPolygon', coordinates: [square.coordinates, [[[5, 5], [6, 5], [6, 6], [5, 5]]]] })).toBe(7);
    expect(pointCount(null)).toBe(0);
    expect(pointCount({ type: 'Point', coordinates: [1, 2] })).toBe(0);
  });

  it('tells a drawable area from anything else', () => {
    expect(isAreaGeometry(square)).toBe(true);
    expect(isAreaGeometry({ type: 'Polygon', coordinates: [[[0, 0], [1, 1], [0, 0]]] })).toBe(false);
    expect(isAreaGeometry('POLYGON((0 0))')).toBe(false);
  });
});

// ── a shape of several pieces, and a view across the date line ─────────────

import * as shapes from './map-shapes.js';

describe('a shape with holes or several pieces, while one ring is changed', () => {
  const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const hole = [[1, 1], [2, 1], [2, 2], [1, 1]];
  const island = [[[10, 10], [11, 10], [11, 11], [10, 10]]];
  const moved: shapes.Corner[] = [[0, 0], [5, 0], [4, 4], [0, 4]];
  const movedRing = [[0, 0], [5, 0], [4, 4], [0, 4], [0, 0]];

  it('puts the changed ring back into a polygon and keeps its holes', () => {
    expect(shapes.withOuterRing({ type: 'Polygon', coordinates: [outer, hole] }, moved)).toEqual({ type: 'Polygon', coordinates: [movedRing, hole] });
  });

  it('puts the changed ring back into the first piece of several and keeps the rest', () => {
    expect(shapes.withOuterRing({ type: 'MultiPolygon', coordinates: [[outer, hole], island] }, moved)).toEqual({
      type: 'MultiPolygon',
      coordinates: [[movedRing, hole], island],
    });
  });

  it('is one new polygon when there is no shape to keep, and nothing while there are too few corners', () => {
    expect(shapes.withOuterRing(null, moved)).toEqual({ type: 'Polygon', coordinates: [movedRing] });
    expect(shapes.withOuterRing({ type: 'Polygon', coordinates: [outer, hole] }, moved.slice(0, 2))).toBeNull();
  });

  it('never changes the shape it was given', () => {
    const source = { type: 'MultiPolygon' as const, coordinates: [[outer, hole], island] };
    const before = JSON.stringify(source);
    shapes.withOuterRing(source, moved);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('says whether a shape has more than the one ring a person changes', () => {
    expect(shapes.hasOtherPieces({ type: 'Polygon', coordinates: [outer] })).toBe(false);
    expect(shapes.hasOtherPieces({ type: 'Polygon', coordinates: [outer, hole] })).toBe(true);
    expect(shapes.hasOtherPieces({ type: 'MultiPolygon', coordinates: [[outer]] })).toBe(false);
    expect(shapes.hasOtherPieces({ type: 'MultiPolygon', coordinates: [[outer], island] })).toBe(true);
    expect(shapes.hasOtherPieces(null)).toBe(false);
  });
});

describe('the view across the date line', () => {
  it('frames the two sides of it, not the whole world between them', () => {
    // Fiji-like: one place just west of the line, one just east. The short way round is two degrees.
    expect(shapes.boundsOf([{ lat: -17, lng: 179 }, { lat: -18, lng: -179 }])).toEqual([[179, -18], [181, -17]]);
  });

  it('leaves a wide view that does not cross the line as it is', () => {
    expect(shapes.boundsOf([{ lat: 0, lng: -100 }, { lat: 10, lng: 60 }])).toEqual([[-100, 0], [60, 10]]);
    expect(shapes.boundsOf([{ lat: 0, lng: -60 }, { lat: 0, lng: 0 }, { lat: 0, lng: 130 }])).toEqual([[-60, 0], [130, 0]]);
    // Three places a third of the world apart: the widest empty stretch is left out, wherever it is.
    expect(shapes.boundsOf([{ lat: 0, lng: -170 }, { lat: 0, lng: 0 }, { lat: 0, lng: 170 }])).toEqual([[0, 0], [190, 0]]);
  });

  it('does the same for an area and a line that cross it', () => {
    const area = { geometry: { type: 'Polygon' as const, coordinates: [[[178, 0], [-178, 0], [-178, 2], [178, 0]]] } };
    expect(shapes.boundsOf([], [area])).toEqual([[178, 0], [182, 2]]);
    expect(shapes.boundsOf([], [], { type: 'LineString', coordinates: [[175, 1], [-175, 3]] })).toEqual([[175, 1], [185, 3]]);
  });
});

describe('a route’s drive time and its whole way', () => {
  it('a leg has a drive time only where the routing server gave one', () => {
    expect(legDuration({ distanceM: 1000, durationS: 120, estimate: false })).toBe(120);
    expect(legDuration({ distanceM: 1000, durationS: 0, estimate: false })).toBe(0);
    expect(legDuration({ distanceM: 1000, durationS: null, estimate: true })).toBeNull();
    expect(legDuration({ distanceM: null, durationS: 120, estimate: true, unknown: true })).toBeNull();
    expect(legDuration({ distanceM: 1000, durationS: -5, estimate: false })).toBeNull();
    expect(legDuration({ distanceM: 1000, durationS: Number.NaN, estimate: false })).toBeNull();
    expect(legDuration({ distanceM: 1000, durationS: '120' as unknown as number, estimate: false })).toBeNull();
    expect(legDuration(undefined)).toBeNull();
  });

  it('writes a drive time to the minute, in the reader’s language, and never as nothing', () => {
    expect(formatDuration(4320, 'en-US')).toBe('1 hr 12 min');
    expect(formatDuration(3600, 'en-US')).toBe('1 hr');
    expect(formatDuration(2700, 'en-US')).toBe('45 min');
    expect(formatDuration(20, 'en-US')).toBe('1 min');
    expect(formatDuration(0, 'en-US')).toBe('1 min');
    expect(formatDuration(4320, 'de-DE')).toBe('1 Std. 12 Min.');
    expect(formatDuration(4320, 'ar-EG')).toMatch(/١/);
    // A language tag Intl does not know: the plain figures.
    expect(formatDuration(4320, 'not a tag')).toBe('1 h 12 min');
  });

  it('sums the whole way only when every leg between the stops has a length', () => {
    const road = { distanceM: 1000, durationS: 60, estimate: false };
    const straight = { distanceM: 500, durationS: null, estimate: true };
    expect(routeTotal([road, road], 3)).toEqual({ distanceM: 2000, durationS: 120, estimate: false });
    // One straight leg: the whole is an estimate, and there is no time for it.
    expect(routeTotal([road, straight], 3)).toEqual({ distanceM: 1500, durationS: null, estimate: true });
    // One unknown, one missing, no legs at all, one stop: no total.
    expect(routeTotal([road, { distanceM: null, durationS: null, estimate: true, unknown: true }], 3)).toBeNull();
    expect(routeTotal([road], 3)).toBeNull();
    expect(routeTotal([], 2)).toBeNull();
    expect(routeTotal([], 1)).toBeNull();
    // A leg more than the stops need is not counted.
    expect(routeTotal([road, road, road], 3)?.distanceM).toBe(2000);
  });
});

describe('the map’s colours', () => {
  it('takes a whole number from 0 up, round the eight, and nothing else', () => {
    expect(PALETTE_SIZE).toBe(8);
    expect([0, 7, 8, 17].map(paletteIndex)).toEqual([0, 7, 0, 1]);
    for (const bad of [-1, 1.5, Number.NaN, Infinity, '2', null, undefined, {}, 'red; background: url(//x)']) expect(paletteIndex(bad)).toBeNull();
    expect(PALETTE_SHAPES).toHaveLength(PALETTE_SIZE);
    expect(PALETTE_DARK_INK).toHaveLength(PALETTE_SIZE);
    expect(new Set(PALETTE_SHAPES).size).toBe(PALETTE_SIZE);
  });
});

describe('where an area’s name is written', () => {
  const polygon = (ring: number[][]) => ({ type: 'Polygon' as const, coordinates: [ring] });

  it('the middle of a plain shape, with the box the name has to fit in', () => {
    expect(areaLabelSpot(polygon([[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]))).toEqual({ at: [2, 1], box: [[0, 0], [4, 2]] });
  });

  it('inside the shape, for a shape bent round its own middle', () => {
    // An L: its centre of mass is in the notch.
    const spot = areaLabelSpot(polygon([[0, 0], [6, 0], [6, 1], [1, 1], [1, 6], [0, 6], [0, 0]]))!;
    const [lng, lat] = spot.at;
    const inside = (lng >= 0 && lng <= 6 && lat >= 0 && lat <= 1) || (lng >= 0 && lng <= 1 && lat >= 0 && lat <= 6);
    expect(inside).toBe(true);
  });

  it('not in a hole', () => {
    const ring = { type: 'Polygon' as const, coordinates: [[[0, 0], [6, 0], [6, 6], [0, 6], [0, 0]], [[1, 1], [5, 1], [5, 5], [1, 5], [1, 1]]] };
    const [lng, lat] = areaLabelSpot(ring)!.at;
    expect(lng > 1 && lng < 5 && lat > 1 && lat < 5).toBe(false);
    expect(lng >= 0 && lng <= 6 && lat >= 0 && lat <= 6).toBe(true);
  });

  it('on the largest piece of several', () => {
    const pieces = { type: 'MultiPolygon' as const, coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]], [[[10, 10], [14, 10], [14, 14], [10, 14], [10, 10]]]] };
    expect(areaLabelSpot(pieces)?.at).toEqual([12, 12]);
  });

  it('across the date line, on the shape and not on the far side of the world', () => {
    const spot = areaLabelSpot(polygon([[178, 0], [-178, 0], [-178, 2], [178, 2], [178, 0]]))!;
    expect(spot.at).toEqual([180, 1]);
    expect(spot.box).toEqual([[178, 0], [182, 2]]);
  });

  it('nothing for a shape with nothing to write on', () => {
    expect(areaLabelSpot(null)).toBeNull();
    expect(areaLabelSpot(polygon([[0, 0], [1, 1]]))).toBeNull();
    expect(areaLabelSpot({ type: 'Polygon', coordinates: 'x' } as never)).toBeNull();
    expect(areaLabelSpot(polygon([[0, 0], [Number.NaN, 1], ['a', 2] as never, [1, 1]]))).toBeNull();
  });
});

describe('a link out to a map on a desk', () => {
  it('names OpenStreetMap’s own site, with the position to about a metre and nothing else', () => {
    expect(mapsSiteHref({ lat: 53.800834, lng: -1.549123 })).toBe('https://www.openstreetmap.org/?mlat=53.80083&mlon=-1.54912#map=16/53.80083/-1.54912');
    // Whatever else the point holds does not travel.
    expect(mapsSiteHref({ lat: 1, lng: 2, name: 'Cobalt Legal' } as { lat: number; lng: number })).not.toContain('Cobalt');
  });
});
