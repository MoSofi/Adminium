// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The QR codes Adminium draws: the modules of a ticket's code, held to a
 * fixture the browser client holds too; a PNG that is valid, one bit a
 * pixel, opaque, the same bytes every time, and that an independent reader
 * decodes to exactly the code — an alphanumeric code, a share token, text
 * beyond ASCII; and no text too long or empty to carry.
 */
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

import { QrTextRefused, qrMatrix, qrPng, qrPngDataUrl, qrPngSize, qrRows, qrSvg } from '../src/qr/index.js';
import { readQrPng } from './qr-decode.helpers.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/qr/codes.json', import.meta.url), 'utf8')) as Record<string, string[]>;

describe('a QR code of a short text', () => {
  it('draws the fixture modules for the two ticket codes', () => {
    for (const [text, rows] of Object.entries(FIXTURE)) expect(qrRows(text)).toEqual(rows);
    expect(qrMatrix('K7QX-M2PD')).toHaveLength(21);
  });

  it('writes a valid, opaque, one-bit PNG, the same bytes every time', () => {
    const png = qrPng('K7QX-M2PD');
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // IHDR: 232 × 232, bit depth 1, greyscale (no alpha).
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20), png[24], png[25]]).toEqual([232, 232, 1, 0]);
    expect(qrPngSize('K7QX-M2PD')).toBe(232);
    // Every chunk's CRC is right.
    for (let at = 8; at < png.length; ) {
      const length = png.readUInt32BE(at);
      const body = png.subarray(at + 4, at + 8 + length);
      expect(png.readUInt32BE(at + 8 + length)).toBe(crc32(body) >>> 0);
      at += 12 + length;
    }
    // Opaque white around it: the corner pixel is white, every pixel's alpha full.
    const image = PNG.sync.read(png);
    expect([image.data[0], image.data[3]]).toEqual([255, 255]);
    expect(image.data.filter((_, i) => i % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect(qrPng('K7QX-M2PD').equals(png)).toBe(true);
    expect(qrPngDataUrl('K7QX-M2PD')).toBe(`data:image/png;base64,${png.toString('base64')}`);
  });

  it('reads back as exactly its text: codes, a share token, and text beyond ASCII', () => {
    for (const text of ['K7QX-M2PD', 'R4FN-7HCW', 'Q9ZRT2MKXW4VB7HD', 'Café Ł 雪', 'x'.repeat(64)]) {
      expect(readQrPng(qrPng(text))).toBe(text);
    }
  });

  it('draws an SVG of the code without its text', () => {
    const svg = qrSvg('K7QX-M2PD', { size: 116 });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).not.toContain('K7QX');
  });

  it('refuses an empty text, and one longer than 64 bytes', () => {
    expect(() => qrMatrix('')).toThrow(QrTextRefused);
    expect(() => qrPng('é'.repeat(33))).toThrow(QrTextRefused);
  });
});
