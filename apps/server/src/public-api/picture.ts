// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PICTURE ANYONE MAY SEE — a dish's photo, a show's poster — made safe to
 * hand to every visitor, once, and kept.
 *
 * Staff upload what their camera made. Before a stranger's browser gets it:
 *
 *  - the bytes are read again and must be what the file says it is — PNG,
 *    JPEG, WebP or GIF, nothing else (SVG is a document that can carry script,
 *    and is never served) — so a file swapped in its destination is refused;
 *  - its size is read from the image itself, and more than 8192 pixels on a
 *    side is refused: a picture that unpacks into gigabytes would stall the
 *    visitor's device;
 *  - what a camera writes beside the picture is taken out: the place it was
 *    taken (a kitchen, a home), the device, comments, XMP. JPEG keeps its JFIF,
 *    colour profile and Adobe blocks; PNG its pixels and colour chunks; WebP
 *    its image, animation and colour profile; GIF its frames and its loop.
 *
 * A picture is cleaned ONCE and kept beside its file by its file id and this
 * pipeline's version (`picture-store.ts`; a new file id is a new picture:
 * files are never rewritten), then streamed from there. The entity tag is the
 * hash of the bytes served — never of the original, which would confirm a
 * guess at it. At most two pictures are cleaned at once, and one per
 * address; one past that waits for nobody and is told to come back.
 *
 * Every refusal is the caller's one 404: which rule said no is nobody's
 * business.
 */
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { rateAddress } from './limiter.js';

/** Bumped when the cleaning changes: a new version is a new entity tag, and the cache starts again. */
export const PICTURE_PIPELINE = 'p2';

/** The largest picture served to the public: a phone photo, resized for the web, is far smaller. */
export const PICTURE_MAX_BYTES = 2 * 1024 * 1024;

/** The most pixels on either side. */
export const PICTURE_MAX_SIDE = 8192;

/** How many pictures are cleaned at once, at most. */
export const PICTURE_CLEANING_AT_ONCE = 2;

export type PictureMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const EXTENSIONS: Record<PictureMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Whether a stored file's (sniffed) type is one a picture may be. */
export function isPictureMime(mime: string): mime is PictureMime {
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, mime.toLowerCase().split(';')[0]!.trim());
}

/** A picture as served: the cleaned bytes and their tag. */
export interface CleanPicture {
  bytes: Buffer;
  mime: PictureMime;
  etag: string;
  width: number;
  height: number;
}

/** Why a picture is not served (logged, never told). */
export class PictureRefused extends Error {
  override readonly name = 'PictureRefused';
}

const refuse = (why: string): never => {
  throw new PictureRefused(why);
};

// ─── the formats ──────────────────────────────────────────────────────────

/** The most frames an animated picture may carry (GIF, WebP, PNG). */
export const PICTURE_MAX_FRAMES = 500;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/**
 * The chunks a PNG keeps: its pixels, palette and transparency, its colour
 * chunks and physical size, and an animation's frames. Anything else — text,
 * time, Exif, a content credential (`caBX`), any private chunk — goes: a
 * chunk this list does not know is one it cannot vouch for.
 */
const PNG_KEPT = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'acTL', 'fcTL', 'fdAT']);

function cleanPng(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 8 + 25 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) refuse('not a PNG');
  const kept: Buffer[] = [PNG_SIGNATURE];
  let at = 8;
  let width = 0;
  let height = 0;
  let ended = false;
  let first = true;
  let frames = 0;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    const end = at + 12 + length;
    if (end > bytes.length) refuse('a PNG chunk runs past the end');
    if (first) {
      if (type !== 'IHDR' || length !== 13) refuse('a PNG without its header first');
      width = bytes.readUInt32BE(at + 8);
      height = bytes.readUInt32BE(at + 12);
      first = false;
    }
    if (type === 'fcTL') {
      // A frame of an animation: inside the picture, and not one too many.
      if (length < 26) refuse('a PNG frame too short');
      const [w, h, x, y] = [bytes.readUInt32BE(at + 12), bytes.readUInt32BE(at + 16), bytes.readUInt32BE(at + 20), bytes.readUInt32BE(at + 24)];
      if (w < 1 || h < 1 || x + w > width || y + h > height) refuse('a PNG frame outside the picture');
      if ((frames += 1) > PICTURE_MAX_FRAMES) refuse('a PNG with too many frames');
    }
    if (PNG_KEPT.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) refuse('a PNG without its end');
  return { bytes: Buffer.concat(kept), width, height };
}

/**
 * Whether a JPEG block is kept: JFIF, a colour profile and Adobe's colour
 * transform — each by what it says it is (an APP2 that is a multi-picture
 * index, `MPF`, is not a colour profile) — and every block that is not an
 * application block or a comment.
 */
