// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The map's pure half: pins that share a position, the view that fits, a
 * route's legs in words, the link to a phone's maps app, and an area's
 * geometry while it is drawn and changed.
 */
import { describe, expect, it } from 'vitest';

import {
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
