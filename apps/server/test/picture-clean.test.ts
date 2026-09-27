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

import { cleanPicture, createPictureCache, matchesTag, pictureHeaders, PictureRefused, PICTURE_CLEANING_AT_ONCE, readCapped } from '../src/public-api/picture.js';
import { gif, jpeg, png, webp } from './picture-images.js';

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

  it('is tagged by the bytes served, never the original', () => {
    const image = png({ text: 'secret' });
    const out = cleanPicture(image.bytes, 'image/png');
    const served = createHash('sha256').update(out.bytes).digest('hex');
    expect(out.etag).toBe(`"p1-${served}"`);
    expect(out.etag).not.toContain(createHash('sha256').update(image.bytes).digest('hex'));
    expect(matchesTag(out.etag, out.etag)).toBe(true);
    expect(matchesTag(`W/${out.etag}, "other"`, out.etag)).toBe(true);
    expect(matchesTag('"other"', out.etag)).toBe(false);
  });

  it('is served for any page to show, cached a week, named by its column', () => {
    expect(pictureHeaders({ mime: 'image/jpeg', etag: '"p1-x"' }, 'image', 10)).toEqual({
      'content-type': 'image/jpeg',
      'content-length': '10',
      'content-disposition': 'inline; filename="image.jpg"',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'cross-origin',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=604800, immutable',
      etag: '"p1-x"',
      'referrer-policy': 'no-referrer',
    });
  });

  it('is read no further than the largest picture served', async () => {
    await expect(readCapped(Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 1000)).rejects.toBeInstanceOf(PictureRefused);
    expect((await readCapped(Readable.from([Buffer.alloc(600), Buffer.alloc(400)]), 1000)).length).toBe(1000);
  });

  it('is cleaned once, two at a time at most, and kept', async () => {
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
    const first = cache.clean('file_a', load('file_a'));
    const again = cache.clean('file_a', load('file_a'));
    const second = cache.clean('file_b', load('file_b'));
    // Past the bound: told to come back, nothing opened.
    expect(PICTURE_CLEANING_AT_ONCE).toBe(2);
    expect(await cache.clean('file_c', load('file_c'))).toBeNull();
    release();
    const [a, a2, b] = await Promise.all([first, again, second]);
    expect(a).toBe(a2);
    expect(b).not.toBeNull();
    expect(opened).toEqual(['file_a', 'file_b']);
    // Kept: served again without opening it.
    expect(cache.get('file_a')).toBe(a);
    expect(cache.tagOf('file_a')).toBe(a!.etag);
    expect(await cache.clean('file_c', load('file_c'))).not.toBeNull();
    expect(opened).toEqual(['file_a', 'file_b', 'file_c']);
  });

  it('keeps the tag after the bytes are let go', async () => {
    const cache = createPictureCache(50);
    const picture = await cache.clean('file_big', async () => ({ bytes: png({ width: 30, height: 30 }).bytes, mime: 'image/png' }));
    expect(picture!.bytes.length).toBeGreaterThan(50);
    expect(cache.get('file_big')).toBeUndefined();
    expect(cache.tagOf('file_big')).toBe(picture!.etag);
  });
});
