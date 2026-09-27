// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The browser's QR code of a ticket: the same modules the server draws into
 * the ticket's email (one fixture, held by both packages), an SVG of exactly
 * those modules on white, and no text too long or empty to carry.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { qrMatrix, qrSvg, QR_QUIET } from '../src/qr.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/qr-codes.json', import.meta.url), 'utf8')) as Record<string, string[]>;

describe('a QR code drawn in the browser', () => {
  it('draws the same modules as the server, for each fixture code', () => {
    for (const [text, rows] of Object.entries(FIXTURE)) {
      expect(qrMatrix(text).map((row) => row.map((dark) => (dark ? '1' : '0')).join(''))).toEqual(rows);
    }
  });

  it('draws an SVG of exactly the dark modules, on white, with a quiet zone', () => {
    const svg = qrSvg('K7QX-M2PD', { size: 180 });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" width="180" height="180"')).toBe(true);
    expect(svg).toContain('<rect width="29" height="29" fill="#fff"/>');
    // Paint the path's runs back into a grid: it is the fixture.
    const d = /d="([^"]*)"/.exec(svg)![1]!;
    const grid = Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => '0'));
    for (const [, x, y, run] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(run); i += 1) grid[Number(y) - QR_QUIET]![Number(x) - QR_QUIET + i] = '1';
    }
    expect(grid.map((row) => row.join(''))).toEqual(FIXTURE['K7QX-M2PD']);
    expect(svg).not.toContain('K7QX');
  });

  it('refuses an empty text and one longer than 64 bytes', () => {
    expect(() => qrMatrix('')).toThrow(RangeError);
    expect(() => qrMatrix('x'.repeat(65))).toThrow(RangeError);
    expect(qrMatrix('x'.repeat(64)).length).toBeGreaterThan(21);
  });
});