function jpegKeeps(marker: number, body: Buffer): boolean {
  if (marker === 0xfe) return false; // a comment
  if (marker < 0xe0 || marker > 0xef) return true;
  const says = (text: string) => body.toString('latin1', 0, text.length) === text;
  if (marker === 0xe0) return says('JFIF\0');
  if (marker === 0xe2) return says('ICC_PROFILE\0');
  if (marker === 0xee) return says('Adobe');
  return false;
}

/** The start-of-frame markers, which carry the picture's size. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * A JPEG, block by block, up to its end (EOI) and not a byte after: what a
 * camera appends after the picture (a second picture with a place of its
 * own, a phone maker's trailer, a page someone pasted on) goes with it.
 * Between the scans of a progressive picture, the same blocks go as before
 * the first.
 */
function cleanJpeg(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) refuse('not a JPEG');
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  let scans = 0;
  for (;;) {
    if (at + 2 > bytes.length) refuse('a JPEG without its end');
    if (bytes[at] !== 0xff) refuse('a JPEG block out of place');
    const marker = bytes[at + 1]!;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) {
      if (scans === 0) refuse('a JPEG that ends before its image');
      kept.push(bytes.subarray(at, at + 2));
      break;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) refuse('a JPEG block out of place');
    if (at + 4 > bytes.length) refuse('a JPEG block runs past the end');
    const length = bytes.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) refuse('a JPEG block runs past the end');
    if (JPEG_FRAMES.has(marker)) {
      if (length < 7) refuse('a JPEG frame too short');
      height = bytes.readUInt16BE(at + 5);
      width = bytes.readUInt16BE(at + 7);
    }
    if (marker === 0xda) {
      if (width === 0 || height === 0) refuse('a JPEG scan before its frame');
      if ((scans += 1) > PICTURE_MAX_FRAMES) refuse('a JPEG with too many scans');
      // The scan's header, then its coded data up to the next block: a 0xFF in the data is followed by 0x00 or a restart.
      let p = end;
      for (;;) {
        if (p + 1 >= bytes.length) refuse('a JPEG scan runs past the end');
        if (bytes[p] !== 0xff) {
          p += 1;
          continue;
        }
        const next = bytes[p + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          p += 2;
          continue;
        }
        if (next === 0xff) {
          p += 1;
          continue;
        }
        break;
      }
      kept.push(bytes.subarray(at, p));
      at = p;
      continue;
    }
    if (jpegKeeps(marker, bytes.subarray(at + 4, end))) kept.push(bytes.subarray(at, end));
    at = end;
  }
  if (width === 0 || height === 0) refuse('a JPEG without its size');
  return { bytes: Buffer.concat(kept), width, height };
}

/**
 * The chunks a WebP keeps: its image (lossy, lossless, alpha), the extended
 * header, an animation and its frames, and a colour profile. Exif, XMP and
 * any chunk this list does not know go.
 */
const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ANIM', 'ANMF', 'ICCP']);
/** The chunks inside an animation frame that are kept: its image. */
const WEBP_FRAME_KEPT = new Set(['VP8 ', 'VP8L', 'ALPH']);

/** The RIFF chunks of `data`, each with its type, its body and its whole bytes (padding included). */
function riffChunks(data: Buffer, what: string): { fourcc: string; body: Buffer; whole: Buffer }[] {
  const out: { fourcc: string; body: Buffer; whole: Buffer }[] = [];
  let at = 0;
  while (at + 8 <= data.length) {
    const fourcc = data.toString('latin1', at, at + 4);
    const size = data.readUInt32LE(at + 4);
    if (at + 8 + size > data.length) refuse(`a ${what} chunk runs past the end`);
    const end = Math.min(at + 8 + size + (size % 2), data.length);
    out.push({ fourcc, body: data.subarray(at + 8, at + 8 + size), whole: data.subarray(at, end) });
    at = end;
  }
  return out;
}

