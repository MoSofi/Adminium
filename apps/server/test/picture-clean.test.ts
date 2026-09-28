// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a picture anyone may see is cleaned of before it is served: the place
 * a photo was taken, comments, XMP — and nothing else (the pixels, the colour
 * profile, a GIF's loop stay byte for byte). A picture larger than a
 * visitor's device should unpack, or not what its file says it is, is not
 * served. The tag is the hash of the bytes served; cleaning is done once, two
 * at a time at most.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { cleanPicture, createPictureCache, matchesTag, pictureHeaders, PictureRefused, PICTURE_CLEANING_AT_ONCE, PICTURE_MAX_FRAMES, PICTURE_PIPELINE, readCapped } from '../src/public-api/picture.js';
import { gif, gifFrame, jpeg, jpegSegment, png, pngChunk, riffChunk, webp, webpFile } from './picture-images.js';

describe('a picture, cleaned', () => {
  it('loses what a camera wrote beside it, and keeps every other byte', () => {
    for (const [mime, image] of [
      ['image/png', png({ text: 'GPS 51.5074 N', exif: true })],
      ['image/jpeg', jpeg()],
      ['image/webp', webp()],
      ['image/gif', gif()],
    ] as const) {
      const out = cleanPicture(image.bytes, mime);
      expect(out.bytes.equals(image.clean), mime).toBe(true);
      expect(out.bytes.toString('latin1'), mime).not.toMatch(/GPS|Elm Row|kitchen|xmpmeta|IPTC/);
      expect(out.mime).toBe(mime);
    }
  });

  it('reads its size from the picture itself', () => {
    expect(cleanPicture(png({ width: 3, height: 5 }).bytes, 'image/png')).toMatchObject({ width: 3, height: 5 });
    expect(cleanPicture(jpeg({ width: 640, height: 480 }).bytes, 'image/jpeg')).toMatchObject({ width: 640, height: 480 });
    expect(cleanPicture(webp({ width: 100, height: 50 }).bytes, 'image/webp')).toMatchObject({ width: 100, height: 50 });
    expect(cleanPicture(gif({ width: 10, height: 10 }).bytes, 'image/gif')).toMatchObject({ width: 10, height: 10 });
  });

  it('is refused larger than 8192 pixels a side, as something its file does not say it is, or as SVG', () => {
    expect(() => cleanPicture(png({ width: 9000, height: 10 }).bytes, 'image/png')).toThrow(PictureRefused);
    expect(() => cleanPicture(jpeg({ width: 10, height: 9000 }).bytes, 'image/jpeg')).toThrow(PictureRefused);
    expect(() => cleanPicture(webp({ width: 9000, height: 10 }).bytes, 'image/webp')).toThrow(PictureRefused);
    expect(() => cleanPicture(png().bytes, 'image/jpeg')).toThrow(PictureRefused);
    expect(() => cleanPicture(jpeg().bytes, 'image/png')).toThrow(PictureRefused);
    expect(() => cleanPicture(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml')).toThrow(PictureRefused);
    // Cut short: refused, never served half.
    const whole = png().bytes;
    expect(() => cleanPicture(whole.subarray(0, whole.length - 12), 'image/png')).toThrow(PictureRefused);
  });

  it('loses a second picture a camera appends after the first, and whatever sits between the scans of a progressive one', () => {
    const photo = jpeg();
    const exif = jpegSegment(0xe1, Buffer.from('Exif\0\0MM GPSLatitude 51.5074N GPSLongitude 0.1278W', 'latin1'));
    // A multi-picture file (an HDR gain map, a phone's depth map): the second picture carries its own place.
    const secondary = Buffer.concat([Buffer.from([0xff, 0xd8]), exif, photo.bytes.subarray(2)]);
    const mpf = jpegSegment(0xe2, Buffer.from('MPF\0II*\0 index of the pictures after this one', 'latin1'));
    const appended = Buffer.concat([photo.bytes.subarray(0, 2), mpf, photo.bytes.subarray(2), secondary, Buffer.from('SEFT trailer GPSLatitude 51.5', 'latin1')]);
    const out = cleanPicture(appended, 'image/jpeg');
    expect(out.bytes.equals(photo.clean)).toBe(true);
    expect(out.bytes.toString('latin1')).not.toMatch(/GPS|MPF|SEFT/);
    // Progressive: a comment and Exif between two scans go; the second scan stays.
    const sos = jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
    const cut = photo.bytes.length - 2; // before EOI
    const between = Buffer.concat([photo.bytes.subarray(0, cut), jpegSegment(0xfe, Buffer.from('taken at 12 Home Street', 'latin1')), exif, jpegSegment(0xc4, Buffer.alloc(20, 0)), sos, Buffer.from([0x13, 0xff, 0xd9])]);
    const scanned = cleanPicture(between, 'image/jpeg').bytes;
    expect(scanned.toString('latin1')).not.toMatch(/GPS|Home Street/);
    expect(scanned.equals(Buffer.concat([photo.clean.subarray(0, photo.clean.length - 2), jpegSegment(0xc4, Buffer.alloc(20, 0)), sos, Buffer.from([0x13, 0xff, 0xd9])]))).toBe(true);
    // Cut before its end: refused, never served half.
    expect(() => cleanPicture(photo.bytes.subarray(0, photo.bytes.length - 2), 'image/jpeg')).toThrow(PictureRefused);
  });

  it('keeps only the chunks it knows in a PNG and a WebP', () => {
    const image = png();
    const iend = image.bytes.length - 12;
    const credential = Buffer.concat([image.bytes.subarray(0, iend), pngChunk('caBX', Buffer.from('c2pa stds.exif GPSLatitude 51.5', 'latin1')), pngChunk('prVt', Buffer.from('GPS', 'latin1')), image.bytes.subarray(iend)]);
    expect(cleanPicture(credential, 'image/png').bytes.equals(image.clean)).toBe(true);
    const photo = webp();
    const extra = Buffer.concat([photo.bytes, riffChunk('C2PA', Buffer.from('GPSLatitude 51.5', 'latin1'))]);
    const fixed = Buffer.from(extra);
    fixed.writeUInt32LE(extra.length - 8, 4);
    expect(cleanPicture(fixed, 'image/webp').bytes.equals(photo.clean)).toBe(true);
    // A frame of an animation keeps its image, and nothing tucked inside it.
    const frame = (x: number, w: number, inner: Buffer[]) => {
      const head = Buffer.alloc(16);
      head.writeUIntLE(x / 2, 0, 3);
      head.writeUIntLE(w - 1, 6, 3);
      head.writeUIntLE(9, 9, 3);
      return riffChunk('ANMF', Buffer.concat([head, ...inner]));
    };
    const image8 = riffChunk('VP8L', Buffer.from([0x2f, 0, 0, 0, 0, 0, 0, 0]));
    const animated = webpFile(100, 50, [riffChunk('ANIM', Buffer.alloc(6)), frame(0, 10, [riffChunk('XMP ', Buffer.from('GPSLatitude', 'latin1')), image8])]);
    const cleaned = cleanPicture(animated, 'image/webp').bytes;
    expect(cleaned.toString('latin1')).not.toContain('GPS');
    expect(cleaned.equals(webpFile(100, 50, [riffChunk('ANIM', Buffer.alloc(6)), frame(0, 10, [image8])]))).toBe(true);
    // A frame outside the canvas, or one too many: refused.
    expect(() => cleanPicture(webpFile(100, 50, [frame(96, 10, [image8])]), 'image/webp')).toThrow(PictureRefused);
    expect(() => cleanPicture(webpFile(100, 50, Array.from({ length: PICTURE_MAX_FRAMES + 1 }, () => frame(0, 10, [image8]))), 'image/webp')).toThrow(PictureRefused);
  });

  it('refuses a GIF frame outside its screen, and a GIF of too many frames', () => {
    const small = gif({ width: 1, height: 1, frame: { width: 1, height: 1 } });
    expect(cleanPicture(small.bytes, 'image/gif')).toMatchObject({ width: 1, height: 1 });
    // A one-pixel screen with a 65535-pixel frame: a browser would grow the picture to the frame.
    expect(() => cleanPicture(gif({ width: 1, height: 1, frame: { width: 65535, height: 65535 } }).bytes, 'image/gif')).toThrow(PictureRefused);
    expect(() => cleanPicture(gif({ width: 10, height: 10, frame: { left: 5, width: 10, height: 10 } }).bytes, 'image/gif')).toThrow(PictureRefused);
    const many = gif({ width: 10, height: 10 });
    const trailer = many.bytes.length - 1;
    const frames = Buffer.concat([many.bytes.subarray(0, trailer), ...Array.from({ length: PICTURE_MAX_FRAMES }, () => gifFrame(10, 10)), many.bytes.subarray(trailer)]);
    expect(() => cleanPicture(frames, 'image/gif')).toThrow(PictureRefused);
    // An APNG frame outside its picture: refused too.
    const apng = png({ width: 4, height: 4 });
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(8, 4);
    fctl.writeUInt32BE(8, 8);
    const withFrame = Buffer.concat([apng.bytes.subarray(0, 33), pngChunk('acTL', Buffer.alloc(8)), pngChunk('fcTL', fctl), apng.bytes.subarray(33)]);
    expect(() => cleanPicture(withFrame, 'image/png')).toThrow(PictureRefused);
  });

  it('is tagged by the bytes served, never the original', () => {
    const image = png({ text: 'secret' });
    const out = cleanPicture(image.bytes, 'image/png');
    const served = createHash('sha256').update(out.bytes).digest('hex');
    expect(out.etag).toBe(`"${PICTURE_PIPELINE}-${served}"`);
    expect(out.etag).not.toContain(createHash('sha256').update(image.bytes).digest('hex'));
    expect(matchesTag(out.etag, out.etag)).toBe(true);
    expect(matchesTag(`W/${out.etag}, "other"`, out.etag)).toBe(true);
    expect(matchesTag('"other"', out.etag)).toBe(false);
  });

  it('is served for any page to show, kept a few minutes then asked again by its tag, named by its column', () => {
    expect(pictureHeaders({ mime: 'image/jpeg', etag: '"p1-x"' }, 'image', 10)).toEqual({
      'content-type': 'image/jpeg',
      'content-length': '10',
      'content-disposition': 'inline; filename="image.jpg"',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300, must-revalidate',
      etag: '"p1-x"',
      'referrer-policy': 'no-referrer',
    });
  });

  it('is read no further than the largest picture served', async () => {
    await expect(readCapped(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000)).rejects.toBeInstanceOf(PictureRefused);
    expect((await readCapped(Readable.from([Buffer.alloc(600), Buffer.alloc(400)]), 1000)).length).toBe(1000);
  });

  it('is cleaned once, two at a time at most and one per address, and its tag kept', async () => {
    const cache = createPictureCache();
    const opened: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = (id: string) => async () => {
      opened.push(id);
      await gate;
      return { bytes: png().bytes, mime: 'image/png' };
    };
    const first = cache.clean('file_a', '10.0.0.1', load('file_a'));
    // The same picture asked again, from anywhere: waited for, not cleaned twice.
    const again = cache.clean('file_a', '10.0.0.1', load('file_a'));
    // The same address (its IPv6 /64 too) holds its one place: told to come back.
    expect(await cache.clean('file_x', '10.0.0.1', load('file_x'))).toBeNull();
    const second = cache.clean('file_b', '2001:db8::1', load('file_b'));
    expect(await cache.clean('file_y', '2001:db8::2', load('file_y'))).toBeNull();
    // Past the bound: told to come back, nothing opened.
    expect(PICTURE_CLEANING_AT_ONCE).toBe(2);
    expect(await cache.clean('file_c', '10.0.0.3', load('file_c'))).toBeNull();
    release();
    const [a, a2, b] = await Promise.all([first, again, second]);
    expect(a).toBe(a2);
    expect(b).not.toBeNull();
    expect(opened).toEqual(['file_a', 'file_b']);
    expect(cache.tagOf('file_a')).toBe(a!.etag);
    expect(await cache.clean('file_c', '10.0.0.1', load('file_c'))).not.toBeNull();
    expect(opened).toEqual(['file_a', 'file_b', 'file_c']);
  });
});
