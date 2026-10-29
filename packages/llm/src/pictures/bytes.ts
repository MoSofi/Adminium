// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A made picture's bytes, checked before they are kept.
 *
 * The base64 a service answers with is checked character by character and
 * its decoded size worked out from its length BEFORE it is decoded. The
 * bytes must then be a JPEG, PNG or WebP by their first bytes, and the
 * picture's width and height, read from its header (never decoded), must
 * each be at most {@link MADE_PICTURE_SIDE_MAX}. Nothing is re-encoded.
 * Browser-safe: no `Buffer`.
 */
import { MADE_PICTURE_MAX_BYTES, MADE_PICTURE_SIDE_MAX, type MadePicture } from './types.js';

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** The size a base64 string decodes to, worked out from its length. */
export function base64Size(text: string): number {
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return Math.floor((text.length * 3) / 4) - padding;
}

/** The bytes of a base64 string, or null when it is not one or would be larger than `maxBytes`. */
export function decodeBase64(text: unknown, maxBytes: number = MADE_PICTURE_MAX_BYTES): Uint8Array | null {
  if (typeof text !== 'string' || text.length === 0 || text.length % 4 !== 0) return null;
  if (base64Size(text) > maxBytes) return null;
  if (!BASE64.test(text)) return null;
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
const u32be = (b: Uint8Array, at: number): number => (((b[at] ?? 0) << 24) >>> 0) + (((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0));
const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A JPEG's size, from its first start-of-frame marker. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1] ?? 0;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers with no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = u16be(b, at + 2);
    if (length < 2) return null;
    // Start of frame: every SOFn but DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

/** A WebP's size, from its first chunk (lossy, lossless or extended). */
function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ' && b.length >= 30) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** What a picture's bytes are, and its size; null when it is none of the three or its header says nothing. */
export function pictureInfo(b: Uint8Array): Omit<MadePicture, 'bytes'> | null {
  if (b.length >= 24 && PNG_SIGNATURE.every((byte, i) => b[i] === byte) && ascii(b, 12, 4) === 'IHDR') {
    return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const size = jpegSize(b);
    return size === null ? null : { type: 'image/jpeg', ...size };
  }
  if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const size = webpSize(b);
    return size === null ? null : { type: 'image/webp', ...size };
  }
  return null;
}

/** The bytes as a made picture, or null when they fail any check: type, size, sides. */
export function checkPicture(bytes: Uint8Array | null, maxBytes: number = MADE_PICTURE_MAX_BYTES): MadePicture | null {
  if (bytes === null || bytes.length === 0 || bytes.length > maxBytes) return null;
  const info = pictureInfo(bytes);
  if (info === null) return null;
  if (info.width < 1 || info.height < 1 || info.width > MADE_PICTURE_SIDE_MAX || info.height > MADE_PICTURE_SIDE_MAX) return null;
  return { bytes, ...info };
}
