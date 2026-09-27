// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A QR code as a PNG for email: Gmail and Outlook strip `data:` images and
 * inline SVG, and show an attached image a message points at by its
 * Content-ID. One bit per pixel, grey, opaque WHITE behind it — never
 * transparent: a mail client's dark mode inverts transparent pixels, and an
 * inverted code fails some scanners. Eight pixels a module and a quiet zone
 * of four, drawn at half size (116 px for the smallest code) so it stays
 * sharp on a phone. The bytes depend only on the text and Node's zlib.
 */
import { crc32, deflateSync } from 'node:zlib';

import { QR_QUIET, qrMatrix } from './encode.js';

/** Pixels per module. */
export const QR_PNG_SCALE = 8;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, tail]);
}

/** The width and height of a code's PNG, in pixels. */
export function qrPngSize(text: string): number {
  return (qrMatrix(text).length + 2 * QR_QUIET) * QR_PNG_SCALE;
}

/** The QR code of `text` as PNG bytes. */
export function qrPng(text: string): Buffer {
  const modules = qrMatrix(text);
  const size = (modules.length + 2 * QR_QUIET) * QR_PNG_SCALE;
  const stride = Math.ceil(size / 8);
  // Each row: filter 0, then the pixels, eight to a byte, 1 = white.
  const raw = Buffer.alloc((stride + 1) * size, 0);
  for (let y = 0; y < size; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    const my = Math.floor(y / QR_PNG_SCALE) - QR_QUIET;
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / QR_PNG_SCALE) - QR_QUIET;
      const dark = my >= 0 && my < modules.length && mx >= 0 && mx < modules.length && modules[my]![mx] === true;
      if (!dark) raw[row + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering, filter 0 on every row
  header[12] = 0; // no interlace
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The PNG as a `data:` URL (a document's value; never an email's). */
export function qrPngDataUrl(text: string): string {
  return `data:image/png;base64,${qrPng(text).toString('base64')}`;
}
