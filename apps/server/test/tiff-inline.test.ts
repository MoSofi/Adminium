// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TIFF, by its bytes, and what opens inline: a TIFF is found in either byte
 * order and never by its name alone; only PNG, JPEG, WebP, GIF and PDF open
 * on the page, and every other kind (SVG, TIFF, HEIC, video, anything added
 * later) is a download.
 */
import { describe, expect, it } from 'vitest';

import { mimesForKeys, sniff, SNIFF_TYPE_KEYS } from '../src/files/sniff.js';
import { dispositionOf, opensInline } from '../src/public-api/private-file.js';

describe('a TIFF, by its bytes', () => {
  it('is found little- and big-endian, and a name alone makes none', () => {
    expect(SNIFF_TYPE_KEYS).toContain('tiff');
    for (const head of [[0x49, 0x49, 0x2a, 0x00], [0x4d, 0x4d, 0x00, 0x2a]]) {
      expect(sniff(Buffer.concat([Buffer.from(head), Buffer.alloc(40)]), 'scan.bin')).toEqual({ ok: true, type: { key: 'tiff', mime: 'image/tiff', ext: 'tif' } });
    }
    expect(sniff(Buffer.from('II not a tiff at all'), 'scan.tif').ok).toBe(false);
    expect(sniff(Buffer.from([0x49, 0x49, 0x00, 0x2a, 0, 0]), 'scan.tif').ok).toBe(false);
    expect(mimesForKeys(['tiff'])).toEqual(['image/tiff']);
  });
});

describe('what opens inline', () => {
  it('is PNG, JPEG, WebP, GIF and PDF only', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'IMAGE/PNG; charset=binary']) expect(opensInline(mime)).toBe(true);
    for (const mime of ['image/tiff', 'image/svg+xml', 'image/heic', 'image/bmp', 'video/mp4', 'text/plain', 'application/zip', 'image/x-icon']) expect(opensInline(mime)).toBe(false);
    expect(dispositionOf({ filename: 'scan.tif', mime: 'image/tiff' })).toMatch(/^attachment; filename="scan\.tif"/);
    expect(dispositionOf({ filename: 'logo.png', mime: 'image/png' })).toMatch(/^inline;/);
  });
});
