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
 * A picture is cleaned ONCE, then served from memory by its file id and this
 * pipeline's version (a new file id is a new picture: files are never
 * rewritten). The entity tag is the hash of the bytes served — never of the
 * original, which would confirm a guess at it. At most two pictures are
 * cleaned at once; a third waits for nobody and is told to come back.
 *
 * Every refusal is the caller's one 404: which rule said no is nobody's
 * business.
 */
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

/** Bumped when the cleaning changes: a new version is a new entity tag, and the cache starts again. */
export const PICTURE_PIPELINE = 'p1';

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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Text, time and Exif chunks: what a camera or an editor wrote beside the pixels. */
const PNG_DROPPED = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function cleanPng(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 8 + 25 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) refuse('not a PNG');
  const kept: Buffer[] = [PNG_SIGNATURE];
  let at = 8;
  let width = 0;
  let height = 0;
  let ended = false;
  let first = true;
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
    if (!PNG_DROPPED.has(type)) kept.push(bytes.subarray(at, end));
    at = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended) refuse('a PNG without its end');
  return { bytes: Buffer.concat(kept), width, height };
}

/** JPEG markers kept before the image data: JFIF, a colour profile, Adobe's colour transform, and everything that is not an APP or comment block. */
function jpegKeeps(marker: number): boolean {
  if (marker === 0xfe) return false; // a comment
  if (marker >= 0xe0 && marker <= 0xef) return marker === 0xe0 || marker === 0xe2 || marker === 0xee;
  return true;
}

/** The start-of-frame markers, which carry the picture's size. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function cleanJpeg(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) refuse('not a JPEG');
  const kept: Buffer[] = [bytes.subarray(0, 2)];
  let at = 2;
  let width = 0;
  let height = 0;
  for (;;) {
    if (at + 4 > bytes.length) refuse('a JPEG that ends before its image');
    if (bytes[at] !== 0xff) refuse('a JPEG block out of place');
    const marker = bytes[at + 1]!;
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) refuse('a JPEG block runs past the end');
    if (JPEG_FRAMES.has(marker)) {
      if (length < 7) refuse('a JPEG frame too short');
      height = bytes.readUInt16BE(at + 5);
      width = bytes.readUInt16BE(at + 7);
    }
    if (marker === 0xda) {
      // The image itself, and all that follows it, as it is.
      kept.push(bytes.subarray(at));
      break;
    }
    if (jpegKeeps(marker)) kept.push(bytes.subarray(at, end));
    at = end;
  }
  if (width === 0 || height === 0) refuse('a JPEG without its size');
  return { bytes: Buffer.concat(kept), width, height };
}

/** WebP chunks dropped: Exif and XMP. */
const WEBP_DROPPED = new Set(['EXIF', 'XMP ']);

function cleanWebp(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  if (bytes.length < 20 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') refuse('not a WebP');
  const chunks: Buffer[] = [];
  let at = 12;
  let width = 0;
  let height = 0;
  while (at + 8 <= bytes.length) {
    const fourcc = bytes.toString('latin1', at, at + 4);
    const size = bytes.readUInt32LE(at + 4);
    const end = at + 8 + size + (size % 2);
    if (at + 8 + size > bytes.length) refuse('a WebP chunk runs past the end');
    const data = bytes.subarray(at + 8, at + 8 + size);
    if (fourcc === 'VP8X') {
      if (size < 10) refuse('a WebP header too short');
      width = data.readUIntLE(4, 3) + 1;
      height = data.readUIntLE(7, 3) + 1;
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
    if (!WEBP_DROPPED.has(fourcc)) {
      const chunk = Buffer.from(bytes.subarray(at, Math.min(end, bytes.length)));
      // The extended header says which chunks follow: Exif and XMP no longer do.
      if (fourcc === 'VP8X') chunk[8] = chunk[8]! & ~0x0c;
      chunks.push(chunk);
    }
    at = end;
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

function cleanGif(bytes: Buffer): { bytes: Buffer; width: number; height: number } {
  const version = bytes.toString('latin1', 0, 6);
  if (bytes.length < 14 || (version !== 'GIF87a' && version !== 'GIF89a')) refuse('not a GIF');
  const width = bytes.readUInt16LE(6);
  const height = bytes.readUInt16LE(8);
  const packed = bytes[10]!;
  let at = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  if (at > bytes.length) refuse('a GIF colour table runs past the end');
  const kept: Buffer[] = [bytes.subarray(0, at)];
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
      const local = bytes[at + 9]!;
      let p = at + 10 + (local & 0x80 ? 3 * 2 ** ((local & 0x07) + 1) : 0);
      p = subBlocks(p + 1); // the code size, then the image data
      kept.push(bytes.subarray(at, p));
      at = p;
      continue;
    }
    refuse('a GIF block out of place');
  }
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
 * Cleaned pictures, kept by file id: every visitor after the first is served
 * from here. Bounded by bytes (the oldest go first); the tags are kept longer
 * than the bytes, so a browser asking "still this one?" is answered without
 * opening the file again.
 */
export interface PictureCache {
  get(fileId: string): CleanPicture | undefined;
  tagOf(fileId: string): string | undefined;
  /** Clean one picture, at most `PICTURE_CLEANING_AT_ONCE` at a time; null when that many are being cleaned. */
  clean(fileId: string, load: () => Promise<{ bytes: Buffer; mime: string }>): Promise<CleanPicture | null>;
}

export function createPictureCache(maxBytes = 24 * 1024 * 1024, maxTags = 10_000): PictureCache {
  const pictures = new Map<string, CleanPicture>();
  const tags = new Map<string, string>();
  const pending = new Map<string, Promise<CleanPicture>>();
  let held = 0;
  let cleaning = 0;
  const keyOf = (fileId: string) => `${fileId}|${PICTURE_PIPELINE}`;
  const remember = (fileId: string, picture: CleanPicture) => {
    const key = keyOf(fileId);
    if (tags.size >= maxTags) tags.delete(tags.keys().next().value!);
    tags.set(key, picture.etag);
    if (picture.bytes.length > maxBytes) return;
    pictures.set(key, picture);
    held += picture.bytes.length;
    for (const [oldest, old] of pictures) {
      if (held <= maxBytes) break;
      pictures.delete(oldest);
      held -= old.bytes.length;
    }
  };
  return {
    get(fileId) {
      const key = keyOf(fileId);
      const found = pictures.get(key);
      if (found !== undefined) {
        // Most recently used goes last: the oldest is the first to go.
        pictures.delete(key);
        pictures.set(key, found);
      }
      return found;
    },
    tagOf(fileId) {
      return tags.get(keyOf(fileId));
    },
    async clean(fileId, load) {
      const key = keyOf(fileId);
      const already = pending.get(key);
      if (already !== undefined) return already;
      if (cleaning >= PICTURE_CLEANING_AT_ONCE) return null;
      cleaning += 1;
      const work = (async () => {
        const source = await load();
        const picture = cleanPicture(source.bytes, source.mime);
        remember(fileId, picture);
        return picture;
      })();
      pending.set(key, work);
      try {
        return await work;
      } finally {
        pending.delete(key);
        cleaning -= 1;
      }
    },
  };
}