function riffChunk(fourcc: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, 'latin1');
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, body.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function cleanWebp(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') refuse('not a WebP');
  const chunks: Buffer[] = [];
  let width = 0;
  let height = 0;
  let canvas: { width: number; height: number } | null = null;
  let frames = 0;
  for (const { fourcc, body: data, whole } of riffChunks(bytes.subarray(12), 'WebP')) {
    const size = data.length;
    if (fourcc === 'VP8X') {
      if (size < 10) refuse('a WebP header too short');
      width = data.readUIntLE(4, 3) + 1;
      height = data.readUIntLE(7, 3) + 1;
      canvas = { width, height };
    } else if (fourcc === 'VP8 ' && width === 0) {
      if (size < 10 || data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) refuse('a WebP frame out of shape');
      width = data.readUInt16LE(6) & 0x3fff;
      height = data.readUInt16LE(8) & 0x3fff;
    } else if (fourcc === 'VP8L' && width === 0) {
      if (size < 5 || data[0] !== 0x2f) refuse('a WebP frame out of shape');
      const bits = data.readUInt32LE(1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    if (!WEBP_KEPT.has(fourcc)) continue;
    if (fourcc === 'ANMF') {
      // A frame of an animation: inside the canvas, not one too many, and only its image kept.
      if (canvas === null || size < 16) return refuse('a WebP frame out of shape');
      const x = data.readUIntLE(0, 3) * 2;
      const y = data.readUIntLE(3, 3) * 2;
      const w = data.readUIntLE(6, 3) + 1;
      const h = data.readUIntLE(9, 3) + 1;
      if (x + w > canvas.width || y + h > canvas.height) refuse('a WebP frame outside the picture');
      if ((frames += 1) > PICTURE_MAX_FRAMES) refuse('a WebP with too many frames');
      const inner = riffChunks(data.subarray(16), 'WebP frame').filter((chunk) => WEBP_FRAME_KEPT.has(chunk.fourcc));
      chunks.push(riffChunk('ANMF', Buffer.concat([data.subarray(0, 16), ...inner.map((chunk) => chunk.whole)])));
      continue;
    }
    const chunk = Buffer.from(whole);
    // The extended header says which chunks follow: Exif and XMP no longer do.
    if (fourcc === 'VP8X') chunk[8] = chunk[8]! & ~0x0c;
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return { bytes: Buffer.concat([head, body]), width, height };
}

/** The application blocks a GIF keeps: its loop. */
const GIF_KEPT_APPLICATIONS = new Set(['NETSCAPE2.0', 'ANIMEXTS1.0']);

/**
 * A GIF, block by block. Its size is the logical screen's, and every frame
 * must lie inside it: a browser grows the picture to a frame larger than
 * its screen, so a one-pixel screen with a 65535-pixel frame would unpack
 * into gigabytes.
 */
function cleanGif(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  const version = bytes.toString('latin1', 0, 6);
  if (bytes.length < 14 || (version !== 'GIF87a' && version !== 'GIF89a')) refuse('not a GIF');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  const packed = bytes[10]!;
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  if (at > bytes.length) refuse('a GIF colour table runs past the end');
  const kept: Buffer[] = [bytes.subarray(0, at)];
  let frames = 0;
  /** The end of a run of sub-blocks starting at `from`. */
  const subBlocks = (from: number): number => {
    let p = from;
    for (;;) {
      if (p >= bytes.length) refuse('a GIF block runs past the end');
      const size = bytes[p]!;
      p += 1 + size;
      if (size === 0) return p;
    }
  };
  for (;;) {
    if (at >= bytes.length) refuse('a GIF without its end');
    const introducer = bytes[at]!;
    if (introducer === 0x3b) {
      kept.push(bytes.subarray(at, at + 1));
      break;
    }
    if (introducer === 0x21) {
      const label = bytes[at + 1];
      const end = subBlocks(at + 2);
      let keep = label !== 0xfe; // a comment goes
      if (label === 0xff) {
        const size = bytes[at + 2] ?? 0;
        keep = GIF_KEPT_APPLICATIONS.has(bytes.toString('latin1', at + 3, at + 3 + Math.min(size, 11)));
      }
      if (keep) kept.push(bytes.subarray(at, end));
      at = end;
      continue;
    }
    if (introducer === 0x2c) {
      if (at + 10 > bytes.length) refuse('a GIF frame runs past the end');
      const [left, top, w, h] = [bytes.readUInt16LE(at + 1), bytes.readUInt16LE(at + 3), bytes.readUInt16LE(at + 5), bytes.readUInt16LE(at + 7)];
      if (w < 1 || h < 1 || left + w > width || top + h > height) refuse('a GIF frame outside the picture');
      if ((frames += 1) > PICTURE_MAX_FRAMES) refuse('a GIF with too many frames');
      const local = bytes[at + 9]!;
      let p = at + 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      p = subBlocks(p + 1); // the code size, then the image data
      kept.push(bytes.subarray(at, p));
      at = p;
      continue;
    }
    refuse('a GIF block out of place');
  }
  if (frames === 0) refuse('a GIF without a picture');
  return { bytes: Buffer.concat(kept), width, height };
}

/**
 * The picture a visitor is served: re-checked to be the type its file says,
 * no more than `PICTURE_MAX_SIDE` pixels a side, and without what the camera
 * wrote beside it. Throws `PictureRefused`.
 */
export function cleanPicture(bytes: Buffer, mime: string): CleanPicture {
  const type = mime.toLowerCase().split(';')[0]!.trim();
  if (!isPictureMime(type)) refuse(`${type} is not a picture served to the public`);
  const cleaned =
    type === 'image/png' ? cleanPng(bytes) : type === 'image/jpeg' ? cleanJpeg(bytes) : type === 'image/webp' ? cleanWebp(bytes) : cleanGif(bytes);
  if (cleaned.width < 1 || cleaned.height < 1 || cleaned.width > PICTURE_MAX_SIDE || cleaned.height > PICTURE_MAX_SIDE) {
    refuse(`${String(cleaned.width)}×${String(cleaned.height)} is not a picture size served`);
  }
  const etag = `"${PICTURE_PIPELINE}-${createHash('sha256').update(cleaned.bytes).digest('hex')}"`;
  return { bytes: cleaned.bytes, mime: type as PictureMime, etag, width: cleaned.width, height: cleaned.height };
}

/** The headers a picture is served with: anyone may show it, from any page, and cache it for a week. */
export function pictureHeaders(picture: Pick<CleanPicture, 'mime' | 'etag'>, column: string, length?: number): Record<string, string> {
  return {
    'content-type': picture.mime,
    ...(length === undefined ? {} : { 'content-length': String(length) }),
    // Never the name staff gave the file.
    'content-disposition': `inline; filename="${column.replace(/[^A-Za-z0-9_-]/g, '_')}.${EXTENSIONS[picture.mime]}"`,
    'content-security-policy': "default-src 'none'; sandbox",
    'x-content-type-options': 'nosniff',
    // Any page may show it: the server's default keeps a response to its own pages.
    'cross-origin-resource-policy': 'cross-origin',
    'access-control-allow-origin': '*',
    // A new picture is a new file id, and so a new address: this one never changes.
    'cache-control': 'public, max-age=604800, immutable',
    etag: picture.etag,
    'referrer-policy': 'no-referrer',
  };
}

/** Whether an `If-None-Match` names this tag (or any). */
export function matchesTag(header: string | string[] | undefined, etag: string): boolean {
  const text = Array.isArray(header) ? header.join(',') : header;
  if (text === undefined) return false;
  return text.split(',').some((part) => {
    const tag = part.trim().replace(/^W\//, '');
    return tag === '*' || tag === etag;
  });
}

/** Read a stream, refusing it once it passes `max` bytes. */
export async function readCapped(stream: Readable, max: number): Promise<Buffer> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += part.length;
    if (total > max) {
      stream.destroy();
      refuse('larger than a picture served');
    }
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/**
 * The cleaning of pictures on this server: at most `PICTURE_CLEANING_AT_ONCE`
 * at a time, and at most one for any one address (its IPv6 /64), so one
 * visitor naming picture after picture never holds every place and turns
 * the real visitors away. A picture already being cleaned is waited for,
 * not cleaned twice. The tags of pictures cleaned or read back are kept in
 * memory, so a browser asking "still this one?" is answered without opening
 * anything; the bytes are kept beside the file (`picture-store.ts`), not
 * here.
 */
export interface PictureCache {
  tagOf(fileId: string): string | undefined;
  remember(fileId: string, etag: string): void;
  /** Clean one picture; null when every place is taken, or this address already holds one. */
  clean(fileId: string, address: string, load: () => Promise<{ bytes: Buffer; mime: string }>): Promise<CleanPicture | null>;
}

export function createPictureCache(maxTags = 10_000): PictureCache {
  const tags = new Map<string, string>();
  const pending = new Map<string, Promise<CleanPicture>>();
  const cleaningFor = new Set<string>();
  const keyOf = (fileId: string) => `${fileId}|${PICTURE_PIPELINE}`;
  const remember = (fileId: string, etag: string) => {
    const key = keyOf(fileId);
    tags.delete(key);
    if (tags.size >= maxTags) tags.delete(tags.keys().next().value!);
    tags.set(key, etag);
  };
  return {
    tagOf(fileId) {
      return tags.get(keyOf(fileId));
    },
    remember,
    async clean(fileId, address, load) {
      const key = keyOf(fileId);
      const already = pending.get(key);
      if (already !== undefined) return already;
      const who = rateAddress(address);
      if (cleaningFor.size >= PICTURE_CLEANING_AT_ONCE || cleaningFor.has(who)) return null;
      cleaningFor.add(who);
      const work = (async () => {
        const source = await load();
        const picture = cleanPicture(source.bytes, source.mime);
        remember(fileId, picture.etag);
        return picture;
      })();
      pending.set(key, work);
      try {
        return await work;
      } finally {
        pending.delete(key);
        cleaningFor.delete(who);
      }
    },
  };
}
